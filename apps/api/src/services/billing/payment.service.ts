import { createHash, randomBytes } from "node:crypto";
import { isSupportedCurrency, type Currency } from "@ieltiva/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import type { Logger } from "../../utils/logger.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import type { EntitlementService } from "./entitlement.service.js";
import { PaymentProviderError, type PaymentProvider, type VerifiedPayment } from "./provider.js";

/** A payment that's still open after this long is closed as expired. */
const PAYMENT_WINDOW_MINUTES = 60;
/** A status check asks the gateway at most this often, however many times the page is reloaded. */
const RECHECK_AFTER_SECONDS = 10;

type NotifyFn = (userId: string, message: { type: "PAYMENT"; title: string; body: string; link?: string; dedupeKey?: string }) => Promise<void>;

type Deps = {
  prisma: PrismaClient;
  providers: Map<string, PaymentProvider>;
  entitlements: EntitlementService;
  notify: NotifyFn;
  logger: Pick<Logger, "warn" | "error" | "info">;
  urls: { api: string; frontend: string };
  /** Live payments stay off unless this is true. This phase never turns it on. */
  allowLive: boolean;
};

type Snapshot = {
  package: { id: string; code: string; name: string; category: string; validityDays: number | null; features: { featureKey: string; quantity: number | null }[] };
  price: { currency: string; amountMinor: number };
};

const newTrackingId = () => `IELT${randomBytes(10).toString("hex")}`;
const hashPayload = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Parses a gateway message body, which is either form data or JSON, into plain string fields. */
export function readFields(raw: Buffer, contentType: string | undefined): Record<string, string> {
  const text = raw.toString("utf8");
  const fields: Record<string, string> = {};
  if (contentType?.includes("json")) {
    try {
      for (const [key, value] of Object.entries(asRecord(JSON.parse(text)))) if (typeof value === "string" || typeof value === "number") fields[key] = String(value);
    } catch {
      return {};
    }
    return fields;
  }
  for (const [key, value] of new URLSearchParams(text)) fields[key] = value;
  return fields;
}

