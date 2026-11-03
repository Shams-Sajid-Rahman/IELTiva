import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

// ---------- Money ----------
// Money is always a whole number of the smallest unit (for example paisa or cents). It is never a float.

export const supportedCurrencies = ["BDT", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof supportedCurrencies)[number];

/** All supported currencies use two decimal places. Add an entry here before supporting any other kind. */
export const currencyExponent: Record<Currency, number> = { BDT: 2, USD: 2, EUR: 2, GBP: 2 };

/** The largest price allowed, which also keeps every sum inside a safe whole-number range. */
export const MAX_PRICE_MINOR = 100_000_000;

/** Converts "1250.50" into 125050 using string maths only. Returns null for anything that isn't a plain decimal. */
export function parseMajorToMinor(value: string | number, currency: Currency): number | null {
  const exponent = currencyExponent[currency];
  const match = /^(\d{1,12})(?:\.(\d{1,12}))?$/.exec(String(value).trim());
  if (!match) return null;
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  // Extra digits are only accepted when they are all zero, so nothing is silently rounded.
  if (/[^0]/.test(fraction.slice(exponent))) return null;
  const minor = Number(whole + fraction.slice(0, exponent).padEnd(exponent, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Converts 125050 into "1250.50" using integer maths only. */
export function minorToMajor(minor: number, currency: Currency): string {
  const exponent = currencyExponent[currency];
  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function isSupportedCurrency(value: string): value is Currency {
  return (supportedCurrencies as readonly string[]).includes(value);
}

// ---------- Packages ----------

export const packageCategories = ["LISTENING", "READING", "WRITING", "SPEAKING", "FULL_PREPARATION", "MOCK_TEST", "CUSTOM"] as const;

/** What a package can include. A quantity of null means unlimited use while the package is valid. */
export const featureKeys = ["listening_tests", "reading_tests", "mock_tests", "writing_assessments", "speaking_assessments"] as const;
export type FeatureKey = (typeof featureKeys)[number];

export const packageFeatureSchema = z.strictObject({
  featureKey: z.enum(featureKeys),
  quantity: z.number().int().min(1).max(100_000).nullable(),
});

export const packagePriceSchema = z.strictObject({
  currency: z.enum(supportedCurrencies),
  amountMinor: z.number().int().min(100, "The price is too low.").max(MAX_PRICE_MINOR, "The price is too high."),
  isActive: z.boolean().default(true),
});

export const packageInputSchema = z.strictObject({
  code: text(60)
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens."),
  name: text(120).min(2, "Enter a name."),
  description: text(2_000).nullable().optional(),
  category: z.enum(packageCategories),
  validityDays: z.number().int().min(1).max(3650).nullable(),
  isActive: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  features: z.array(packageFeatureSchema).min(1, "Include at least one feature.").max(10),
  prices: z.array(packagePriceSchema).min(1, "Add at least one price.").max(supportedCurrencies.length),
});
export const packageUpdateSchema = packageInputSchema.partial().refine((value) => Object.keys(value).length > 0, "Nothing to update.");

// ---------- Checkout and payments ----------

export const checkoutSchema = z.strictObject({
  packageId: z.uuid(),
  currency: z.enum(supportedCurrencies),
  gateway: text(40).min(2),
  // Sent by the browser so a double click or a retry can't create two payments.
  idempotencyKey: z.uuid(),
});

export const refundRequestSchema = z.strictObject({
  purchaseId: z.uuid(),
  reason: text(1_000).min(10, "Please tell us why you need a refund."),
});

export const refundDecisionSchema = z.strictObject({
  decision: z.enum(["APPROVE", "REJECT"]),
  /** Defaults to the full amount that hasn't been refunded yet. */
  amountMinor: z.number().int().min(1).max(MAX_PRICE_MINOR).optional(),
  note: text(1_000).nullable().optional(),
});

export const gatewayUpdateSchema = z.strictObject({
  name: text(80).min(2).optional(),
  isEnabled: z.boolean().optional(),
  regionCodes: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$|^GLOBAL$/)).max(50).optional(),
  currencies: z.array(z.enum(supportedCurrencies)).max(supportedCurrencies.length).optional(),
});

export const paymentStatuses = ["PENDING", "SUCCEEDED", "FAILED", "CANCELED", "REFUNDED"] as const;

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(paymentStatuses).optional(),
  gateway: text(40).optional(),
  search: text(100).optional(),
});

export const refundQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "PENDING", "COMPLETED", "FAILED"]).optional(),
});

export const revenueQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  currency: z.enum(supportedCurrencies).optional(),
});
