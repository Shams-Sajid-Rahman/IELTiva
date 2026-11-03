import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { isSupportedCurrency } from "@ieltiva/shared";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import type { EntitlementService } from "./entitlement.service.js";
import { PaymentProviderError, type PaymentProvider } from "./provider.js";

type Notify = (userId: string, message: { type: "PAYMENT"; title: string; body: string; link?: string; dedupeKey?: string }) => Promise<void>;

const REFUND_WINDOW_SETTING = "billing.refund_window_days";
const DEFAULT_WINDOW_DAYS = 7;

/**
 * Refunds go student request → staff decision → gateway → complete. Only staff with the refund permission can
 * approve, a purchase can never be refunded for more than was paid, and the same refund can't be sent twice.
 */
export function createRefundService({ prisma, providers, entitlements, notify }: { prisma: PrismaClient; providers: Map<string, PaymentProvider>; entitlements: EntitlementService; notify: Notify }) {
  /** Amount already promised or paid back, so two approvals can't add up to more than the purchase. */
  async function committed(purchaseId: string, exceptId?: string) {
    const rows = await prisma.refundRecord.aggregate({ where: { purchaseId, status: { in: ["APPROVED", "COMPLETED"] }, ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { amountMinor: true } });
    return rows._sum.amountMinor ?? 0;
  }

  /** Records a finished refund and, if everything has been returned, ends what the student had bought. */
  async function finalize(refundId: string, actor: Actor | null, gatewayRefundId: string | null) {
    const done = await prisma.$transaction(async (tx) => {
      const refund = await tx.refundRecord.findUniqueOrThrow({ where: { id: refundId }, include: { purchase: true } });
      if (refund.status === "COMPLETED") return null;
      // The purchase's own total is the limit, checked in the same statement that changes it.
      const changed = await tx.$executeRaw`UPDATE user_purchases SET refunded_minor = refunded_minor + ${refund.amountMinor}, updated_at = now() WHERE id = ${refund.purchaseId}::uuid AND refunded_minor + ${refund.amountMinor} <= amount_minor`;
      if (changed !== 1) throw new AppError(409, "CONFLICT", "That would refund more than was paid.");
      const purchase = await tx.userPurchase.findUniqueOrThrow({ where: { id: refund.purchaseId } });
      const full = purchase.refundedMinor === purchase.amountMinor;
      await tx.userPurchase.update({ where: { id: purchase.id }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
      if (full) {
        await tx.paymentTransaction.update({ where: { id: refund.transactionId }, data: { status: "REFUNDED" } });
        await entitlements.revokeForPurchase(tx, purchase.id);
      }
      await tx.refundRecord.update({ where: { id: refundId }, data: { status: "COMPLETED", completedAt: new Date(), gatewayRefundId: gatewayRefundId ?? refund.gatewayRefundId } });
      await recordAudit(tx, actor, { action: "refund.complete", entityType: "refund", entityId: refundId, after: { amountMinor: refund.amountMinor, full } });
      return refund;
    });
    if (done) await notify(done.purchase.userId, { type: "PAYMENT", title: "Refund completed", body: "Your refund has been processed. It may take a few days to reach your account.", link: "/billing", dedupeKey: `refund-done:${refundId}` }).catch(() => undefined);
  }

  const view = (row: { id: string; status: string; amountMinor: number; currency: string; reason: string | null; decisionNote: string | null; createdAt: Date; decidedAt: Date | null; completedAt: Date | null }) => ({
    id: row.id,
    status: row.status,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reason: row.reason,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    completedAt: row.completedAt,
  });

  return {
    async request(actor: Actor, input: { purchaseId: string; reason: string }) {
      const purchase = await prisma.userPurchase.findFirst({ where: { id: input.purchaseId, userId: actor.userId }, include: { transactions: { where: { status: "SUCCEEDED" }, take: 1 }, refunds: true } });
      const transaction = purchase?.transactions[0];
      if (!purchase || !transaction) throw new AppError(404, "NOT_FOUND", "This purchase wasn't found.");
      if (purchase.status !== "PAID") throw new AppError(409, "CONFLICT", "This purchase can't be refunded.");
      if (purchase.refunds.some((refund) => ["REQUESTED", "APPROVED"].includes(refund.status))) throw new AppError(409, "CONFLICT", "You already have a refund request for this purchase.");
      const setting = await prisma.platformSetting.findUnique({ where: { key: REFUND_WINDOW_SETTING } });
      const windowDays = typeof setting?.value === "number" ? setting.value : DEFAULT_WINDOW_DAYS;
      if (purchase.paidAt && Date.now() - purchase.paidAt.getTime() > windowDays * 86_400_000) {
        throw new AppError(409, "CONFLICT", `Refund requests need to be made within ${windowDays} days of buying.`);
      }
      const refund = await prisma.refundRecord
        .create({ data: { purchaseId: purchase.id, transactionId: transaction.id, requestedById: actor.userId, currency: purchase.currency, amountMinor: purchase.amountMinor - purchase.refundedMinor, reason: input.reason, status: "REQUESTED" } })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "CONFLICT", "You already have a refund request for this purchase.");
          throw error;
        });
      await recordAudit(prisma, actor, { action: "refund.request", entityType: "refund", entityId: refund.id, after: { purchaseId: purchase.id } });
      return view(refund);
    },

    async mine(actor: Actor) {
      const rows = await prisma.refundRecord.findMany({ where: { purchase: { userId: actor.userId } }, orderBy: { createdAt: "desc" }, take: 50 });
      return rows.map(view);
    },

    async list(query: { page: number; pageSize: number; status?: string | undefined }) {
      const where: Prisma.RefundRecordWhereInput = query.status ? { status: query.status as Prisma.RefundRecordWhereInput["status"] } : {};
      const [rows, total] = await prisma.$transaction([
        prisma.refundRecord.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { purchase: { select: { id: true, amountMinor: true, refundedMinor: true, packageSnapshot: true, user: { select: { id: true, email: true } } } }, transaction: { select: { trackingId: true, gateway: { select: { code: true, name: true } } } } },
        }),
        prisma.refundRecord.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          ...view(row),
          purchaseAmountMinor: row.purchase.amountMinor,
          alreadyRefundedMinor: row.purchase.refundedMinor,
          packageName: (row.purchase.packageSnapshot as { package?: { name?: string } }).package?.name ?? "Package",
          user: row.purchase.user,
          reference: row.transaction.trackingId,
          gateway: row.transaction.gateway.name,
          canRefundAutomatically: Boolean(providers.get(row.transaction.gateway.code)?.refund),
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async decide(actor: Actor, refundId: string, input: { decision: "APPROVE" | "REJECT"; amountMinor?: number | undefined; note?: string | null | undefined }) {
      const refund = await prisma.refundRecord.findUnique({ where: { id: refundId }, include: { purchase: true, transaction: { include: { gateway: true } } } });
      if (!refund) throw new AppError(404, "NOT_FOUND", "This refund wasn't found.");
      // Whoever asked can't also approve, so one person can't both request and approve a refund.
      if (refund.requestedById === actor.userId) throw new AppError(403, "FORBIDDEN", "You can't decide your own refund request.");

      if (input.decision === "REJECT") {
        const claimed = await prisma.refundRecord.updateMany({ where: { id: refundId, status: "REQUESTED" }, data: { status: "REJECTED", processedById: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null } });
        if (claimed.count !== 1) throw new AppError(409, "CONFLICT", "This request has already been decided.");
        await recordAudit(prisma, actor, { action: "refund.reject", entityType: "refund", entityId: refundId, after: { note: input.note ?? null } });
        await notify(refund.purchase.userId, { type: "PAYMENT", title: "Refund request declined", body: input.note ? `Your refund request was declined: ${input.note}` : "Your refund request was declined.", link: "/billing", dedupeKey: `refund-rejected:${refundId}` }).catch(() => undefined);
        return view(await prisma.refundRecord.findUniqueOrThrow({ where: { id: refundId } }));
      }

      const available = refund.purchase.amountMinor - refund.purchase.refundedMinor - (await committed(refund.purchaseId, refundId));
      const amount = input.amountMinor ?? Math.min(refund.amountMinor, available);
      if (amount < 1 || amount > available) throw new AppError(400, "VALIDATION_ERROR", "That amount is more than can still be refunded.");
      const claimed = await prisma.refundRecord.updateMany({ where: { id: refundId, status: "REQUESTED" }, data: { status: "APPROVED", amountMinor: amount, processedById: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null } });
      if (claimed.count !== 1) throw new AppError(409, "CONFLICT", "This request has already been decided.");
      await recordAudit(prisma, actor, { action: "refund.approve", entityType: "refund", entityId: refundId, after: { amountMinor: amount } });
      return this.send(actor, refundId);
    },

    /** Sends an approved refund to the gateway. Also used to retry after a failure. Gateways without a refund API stay approved until a person finishes it. */
    async send(actor: Actor, refundId: string) {
      const refund = await prisma.refundRecord.findUnique({ where: { id: refundId }, include: { transaction: { include: { gateway: true } } } });
      if (!refund) throw new AppError(404, "NOT_FOUND", "This refund wasn't found.");
      if (refund.status !== "APPROVED" && refund.status !== "FAILED") throw new AppError(409, "CONFLICT", "This refund isn't waiting to be sent.");
      const gateway = providers.get(refund.transaction.gateway.code);
      if (!gateway?.refund || !refund.transaction.gatewayTransactionId || !isSupportedCurrency(refund.currency)) return view(refund);
      // The refund's own ID is the gateway's duplicate guard, so sending twice still refunds once.
      await prisma.refundRecord.update({ where: { id: refundId }, data: { status: "APPROVED" } });
      try {
        const outcome = await gateway.refund({ trackingId: refund.transaction.trackingId, gatewayTransactionId: refund.transaction.gatewayTransactionId, amountMinor: refund.amountMinor, currency: refund.currency, refundKey: refund.id, reason: refund.reason ?? "Refund" });
        if (outcome.state === "COMPLETED") await finalize(refundId, actor, outcome.refundId);
        else if (outcome.state === "FAILED") await prisma.refundRecord.update({ where: { id: refundId }, data: { status: "FAILED", decisionNote: outcome.reason ?? "The gateway refused the refund." } });
        else await prisma.refundRecord.update({ where: { id: refundId }, data: { gatewayRefundId: outcome.refundId } });
      } catch (error) {
        const message = error instanceof PaymentProviderError ? error.message : "The refund couldn't be sent.";
        await prisma.refundRecord.update({ where: { id: refundId }, data: { status: "FAILED", decisionNote: message } });
      }
      return view(await prisma.refundRecord.findUniqueOrThrow({ where: { id: refundId } }));
    },

    /** For refunds returned by hand in the gateway's own dashboard, and for ones the gateway finished later. */
    async markCompleted(actor: Actor, refundId: string, gatewayRefundId: string) {
      const refund = await prisma.refundRecord.findUnique({ where: { id: refundId } });
      if (!refund) throw new AppError(404, "NOT_FOUND", "This refund wasn't found.");
      if (!["APPROVED", "FAILED"].includes(refund.status)) throw new AppError(409, "CONFLICT", "Only an approved refund can be marked as paid back.");
      if (refund.processedById === actor.userId && refund.requestedById === actor.userId) throw new AppError(403, "FORBIDDEN", "You can't complete your own refund.");
      await finalize(refundId, actor, gatewayRefundId);
      return view(await prisma.refundRecord.findUniqueOrThrow({ where: { id: refundId } }));
    },
  };
}

export type RefundService = ReturnType<typeof createRefundService>;