export function createPaymentService({ prisma, providers, entitlements, notify, logger, urls, allowLive }: Deps) {
  const provider = (code: string) => {
    const found = providers.get(code);
    if (!found) throw new AppError(404, "NOT_FOUND", "This payment method isn't available.");
    return found;
  };

  /** Makes sure every known gateway has a row. New ones start switched off and in sandbox mode. */
  async function ensureGateways() {
    await prisma.paymentGateway.createMany({
      data: [...providers.values()].map((item) => ({ code: item.code, name: item.displayName, isEnabled: false, isSandbox: true, regionCodes: item.code === "stripe" ? ["GLOBAL"] : ["BD", "GLOBAL"], currencies: [...item.currencies] })),
      skipDuplicates: true,
    });
  }

  /** Every gateway runs in sandbox mode unless live payments were deliberately allowed in the server settings. */
  const sandboxFor = () => !allowLive;

  async function fulfil(tx: Prisma.TransactionClient, purchaseId: string, paidAt: Date) {
    const purchase = await tx.userPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (purchase.status === "PAID" || purchase.status === "PARTIALLY_REFUNDED" || purchase.status === "REFUNDED") return purchase;
    const snapshot = purchase.packageSnapshot as unknown as Snapshot;
    await tx.userPurchase.update({ where: { id: purchaseId }, data: { status: "PAID", paidAt } });
    await entitlements.grantForPurchase(tx, { id: purchase.id, userId: purchase.userId, packageId: purchase.packageId, paidAt }, snapshot.package.features, snapshot.package.validityDays);
    return purchase;
  }

  /**
   * Turns what the gateway says into our records. This is the only place a payment becomes successful,
   * and it runs only on an answer read directly from the gateway. Running it again is harmless.
   */
  async function applyVerified(transactionId: string, verified: VerifiedPayment) {
    const outcome = await prisma.$transaction(async (tx) => {
      // The row is locked, so a notification and a status check arriving together are handled one after the other.
      await tx.$queryRaw`SELECT id FROM payment_transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
      const row = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { purchase: true } });
      if (row.status === "SUCCEEDED" || row.status === "REFUNDED") return { changed: false as const, row };
      const now = new Date();

      if (verified.trackingId !== null && verified.trackingId !== row.trackingId) {
        await recordAudit(tx, null, { action: "payment.reference_mismatch", entityType: "payment_transaction", entityId: row.id, after: { received: verified.trackingId } });
        return { changed: false as const, row };
      }

      if (verified.state === "SUCCEEDED") {
        const matches = verified.amountMinor === row.amountMinor && verified.currency === row.currency && verified.trackingId === row.trackingId;
        if (!matches) {
          // Money moved but not as expected. Nothing is granted, and the case is left for a person to look at.
          await tx.paymentTransaction.update({ where: { id: row.id }, data: { status: "FAILED", failureReason: "needs_review:amount_or_currency_mismatch", verifiedAt: now, rawResponse: { ...asRecord(row.rawResponse), verification: verified.summary } as Prisma.InputJsonValue } });
          await tx.userPurchase.update({ where: { id: row.purchaseId }, data: { status: "FAILED" } });
          await recordAudit(tx, null, { action: "payment.amount_mismatch", entityType: "payment_transaction", entityId: row.id, after: { expectedMinor: row.amountMinor, expectedCurrency: row.currency, receivedMinor: verified.amountMinor, receivedCurrency: verified.currency } });
          return { changed: true as const, row, result: "mismatch" as const };
        }
        await tx.paymentTransaction.update({
          where: { id: row.id },
          data: {
            status: "SUCCEEDED",
            failureReason: null,
            gatewayTransactionId: verified.gatewayTransactionId ?? null,
            gatewayValidationId: verified.validationId ?? null,
            verifiedAt: now,
            succeededAt: now,
            rawResponse: { ...asRecord(row.rawResponse), verification: verified.summary } as Prisma.InputJsonValue,
          },
        });
        await fulfil(tx, row.purchaseId, now);
        await recordAudit(tx, null, { action: "payment.succeeded", entityType: "payment_transaction", entityId: row.id, after: { amountMinor: row.amountMinor, currency: row.currency } });
        return { changed: true as const, row, result: "paid" as const };
      }

      if (verified.state === "FAILED" || verified.state === "CANCELED") {
        await tx.paymentTransaction.update({ where: { id: row.id }, data: { status: verified.state, failureReason: verified.reason ?? verified.state.toLowerCase(), verifiedAt: now } });
        if (row.purchase.status === "PENDING") await tx.userPurchase.update({ where: { id: row.purchaseId }, data: { status: verified.state === "FAILED" ? "FAILED" : "CANCELED" } });
        return { changed: true as const, row, result: "closed" as const };
      }

      await tx.paymentTransaction.update({ where: { id: row.id }, data: { verifiedAt: now } });
      return { changed: false as const, row };
    });

    if (outcome.changed && outcome.result === "paid") {
      const snapshot = outcome.row.purchase.packageSnapshot as unknown as Snapshot;
      await notify(outcome.row.purchase.userId, { type: "PAYMENT", title: "Payment received", body: `Your ${snapshot.package.name} package is ready to use.`, link: "/billing", dedupeKey: `payment-paid:${outcome.row.id}` }).catch(() => undefined);
    }
    return outcome;
  }

  /** Asks the gateway about a transaction and applies the answer. A gateway outage leaves the payment pending. */
  async function reconcile(transactionId: string, hint: Record<string, string> = {}) {
    const row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { gateway: true } });
    if (row.status !== "PENDING" && row.status !== "FAILED" && row.status !== "CANCELED") return;
    // A payment the gateway later confirms is accepted even after we closed it, because the customer's money did move.
    const reference = asRecord(asRecord(row.rawResponse).init).reference;
    try {
      const verified = await provider(row.gateway.code).verify({ trackingId: row.trackingId, reference: typeof reference === "string" ? reference : undefined, hint });
      await applyVerified(row.id, verified);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        logger.warn({ transactionId, kind: error.kind }, "Payment check couldn't be completed");
        return;
      }
      throw error;
    }
  }

  const transactionView = (row: { id: string; trackingId: string; status: string; amountMinor: number; currency: string; failureReason: string | null; createdAt: Date; succeededAt: Date | null; expiresAt: Date | null; gateway: { code: string; name: string } }) => ({
    id: row.id,
    reference: row.trackingId,
    status: row.status,
    amountMinor: row.amountMinor,
    currency: row.currency,
    gateway: row.gateway.name,
    // A short plain-language reason. Internal review notes stay out of the student's view.
    failureReason: row.failureReason?.startsWith("needs_review") ? "We're checking this payment. If you were charged, we'll sort it out." : row.failureReason,
    createdAt: row.createdAt,
    succeededAt: row.succeededAt,
    expiresAt: row.expiresAt,
  });

  return {
    ensureGateways,
    reconcile,

    /** What a student can pay with right now: switched on, configured and able to take the currency. */
    async availableGateways(currency?: string) {
      await ensureGateways();
      const rows = await prisma.paymentGateway.findMany({ where: { isEnabled: true }, orderBy: { name: "asc" } });
      return rows
        .filter((row) => providers.get(row.code)?.isConfigured() && (!currency || (row.currencies.includes(currency) && providers.get(row.code)?.currencies.includes(currency as Currency))))
        .map((row) => ({ code: row.code, name: row.name, currencies: row.currencies, sandbox: sandboxFor() }));
    },

    async checkout(actor: Actor, input: { packageId: string; currency: Currency; gateway: string; idempotencyKey: string }) {
      await ensureGateways();
      const gatewayRow = await prisma.paymentGateway.findUnique({ where: { code: input.gateway } });
      const gateway = providers.get(input.gateway);
      if (!gatewayRow || !gateway || !gatewayRow.isEnabled || !gateway.isConfigured()) throw new AppError(409, "CONFLICT", "This payment method isn't available right now.");
      if (!gatewayRow.currencies.includes(input.currency) || !gateway.currencies.includes(input.currency)) throw new AppError(400, "VALIDATION_ERROR", "This payment method doesn't take that currency.");

      const pack = await prisma.package.findFirst({ where: { id: input.packageId, isActive: true, deletedAt: null }, include: { prices: true, features: true } });
      const price = pack?.prices.find((item) => item.currency === input.currency && item.isActive);
      if (!pack || !price) throw new AppError(404, "NOT_FOUND", "This package isn't available in that currency.");

      // The amount is read from our own price list. Nothing the browser sends can change what is charged.
      const idempotencyKey = `${actor.userId}:${input.idempotencyKey}`;
      const repeated = await prisma.paymentTransaction.findUnique({ where: { idempotencyKey }, include: { gateway: true } });
      const reusable = repeated ?? (await prisma.paymentTransaction.findFirst({ where: { status: "PENDING", expiresAt: { gt: new Date() }, purchase: { userId: actor.userId, packageId: pack.id }, gatewayId: gatewayRow.id, currency: input.currency }, include: { gateway: true }, orderBy: { createdAt: "desc" } }));
      if (reusable) {
        // A repeat or a second click returns the payment that's already open, so nobody pays twice by accident.
        const init = asRecord(asRecord(reusable.rawResponse).init);
        if (reusable.status === "PENDING" && typeof init.redirectUrl === "string") return { reference: reusable.trackingId, redirectUrl: init.redirectUrl };
        if (repeated) throw new AppError(409, "CONFLICT", "This payment was already started. Please begin a new one.");
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true, profile: { select: { firstName: true, lastName: true } } } });
      const snapshot: Snapshot = {
        package: { id: pack.id, code: pack.code, name: pack.name, category: pack.category, validityDays: pack.validityDays, features: pack.features.map((feature) => ({ featureKey: feature.featureKey, quantity: feature.quantity })) },
        price: { currency: price.currency, amountMinor: price.amountMinor },
      };
      const trackingId = newTrackingId();
      const created = await prisma.$transaction(async (tx) => {
        const purchase = await tx.userPurchase.create({ data: { userId: actor.userId, packageId: pack.id, currency: price.currency, amountMinor: price.amountMinor, packageSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
        return tx.paymentTransaction.create({
          data: { purchaseId: purchase.id, gatewayId: gatewayRow.id, trackingId, idempotencyKey, currency: price.currency, amountMinor: price.amountMinor, expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000) },
        });
      });

      const back = (outcome: string) => `${urls.api}/api/v1/payments/return/${gateway.code}/${outcome}?ref=${trackingId}`;
      try {
        const session = await gateway.createSession({
          trackingId,
          amountMinor: price.amountMinor,
          currency: input.currency,
          description: pack.name,
          customer: { name: `${user.profile?.firstName ?? ""} ${user.profile?.lastName ?? ""}`.trim() || "Student", email: user.email },
          returnUrls: { success: back("success"), fail: back("fail"), cancel: back("cancel") },
          notificationUrl: `${urls.api}/api/v1/payments/webhooks/${gateway.code}`,
        });
        await prisma.paymentTransaction.update({ where: { id: created.id }, data: { rawResponse: { init: { redirectUrl: session.redirectUrl, reference: session.reference ?? null } } } });
        await recordAudit(prisma, actor, { action: "payment.start", entityType: "payment_transaction", entityId: created.id, after: { gateway: gateway.code, packageId: pack.id, amountMinor: price.amountMinor, currency: price.currency } });
        return { reference: trackingId, redirectUrl: session.redirectUrl };
      } catch (error) {
        await prisma.$transaction([
          prisma.paymentTransaction.update({ where: { id: created.id }, data: { status: "FAILED", failureReason: "gateway_unavailable" } }),
          prisma.userPurchase.update({ where: { id: created.purchaseId }, data: { status: "FAILED" } }),
        ]);
        logger.warn({ gateway: gateway.code, kind: error instanceof PaymentProviderError ? error.kind : "unknown" }, "Couldn't start a payment");
        throw new AppError(503, "SERVICE_UNAVAILABLE", "We couldn't open the payment page. Nothing was charged. Please try again shortly.");
      }
    },

    /**
     * The customer's browser came back. The browser's claim isn't used. The gateway is asked directly,
     * and the reference is our own, so another customer's reference or validation ID can't be swapped in.
     */
    async handleReturn(gatewayCode: string, outcome: "success" | "fail" | "cancel", reference: string | undefined, fields: Record<string, string>) {
      const target = (ref: string) => `${urls.frontend}/billing/status?ref=${encodeURIComponent(ref)}`;
      if (!reference || !/^IELT[0-9a-f]{20}$/.test(reference)) return `${urls.frontend}/billing`;
      const row = await prisma.paymentTransaction.findFirst({ where: { trackingId: reference, gateway: { code: gatewayCode } } });
      if (!row) return `${urls.frontend}/billing`;
      const hint: Record<string, string> = {};
      if (fields.val_id) hint.val_id = fields.val_id;
      await reconcile(row.id, hint);
      if (outcome === "cancel") {
        // Pressing cancel closes an unpaid payment. If it was actually paid, the check above already recorded it.
        await prisma.paymentTransaction.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELED", failureReason: "canceled_by_customer" } });
        await prisma.userPurchase.updateMany({ where: { id: row.purchaseId, status: "PENDING" }, data: { status: "CANCELED" } });
      }
      return target(reference);
    },

    /** A signed or unsigned message from the gateway's servers. It only prompts a lookup, and a repeat does nothing. */
    async handleNotification(gatewayCode: string, headers: Record<string, string | undefined>, raw: Buffer) {
      await ensureGateways();
      const gateway = provider(gatewayCode);
      const gatewayRow = await prisma.paymentGateway.findUniqueOrThrow({ where: { code: gatewayCode } });
      const fields = readFields(raw, headers["content-type"]);
      let message;
      try {
        message = gateway.parseNotification({ headers, rawBody: raw, fields });
      } catch (error) {
        if (error instanceof PaymentProviderError && error.kind === "BAD_SIGNATURE") {
          await recordAudit(prisma, null, { action: "payment.webhook_rejected", entityType: "payment_gateway", entityId: gatewayRow.id, after: { reason: "bad_signature" } });
          throw new AppError(400, "VALIDATION_ERROR", "The notification could not be verified.");
        }
        throw new AppError(503, "SERVICE_UNAVAILABLE", "Notifications aren't available for this gateway.");
      }
      if (!message) return { handled: false as const, outcome: "ignored" };

      // Nothing is stored for a reference we never issued, so messages sent to a public address can't fill the table.
      const row = await prisma.paymentTransaction.findFirst({ where: { trackingId: message.trackingId, gatewayId: gatewayRow.id } });
      if (!row) {
        logger.warn({ gateway: gatewayCode }, "Payment notification for an unknown reference");
        return { handled: false as const, outcome: "unknown_reference" };
      }

      const payloadHash = hashPayload(raw);
      let event = await prisma.paymentWebhookEvent.findUnique({ where: { gatewayId_eventKey: { gatewayId: gatewayRow.id, eventKey: message.eventKey } } });
      if (event?.processedAt) return { handled: true as const, outcome: "duplicate" };
      event ??= await prisma.paymentWebhookEvent.create({ data: { gatewayId: gatewayRow.id, eventKey: message.eventKey, payloadHash } }).catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { gatewayId_eventKey: { gatewayId: gatewayRow.id, eventKey: message.eventKey } } });
        throw error;
      });

      await reconcile(row.id, message.hint);
      const outcome = (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } })).status.toLowerCase();
      await prisma.paymentWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), outcome } });
      return { handled: true as const, outcome };
    },

    /** The status page. If a notification went missing, a reload still settles the payment by asking the gateway. */
    async status(actor: Actor, reference: string) {
      const row = await prisma.paymentTransaction.findFirst({ where: { trackingId: reference, purchase: { userId: actor.userId } }, include: { gateway: true, purchase: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This payment wasn't found.");
      let current = row;
      const stale = !row.verifiedAt || Date.now() - row.verifiedAt.getTime() > RECHECK_AFTER_SECONDS * 1000;
      if (row.status === "PENDING" && stale) {
        if (row.expiresAt && row.expiresAt < new Date()) {
          // Reconcile first, because the customer may have paid just before the window closed.
          await reconcile(row.id);
          await prisma.paymentTransaction.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELED", failureReason: "expired" } });
          await prisma.userPurchase.updateMany({ where: { id: row.purchaseId, status: "PENDING" }, data: { status: "CANCELED" } });
        } else {
          await reconcile(row.id);
        }
        current = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: row.id }, include: { gateway: true, purchase: true } });
      }
      const snapshot = current.purchase.packageSnapshot as unknown as Snapshot;
      return { ...transactionView(current), packageName: snapshot.package.name, purchaseId: current.purchaseId };
    },

    /** The student's purchases, newest first. */
    async history(actor: Actor, query: { page: number; pageSize: number }) {
      const where = { userId: actor.userId, status: { not: "PENDING" as const } };
      const [rows, total] = await prisma.$transaction([
        prisma.userPurchase.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { transactions: { orderBy: { createdAt: "desc" }, take: 1, include: { gateway: { select: { code: true, name: true } } } }, refunds: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, amountMinor: true, createdAt: true } } },
        }),
        prisma.userPurchase.count({ where }),
      ]);
      const items = rows.map((row) => {
        const snapshot = row.packageSnapshot as unknown as Snapshot;
        const transaction = row.transactions[0];
        return {
          id: row.id,
          packageName: snapshot.package.name,
          category: snapshot.package.category,
          status: row.status,
          amountMinor: row.amountMinor,
          refundedMinor: row.refundedMinor,
          currency: row.currency,
          paidAt: row.paidAt,
          createdAt: row.createdAt,
          reference: transaction?.trackingId ?? null,
          gateway: transaction?.gateway.name ?? null,
          refunds: row.refunds,
          canRequestRefund: row.status === "PAID" && !row.refunds.some((refund) => ["REQUESTED", "APPROVED"].includes(refund.status)),
        };
      });
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    // ----- Administration -----

    async listTransactions(query: { page: number; pageSize: number; status?: string | undefined; gateway?: string | undefined; search?: string | undefined }) {
      const where: Prisma.PaymentTransactionWhereInput = {
        ...(query.status ? { status: query.status as Prisma.PaymentTransactionWhereInput["status"] } : {}),
        ...(query.gateway ? { gateway: { code: query.gateway } } : {}),
        ...(query.search ? { OR: [{ trackingId: { contains: query.search, mode: "insensitive" } }, { purchase: { user: { email: { contains: query.search, mode: "insensitive" } } } }] } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.paymentTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { gateway: { select: { code: true, name: true } }, purchase: { select: { id: true, status: true, refundedMinor: true, packageSnapshot: true, user: { select: { id: true, email: true } } } } } }),
        prisma.paymentTransaction.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({ ...transactionView(row), failureReason: row.failureReason, purchaseStatus: row.purchase.status, refundedMinor: row.purchase.refundedMinor, packageName: (row.purchase.packageSnapshot as unknown as Snapshot).package.name, user: row.purchase.user })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    /** Lets an administrator ask the gateway again, for example after an outage. The gateway's answer decides, not the administrator. */
    async recheck(actor: Actor, transactionId: string) {
      const row = await prisma.paymentTransaction.findUnique({ where: { id: transactionId } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This payment wasn't found.");
      await reconcile(row.id);
      await recordAudit(prisma, actor, { action: "payment.recheck", entityType: "payment_transaction", entityId: row.id });
      return prisma.paymentTransaction.findUniqueOrThrow({ where: { id: row.id }, select: { id: true, status: true } });
    },

    /** Used by the background worker: closes abandoned payments and settles ones whose notification never arrived. */
    async sweepPending() {
      const rows = await prisma.paymentTransaction.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 3 * 60_000) } }, take: 50, orderBy: { createdAt: "asc" } });
      for (const row of rows) {
        await reconcile(row.id);
        if (row.expiresAt && row.expiresAt < new Date()) {
          await prisma.paymentTransaction.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELED", failureReason: "expired" } });
          await prisma.userPurchase.updateMany({ where: { id: row.purchaseId, status: "PENDING" }, data: { status: "CANCELED" } });
        }
      }
      return rows.length;
    },

    async listGateways() {
      await ensureGateways();
      const rows = await prisma.paymentGateway.findMany({ orderBy: { name: "asc" } });
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        isEnabled: row.isEnabled,
        sandbox: sandboxFor(),
        credentialsPresent: providers.get(row.code)?.isConfigured() ?? false,
        supportsRefunds: Boolean(providers.get(row.code)?.refund),
        regionCodes: row.regionCodes,
        currencies: row.currencies,
        supportedCurrencies: [...(providers.get(row.code)?.currencies ?? [])],
        webhookUrl: `${urls.api}/api/v1/payments/webhooks/${row.code}`,
      }));
    },

    async updateGateway(actor: Actor, code: string, input: { name?: string | undefined; isEnabled?: boolean | undefined; regionCodes?: string[] | undefined; currencies?: string[] | undefined }) {
      await ensureGateways();
      const row = await prisma.paymentGateway.findUnique({ where: { code } });
      const impl = providers.get(code);
      if (!row || !impl) throw new AppError(404, "NOT_FOUND", "This gateway wasn't found.");
      if (input.isEnabled && !impl.isConfigured()) throw new AppError(409, "CONFLICT", "Add this gateway's sandbox keys to the server settings before switching it on.");
      if (input.currencies?.some((currency) => !isSupportedCurrency(currency) || !impl.currencies.includes(currency))) throw new AppError(400, "VALIDATION_ERROR", "This gateway doesn't support one of those currencies.");
      await prisma.$transaction(async (tx) => {
        await tx.paymentGateway.update({ where: { code }, data: { ...(input.name ? { name: input.name } : {}), ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}), ...(input.regionCodes ? { regionCodes: input.regionCodes } : {}), ...(input.currencies ? { currencies: input.currencies } : {}) } });
        await recordAudit(tx, actor, { action: "gateway.update", entityType: "payment_gateway", entityId: row.id, before: { isEnabled: row.isEnabled, currencies: row.currencies }, after: input });
      });
      return (await this.listGateways()).find((item) => item.code === code);
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
