import { isSupportedCurrency, minorToMajor, parseMajorToMinor, type Currency } from "@ieltiva/shared";
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
 * aamarPay (Bangladesh). Written from aamarpay.readme.io: JSON initiation and the Search Transaction API.
 * aamarPay's notification page says messages are signed but doesn't publish how, so a notification here only
 * prompts a server-side lookup and is never trusted for its content. aamarPay documents no refund API.
 */
type Config = { storeId: string | undefined; signatureKey: string | undefined; sandbox: boolean };

const HOSTS = { sandbox: "https://sandbox.aamarpay.com", live: "https://secure.aamarpay.com" } as const;

export function createAamarpayProvider({ storeId, signatureKey, sandbox }: Config): PaymentProvider {
  const host = sandbox ? HOSTS.sandbox : HOSTS.live;
  const credentials = () => {
    if (!storeId || !signatureKey) throw new PaymentProviderError("aamarPay isn't configured.", "NOT_CONFIGURED");
    return { store_id: storeId, signature_key: signatureKey };
  };

  return {
    code: "aamarpay",
    displayName: "aamarPay",
    currencies: ["BDT", "USD"] satisfies Currency[],
    isConfigured: () => Boolean(storeId && signatureKey),

    async createSession(request: SessionRequest): Promise<PaymentSession> {
      const body = asObject(
        await providerRequest(`${host}/jsonpost.php`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...credentials(),
            tran_id: request.trackingId,
            amount: minorToMajor(request.amountMinor, request.currency),
            currency: request.currency,
            desc: request.description.slice(0, 200),
            cus_name: request.customer.name.slice(0, 50) || "Student",
            cus_email: request.customer.email,
            cus_phone: request.customer.phone || "00000000000",
            success_url: request.returnUrls.success,
            fail_url: request.returnUrls.fail,
            cancel_url: request.returnUrls.cancel,
            type: "json",
          }),
        }),
      );
      const url = asString(body.payment_url);
      if (asString(body.result) !== "true" || !url) throw new PaymentProviderError("The payment page couldn't be opened.", "REJECTED");
      const target = new URL(url);
      if (target.protocol !== "https:" || !target.hostname.endsWith("aamarpay.com")) throw new PaymentProviderError("The payment service sent an unexpected address.", "REJECTED");
      return { redirectUrl: target.toString() };
    },

    async verify({ trackingId }): Promise<VerifiedPayment> {
      const query = new URLSearchParams({ request_id: trackingId, ...credentials(), type: "json" });
      const body = asObject(await providerRequest(`${host}/api/v1/trxcheck/request.php?${query}`));
      const statusCode = asString(body.status_code);
      const payStatus = asString(body.pay_status) ?? "";
      const currency = asString(body.currency_merchant) ?? asString(body.currency) ?? null;
      const amountText = asString(body.amount);
      const amountMinor = currency && isSupportedCurrency(currency) && amountText ? parseMajorToMinor(amountText, currency) : null;
      // aamarPay documents 2 as success, 3 expired and 7 failed. Any other answer (including no record yet) stays pending.
      const state = statusCode === "2" && payStatus === "Successful" ? "SUCCEEDED" : statusCode === "7" || statusCode === "3" ? "FAILED" : "PENDING";
      return {
        state,
        trackingId: asString(body.mer_txnid) ?? null,
        gatewayTransactionId: asString(body.pg_txnid),
        amountMinor,
        currency,
        reason: state === "SUCCEEDED" ? undefined : payStatus || "not_paid",
        summary: { payStatus, statusCode: statusCode ?? null, verifyStatus: asString(body.verify_status) ?? null },
      };
    },

    parseNotification({ fields }: NotificationInput) {
      const trackingId = fields.mer_txnid;
      if (!trackingId) return null;
      return { trackingId, eventKey: `${trackingId}:${fields.pg_txnid ?? fields.status_code ?? "none"}`, hint: {} };
    },

    refund: null,
  };
}
