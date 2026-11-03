import type { Env } from "../../config/env.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Logger } from "../../utils/logger.js";
import type { Cache } from "../cache.js";
import { createEntitlementService } from "./entitlement.service.js";
import { createPackageService } from "./package.service.js";
import { createPaymentService } from "./payment.service.js";
import type { PaymentProvider } from "./provider.js";
import { createAamarpayProvider } from "./providers/aamarpay.js";
import { createSslcommerzProvider } from "./providers/sslcommerz.js";
import { createStripeProvider } from "./providers/stripe.js";
import { createRefundService } from "./refund.service.js";
import { createRevenueService } from "./revenue.service.js";

export type BillingEnv = Pick<Env, "API_BASE_URL" | "FRONTEND_URL" | "PAYMENT_ALLOW_LIVE" | "SSLCOMMERZ_STORE_ID" | "SSLCOMMERZ_STORE_PASSWORD" | "AAMARPAY_STORE_ID" | "AAMARPAY_SIGNATURE_KEY" | "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET">;

export const BILLING_OFF: BillingEnv = { API_BASE_URL: "http://localhost:5000", FRONTEND_URL: "http://localhost:3000", PAYMENT_ALLOW_LIVE: false, SSLCOMMERZ_STORE_ID: undefined, SSLCOMMERZ_STORE_PASSWORD: undefined, AAMARPAY_STORE_ID: undefined, AAMARPAY_SIGNATURE_KEY: undefined, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined };

type Notify = Parameters<typeof createPaymentService>[0]["notify"];

/** Wires billing together. A gateway without keys is still listed, but can't be switched on. */
export function createBillingRuntime({ prisma, env, logger, notify, cache }: { prisma: PrismaClient; env: BillingEnv; logger: Pick<Logger, "warn" | "error" | "info">; notify: Notify; cache?: Cache | undefined }) {
  const sandbox = !env.PAYMENT_ALLOW_LIVE;
  const providers = new Map<string, PaymentProvider>(
    [
      createSslcommerzProvider({ storeId: env.SSLCOMMERZ_STORE_ID, storePassword: env.SSLCOMMERZ_STORE_PASSWORD, sandbox }),
      createAamarpayProvider({ storeId: env.AAMARPAY_STORE_ID, signatureKey: env.AAMARPAY_SIGNATURE_KEY, sandbox }),
      createStripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, sandbox }),
    ].map((provider) => [provider.code, provider]),
  );
  const entitlements = createEntitlementService(prisma);
  const payments = createPaymentService({ prisma, providers, entitlements, notify, logger, urls: { api: env.API_BASE_URL, frontend: env.FRONTEND_URL }, allowLive: env.PAYMENT_ALLOW_LIVE });
  return {
    entitlements,
    payments,
    packages: createPackageService(prisma, cache),
    refunds: createRefundService({ prisma, providers, entitlements, notify }),
    revenue: createRevenueService(prisma),
  };
}

export type BillingRuntime = ReturnType<typeof createBillingRuntime>;
