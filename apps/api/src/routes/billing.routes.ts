import {
  checkoutSchema,
  gatewayUpdateSchema,
  packageInputSchema,
  packageUpdateSchema,
  pageQuerySchema,
  refundDecisionSchema,
  refundQuerySchema,
  refundRequestSchema,
  revenueQuerySchema,
  supportedCurrencies,
  transactionQuerySchema,
} from "@ieltiva/shared";
import express, { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requirePermission } from "../middleware/authenticate.js";
import { userRateLimit } from "../middleware/rate-limit.js";
import { readFields } from "../services/billing/payment.service.js";
import type { BillingRuntime } from "../services/billing/runtime.js";
import type { Actor } from "../types/platform.js";
import { sendPage, sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import type { Logger } from "../utils/logger.js";

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const uuid = z.uuid("Invalid identifier.");
const param = (req: Request, name: string) => uuid.parse(req.params[name]);
const code = (req: Request, name: string) => z.string().regex(/^[a-z0-9_-]{2,40}$/).parse(req.params[name]);

const checkoutLimit = userRateLimit("checkout", 60_000, 10, "Too many payment attempts. Please wait a moment.");

/** Student and administrator billing endpoints. They sit behind the normal sign-in. */
export function createBillingRouter({ packages, payments, refunds, entitlements, revenue }: BillingRuntime) {
  const r = Router();
  const read = requirePermission("payments.read");
  const manage = requirePermission("payments.manage");
  const decide = requirePermission("refunds.manage");
  const gateways = requirePermission("gateways.manage");

  // Students
  r.get("/packages", async (_req, res) => sendSuccess(res, "Packages", await packages.listPublic()));
  r.get("/packages/:id", async (req, res) => sendSuccess(res, "Package", await packages.getPublic(param(req, "id"))));
  r.get("/billing/gateways", async (req, res) => {
    const currency = z.enum(supportedCurrencies).optional().parse(req.query.currency);
    sendSuccess(res, "Payment methods", await payments.availableGateways(currency));
  });
  r.post("/billing/checkout", checkoutLimit, async (req, res) => sendSuccess(res, "Payment started", await payments.checkout(actorOf(req), checkoutSchema.parse(req.body)), 201));
  r.get("/billing/payments/:reference/status", async (req, res) => sendSuccess(res, "Payment status", await payments.status(actorOf(req), z.string().regex(/^IELT[0-9a-f]{20}$/).parse(req.params.reference))));
  r.get("/billing/purchases", async (req, res) => sendPage(res, "Purchases", await payments.history(actorOf(req), pageQuerySchema.parse(req.query))));
  r.get("/billing/credits", async (req, res) => sendSuccess(res, "Credits", await entitlements.balance(actorOf(req).userId)));
  r.get("/billing/credits/history", async (req, res) => sendPage(res, "Credit history", await entitlements.history(actorOf(req).userId, pageQuerySchema.parse(req.query))));
  r.get("/billing/refunds", async (req, res) => sendSuccess(res, "Refunds", await refunds.mine(actorOf(req))));
  r.post("/billing/refunds", checkoutLimit, async (req, res) => sendSuccess(res, "Refund requested", await refunds.request(actorOf(req), refundRequestSchema.parse(req.body)), 201));

  // Packages and pricing
  r.get("/admin/packages", read, async (_req, res) => sendSuccess(res, "Packages", await packages.listAdmin()));
  r.post("/admin/packages", manage, async (req, res) => sendSuccess(res, "Package created", await packages.create(actorOf(req), packageInputSchema.parse(req.body)), 201));
  r.patch("/admin/packages/:id", manage, async (req, res) => sendSuccess(res, "Package updated", await packages.update(actorOf(req), param(req, "id"), packageUpdateSchema.parse(req.body))));
  r.delete("/admin/packages/:id", manage, async (req, res) => {
    await packages.archive(actorOf(req), param(req, "id"));
    sendSuccess(res, "Package archived", null);
  });

  // Transactions, refunds and revenue
  r.get("/admin/transactions", read, async (req, res) => sendPage(res, "Transactions", await payments.listTransactions(transactionQuerySchema.parse(req.query))));
  r.post("/admin/transactions/:id/recheck", manage, async (req, res) => sendSuccess(res, "Payment checked", await payments.recheck(actorOf(req), param(req, "id"))));
  r.get("/admin/refunds", read, async (req, res) => sendPage(res, "Refunds", await refunds.list(refundQuerySchema.parse(req.query))));
  r.post("/admin/refunds/:id/decision", decide, async (req, res) => sendSuccess(res, "Refund decision saved", await refunds.decide(actorOf(req), param(req, "id"), refundDecisionSchema.parse(req.body))));
  r.post("/admin/refunds/:id/send", decide, async (req, res) => sendSuccess(res, "Refund sent", await refunds.send(actorOf(req), param(req, "id"))));
  r.post("/admin/refunds/:id/complete", decide, async (req, res) => {
    const { gatewayRefundId } = z.strictObject({ gatewayRefundId: z.string().trim().min(3).max(120) }).parse(req.body);
    sendSuccess(res, "Refund completed", await refunds.markCompleted(actorOf(req), param(req, "id"), gatewayRefundId));
  });
  r.get("/admin/revenue", read, async (req, res) => sendSuccess(res, "Revenue", await revenue.summary(revenueQuerySchema.parse(req.query))));

  // Gateways
  r.get("/admin/gateways", gateways, async (_req, res) => sendSuccess(res, "Gateways", await payments.listGateways()));
  r.patch("/admin/gateways/:code", gateways, async (req, res) => sendSuccess(res, "Gateway updated", await payments.updateGateway(actorOf(req), code(req, "code"), gatewayUpdateSchema.parse(req.body))));

  return r;
}

const callbackLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => void res.status(429).end(),
});

/**
 * Gateway callbacks. They have no sign-in or CSRF token because gateways can't send one, so they never
 * trust their input: a return page only re-checks the payment with the gateway, and a notification must pass the
 * gateway's own signature check where one exists. Bodies are read raw, because signatures cover the exact bytes.
 */
export function createPaymentCallbackRouter({ payments }: Pick<BillingRuntime, "payments">, logger: Pick<Logger, "warn" | "error">, frontendUrl: string) {
  const r = Router();
  r.use(callbackLimit, express.raw({ type: () => true, limit: "256kb" }));

  r.post("/webhooks/:gateway", async (req, res) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await payments.handleNotification(code(req, "gateway"), req.headers as Record<string, string | undefined>, raw);
      res.status(200).json({ received: true, outcome: result.outcome });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.status).json({ received: false });
        return;
      }
      logger.error({ err: error }, "Payment notification failed");
      // A server error asks the gateway to send the message again later.
      res.status(500).json({ received: false });
    }
  });

  const back: express.RequestHandler = async (req, res) => {
    const outcome = z.enum(["success", "fail", "cancel"]).safeParse(req.params.outcome);
    const reference = typeof req.query.ref === "string" ? req.query.ref : undefined;
    const fields = Buffer.isBuffer(req.body) && req.body.length ? readFields(req.body, req.headers["content-type"]) : {};
    try {
      const target = await payments.handleReturn(code(req, "gateway"), outcome.success ? outcome.data : "fail", reference, fields);
      res.redirect(303, target);
    } catch (error) {
      logger.error({ err: error }, "Payment return failed");
      res.redirect(303, `${frontendUrl}/billing`);
    }
  };
  r.get("/return/:gateway/:outcome", back);
  r.post("/return/:gateway/:outcome", back);
  return r;
}
