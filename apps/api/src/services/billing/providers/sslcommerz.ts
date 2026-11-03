import { createHash } from "node:crypto";
import { isSupportedCurrency, minorToMajor, parseMajorToMinor, type Currency } from "@ieltiva/shared";
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
 * SSLCOMMERZ (Bangladesh). Written from the v4 session, validation and refund documentation
 * at developer.sslcommerz.com. The sandbox is used unless live mode has been explicitly allowed.
 */
type Config = { storeId: string | undefined; storePassword: string | undefined; sandbox: boolean };

const HOSTS = { sandbox: "https://sandbox.sslcommerz.com", live: "https://securepay.sslcommerz.com" } as const;

export function createSslcommerzProvider({ storeId, storePassword, sandbox }: Config): PaymentProvider {
  const host = sandbox ? HOSTS.sandbox : HOSTS.live;
  const credentials = () => {
    if (!storeId || !storePassword) throw new PaymentProviderError("SSLCOMMERZ isn't configured.", "NOT_CONFIGURED");
    return { store_id: storeId, store_passwd: storePassword };
  };

  /** Confirms the amount and currency the gateway reports, whichever way it reports a converted payment. */
  function readAmount(body: Record<string, unknown>) {
    const reportedCurrency = asString(body.currency_type) ?? asString(body.currency);
    const reportedAmount = asString(body.currency_type) ? asString(body.currency_amount) : asString(body.amount);
    if (!reportedCurrency || !reportedAmount || !isSupportedCurrency(reportedCurrency)) return { currency: reportedCurrency ?? null, amountMinor: null };
    return { currency: reportedCurrency, amountMinor: parseMajorToMinor(reportedAmount, reportedCurrency) };
  }

  function toVerified(body: Record<string, unknown>): VerifiedPayment {
    const gatewayStatus = asString(body.status) ?? "";
    const { currency, amountMinor } = readAmount(body);
    const state = gatewayStatus === "VALID" || gatewayStatus === "VALIDATED" ? "SUCCEEDED" : gatewayStatus === "INVALID_TRANSACTION" || gatewayStatus === "FAILED" ? "FAILED" : "PENDING";
    return {
      state,
      trackingId: asString(body.tran_id) ?? null,
      gatewayTransactionId: asString(body.bank_tran_id),
      validationId: asString(body.val_id),
      amountMinor,
      currency,
      reason: state === "SUCCEEDED" ? undefined : gatewayStatus || "not_validated",
      summary: { gatewayStatus, riskLevel: asString(body.risk_level) ?? null, validatedOn: asString(body.tran_date) ?? asString(body.validated_on) ?? null },
    };
  }

  return {
    code: "sslcommerz",
    displayName: "SSLCOMMERZ",
    currencies: ["BDT", "USD"] satisfies Currency[],
    isConfigured: () => Boolean(storeId && storePassword),

    async createSession(request: SessionRequest): Promise<PaymentSession> {
      const form = new URLSearchParams({
        ...credentials(),
        total_amount: minorToMajor(request.amountMinor, request.currency),
        currency: request.currency,
        tran_id: request.trackingId,
        success_url: request.returnUrls.success,
        fail_url: request.returnUrls.fail,
        cancel_url: request.returnUrls.cancel,
        ipn_url: request.notificationUrl,
        shipping_method: "NO",
        product_name: request.description.slice(0, 100),
        product_category: "Education",
        product_profile: "non-physical-goods",
        cus_name: request.customer.name.slice(0, 50) || "Student",
        cus_email: request.customer.email,
        // The gateway insists on these. Only what the student already gave us is sent, and anything else is marked unknown.
        cus_add1: "Not provided",
        cus_city: "Not provided",
        cus_postcode: "0000",
        cus_country: "Bangladesh",
        cus_phone: request.customer.phone || "00000000000",
      });
      const body = asObject(await providerRequest(`${host}/gwprocess/v4/api.php`, { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } }));
      const url = asString(body.GatewayPageURL);
      if (asString(body.status) !== "SUCCESS" || !url) throw new PaymentProviderError("The payment page couldn't be opened.", "REJECTED");
      const target = new URL(url);
      // Only the gateway's own pages may receive a customer.
      if (target.protocol !== "https:" || !target.hostname.endsWith("sslcommerz.com")) throw new PaymentProviderError("The payment service sent an unexpected address.", "REJECTED");
      return { redirectUrl: target.toString(), reference: asString(body.sessionkey) };
    },

    async verify({ trackingId, hint }) {
      const creds = credentials();
      if (hint.val_id) {
        const query = new URLSearchParams({ val_id: hint.val_id, ...creds, format: "json" });
        return toVerified(asObject(await providerRequest(`${host}/validator/api/validationserverAPI.php?${query}`)));
      }
      // No validation ID (the customer closed the page early): ask by our own transaction ID instead.
      const query = new URLSearchParams({ tran_id: trackingId, ...creds, format: "json" });
      const body = asObject(await providerRequest(`${host}/validator/api/merchantTransIDvalidationAPI.php?${query}`));
      const rows = Array.isArray(body.element) ? body.element.map(asObject) : [];
      const paid = rows.find((row) => ["VALID", "VALIDATED"].includes(asString(row.status) ?? ""));
      return paid ? toVerified(paid) : { state: "PENDING", trackingId, amountMinor: null, currency: null, summary: { gatewayStatus: asString(rows[0]?.status) ?? "none" } };
    },

    parseNotification({ fields }: NotificationInput) {
      const trackingId = fields.tran_id;
      if (!trackingId || !storePassword) return null;
      // The notification is signed with an MD5 hash that the gateway defines. A bad hash is refused. A good one still
      // proves nothing about the payment, because the result is always read back from the validation API.
      if (fields.verify_sign && fields.verify_key) {
        const picked: Record<string, string> = {};
        for (const key of fields.verify_key.split(",")) if (key in fields) picked[key] = fields[key] ?? "";
        picked.store_passwd = createHash("md5").update(storePassword).digest("hex");
        const text = Object.keys(picked)
          .sort()
          .map((key) => `${key}=${picked[key]}`)
          .join("&");
        if (!safeEqual(createHash("md5").update(text).digest("hex"), fields.verify_sign.toLowerCase())) {
          throw new PaymentProviderError("The notification signature was wrong.", "BAD_SIGNATURE");
        }
      }
      const hint: Record<string, string> = {};
      if (fields.val_id) hint.val_id = fields.val_id;
      return { trackingId, eventKey: `${trackingId}:${fields.val_id ?? fields.status ?? "none"}`, hint };
    },

    async refund({ gatewayTransactionId, amountMinor, currency, refundKey, reason }) {
      const query = new URLSearchParams({
        bank_tran_id: gatewayTransactionId,
        refund_trans_id: refundKey,
        refund_amount: minorToMajor(amountMinor, currency),
        refund_remarks: reason.slice(0, 200),
        ...credentials(),
        format: "json",
      });
      const body = asObject(await providerRequest(`${host}/validator/api/merchantTransIDvalidationAPI.php?${query}`));
      const status = asString(body.status);
      const refundId = asString(body.refund_ref_id) ?? refundKey;
      if (asString(body.APIConnect) !== "DONE") return { state: "FAILED", refundId, reason: asString(body.errorReason) ?? asString(body.APIConnect) };
      if (status === "success") return { state: "COMPLETED", refundId };
      return status === "processing" ? { state: "PROCESSING", refundId } : { state: "FAILED", refundId, reason: asString(body.errorReason) };
    },
  };
}
