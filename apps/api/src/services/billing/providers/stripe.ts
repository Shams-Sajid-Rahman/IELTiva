import { createHmac } from "node:crypto";
import { isSupportedCurrency, type Currency } from "@ieltiva/shared";
import { safeEqual } from "../../../utils/crypto.js";
import {
  asObject,
  asString,
  PaymentProviderError,
  providerRequest,
  type NotificationInput,
  type PaymentProvider,
  type PaymentSession,
  type SessionRequest,
  type VerifiedPayment,
} from "../provider.js";

/**
 * Stripe Checkout, included to show that an international gateway fits the same interface.
 * It calls the REST API directly and doesn't add a dependency. Only test keys (sk_test_) are accepted in sandbox mode.
 * Written from the API as known when this was built and not re-checked against Stripe's current reference.
 */
type Config = { secretKey: string | undefined; webhookSecret: string | undefined; sandbox: boolean };

const API = "https://api.stripe.com/v1";
/** Messages older than this are refused, which limits how long a captured message could be replayed. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function createStripeProvider({ secretKey, webhookSecret, sandbox }: Config): PaymentProvider {
  const keyUsable = Boolean(secretKey && (sandbox ? secretKey.startsWith("sk_test_") : secretKey.startsWith("sk_live_")));
  const auth = () => {
    if (!secretKey || !keyUsable) throw new PaymentProviderError("Stripe isn't configured for this mode.", "NOT_CONFIGURED");
    return { authorization: `Bearer ${secretKey}` };
  };

  return {
    code: "stripe",
    displayName: "Stripe",
    currencies: ["USD", "EUR", "GBP"] satisfies Currency[],
    isConfigured: () => keyUsable && Boolean(webhookSecret),

    async createSession(request: SessionRequest): Promise<PaymentSession> {
      const form = new URLSearchParams({
        mode: "payment",
        client_reference_id: request.trackingId,
        "metadata[tracking_id]": request.trackingId,
        customer_email: request.customer.email,
        success_url: request.returnUrls.success,
        cancel_url: request.returnUrls.cancel,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": request.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(request.amountMinor),
        "line_items[0][price_data][product_data][name]": request.description.slice(0, 120),
        expires_at: String(Math.floor(Date.now() / 1000) + 3600),
      });
      const body = asObject(
        await providerRequest(`${API}/checkout/sessions`, {
          method: "POST",
          headers: { ...auth(), "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.trackingId },
          body: form,
        }),
      );
      const url = asString(body.url);
      if (!url || !asString(body.id)) throw new PaymentProviderError("The payment page couldn't be opened.", "REJECTED");
      const target = new URL(url);
      if (target.protocol !== "https:" || !target.hostname.endsWith("stripe.com")) throw new PaymentProviderError("The payment service sent an unexpected address.", "REJECTED");
      return { redirectUrl: target.toString(), reference: asString(body.id) };
    },

    async verify({ trackingId, reference }): Promise<VerifiedPayment> {
      if (!reference) return { state: "PENDING", trackingId, amountMinor: null, currency: null, summary: { note: "no session reference" } };
      const body = asObject(await providerRequest(`${API}/checkout/sessions/${encodeURIComponent(reference)}`, { headers: auth() }));
      const currency = (asString(body.currency) ?? "").toUpperCase();
      const paid = asString(body.payment_status) === "paid";
      const expired = asString(body.status) === "expired";
      return {
        state: paid ? "SUCCEEDED" : expired ? "CANCELED" : "PENDING",
        trackingId: asString(body.client_reference_id) ?? null,
        gatewayTransactionId: asString(body.payment_intent),
        amountMinor: typeof body.amount_total === "number" && Number.isSafeInteger(body.amount_total) ? body.amount_total : null,
        currency: isSupportedCurrency(currency) ? currency : null,
        reason: paid ? undefined : (asString(body.payment_status) ?? "unpaid"),
        summary: { paymentStatus: asString(body.payment_status) ?? null, sessionStatus: asString(body.status) ?? null },
      };
    },

    parseNotification({ headers, rawBody }: NotificationInput) {
      if (!webhookSecret) throw new PaymentProviderError("Stripe isn't configured.", "NOT_CONFIGURED");
      const header = headers["stripe-signature"] ?? "";
      const parts = new Map(header.split(",").map((piece) => piece.split("=", 2) as [string, string]));
      const timestamp = Number(parts.get("t"));
      // Stripe may send several v1 signatures during a secret rotation, so each one is checked.
      const signatures = header.split(",").filter((piece) => piece.startsWith("v1=")).map((piece) => piece.slice(3));
      const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
      const fresh = Number.isFinite(timestamp) && Math.abs(Date.now() / 1000 - timestamp) <= SIGNATURE_TOLERANCE_SECONDS;
      if (!fresh || !signatures.some((signature) => safeEqual(signature, expected))) {
        throw new PaymentProviderError("The notification signature was wrong.", "BAD_SIGNATURE");
      }
      const event = asObject(JSON.parse(rawBody.toString("utf8")));
      const type = asString(event.type) ?? "";
      if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(type)) return null;
      const object = asObject(asObject(event.data).object);
      const trackingId = asString(object.client_reference_id);
      const eventId = asString(event.id);
      if (!trackingId || !eventId) return null;
      const hint: Record<string, string> = {};
      const session = asString(object.id);
      if (session) hint.session = session;
      return { trackingId, eventKey: eventId, hint };
    },

    async refund({ gatewayTransactionId, amountMinor, refundKey, reason }) {
      const body = asObject(
        await providerRequest(`${API}/refunds`, {
          method: "POST",
          headers: { ...auth(), "content-type": "application/x-www-form-urlencoded", "idempotency-key": refundKey },
          body: new URLSearchParams({ payment_intent: gatewayTransactionId, amount: String(amountMinor), reason: "requested_by_customer", "metadata[note]": reason.slice(0, 200) }),
        }),
      );
      const status = asString(body.status);
      const refundId = asString(body.id) ?? refundKey;
      if (status === "succeeded") return { state: "COMPLETED", refundId };
      return status === "pending" ? { state: "PROCESSING", refundId } : { state: "FAILED", refundId, reason: asString(asObject(body.error).message) ?? status };
    },
  };
}
