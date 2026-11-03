import type { Currency } from "@ieltiva/shared";

/**
 * Everything a payment gateway has to do for IELTiva. Each gateway lives in its own file,
 * so adding or replacing one never touches checkout, fulfilment or refunds.
 */
export type SessionRequest = {
  trackingId: string;
  amountMinor: number;
  currency: Currency;
  description: string;
  customer: { name: string; email: string; phone?: string | undefined };
  /** Where the gateway sends the customer's browser. These pages only show a result and never decide one. */
  returnUrls: { success: string; fail: string; cancel: string };
  /** Where the gateway posts its own server-to-server notification. */
  notificationUrl: string;
};

export type PaymentSession = {
  redirectUrl: string;
  /** The gateway's own reference, kept so the payment can be looked up later. */
  reference?: string | undefined;
};

export type VerifiedPayment = {
  state: "SUCCEEDED" | "FAILED" | "PENDING" | "CANCELED";
  /** Our tracking ID as the gateway reports it. It must match the one we asked about. */
  trackingId: string | null;
  gatewayTransactionId?: string | undefined;
  validationId?: string | undefined;
  amountMinor: number | null;
  currency: string | null;
  reason?: string | undefined;
  /** A short, non-sensitive summary kept for support. Card details are never included. */
  summary: Record<string, string | number | boolean | null>;
};

export type Notification = {
  trackingId: string;
  /** Unique per gateway message, so a replay can be recognised. */
  eventKey: string;
  /** Extra values from the message that help the lookup. They are never used as the result. */
  hint: Record<string, string>;
};

export type RefundOutcome = { state: "COMPLETED" | "PROCESSING" | "FAILED"; refundId: string; reason?: string | undefined };

export type NotificationInput = { headers: Record<string, string | undefined>; rawBody: Buffer; fields: Record<string, string> };

export interface PaymentProvider {
  readonly code: string;
  readonly displayName: string;
  readonly currencies: readonly Currency[];
  /** Whether the secrets this gateway needs are present. Without them it can't be switched on. */
  isConfigured(): boolean;
  createSession(request: SessionRequest): Promise<PaymentSession>;
  /** Asks the gateway directly what happened. This is the only source of a payment result. */
  verify(input: { trackingId: string; reference?: string | undefined; hint: Record<string, string> }): Promise<VerifiedPayment>;
  /** Checks authenticity where the gateway signs its messages, and returns null for a message it can't use. Throws on a bad signature. */
  parseNotification(input: NotificationInput): Notification | null;
  /** Null when the gateway has no refund API, so the refund is completed by hand in its dashboard. */
  refund: ((input: { trackingId: string; gatewayTransactionId: string; amountMinor: number; currency: Currency; refundKey: string; reason: string }) => Promise<RefundOutcome>) | null;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "UNAVAILABLE" | "REJECTED" | "BAD_SIGNATURE" | "NOT_CONFIGURED",
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export const PROVIDER_TIMEOUT_MS = 15_000;

/** A single place for outgoing calls, so every gateway gets a timeout and none can follow a redirect somewhere unexpected. */
export async function providerRequest(url: string, init: RequestInit & { expect?: "json" | "text" } = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch {
    throw new PaymentProviderError("The payment service didn't respond.", "UNAVAILABLE");
  }
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    throw new PaymentProviderError("The payment service sent an unreadable answer.", "UNAVAILABLE");
  }
  if (!response.ok && response.status >= 500) throw new PaymentProviderError("The payment service had a problem.", "UNAVAILABLE");
  return Object.assign(parsed as object, { __status: response.status });
}

export type JsonObject = Record<string, unknown>;
export const asObject = (value: unknown): JsonObject => (value && typeof value === "object" ? (value as JsonObject) : {});
export const asString = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : undefined);
