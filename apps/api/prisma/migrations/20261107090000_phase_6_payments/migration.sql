-- CreateEnum
CREATE TYPE "PackageCategory" AS ENUM ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'FULL_PREPARATION', 'MOCK_TEST', 'CUSTOM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RefundStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "RefundStatus" ADD VALUE 'APPROVED';
ALTER TYPE "RefundStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "verified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "refund_records" ADD COLUMN     "decided_at" TIMESTAMPTZ(3),
ADD COLUMN     "decision_note" TEXT,
ADD COLUMN     "requested_by_id" UUID;

-- AlterTable
ALTER TABLE "user_entitlements" ADD COLUMN     "package_id" UUID;

-- AlterTable
ALTER TABLE "user_purchases" ADD COLUMN     "package_id" UUID,
ADD COLUMN     "refunded_minor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "PackageCategory" NOT NULL,
    "validity_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_prices" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "package_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_features" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "quantity" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "gateway_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "outcome" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packages_code_key" ON "packages"("code");

-- CreateIndex
CREATE INDEX "packages_is_active_sort_order_idx" ON "packages"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "package_prices_package_id_currency_key" ON "package_prices"("package_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "package_features_package_id_feature_key_key" ON "package_features"("package_id", "feature_key");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "credit_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_ledger_entitlement_id_idx" ON "credit_ledger"("entitlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_user_id_feature_key_ref_type_ref_id_key" ON "credit_ledger"("user_id", "feature_key", "ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_received_at_idx" ON "payment_webhook_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_gateway_id_event_key_key" ON "payment_webhook_events"("gateway_id", "event_key");

-- CreateIndex
CREATE INDEX "refund_records_status_created_at_idx" ON "refund_records"("status", "created_at");

-- CreateIndex
CREATE INDEX "user_entitlements_package_id_idx" ON "user_entitlements"("package_id");

-- CreateIndex
CREATE INDEX "user_purchases_package_id_idx" ON "user_purchases"("package_id");

-- AddForeignKey
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_prices" ADD CONSTRAINT "package_prices_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_features" ADD CONSTRAINT "package_features_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "user_entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "payment_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Money and credit safety rules, enforced by the database as well as the application.
ALTER TABLE "package_prices" ADD CONSTRAINT "package_prices_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "package_features" ADD CONSTRAINT "package_features_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" > 0);
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_refund_within_amount" CHECK ("refunded_minor" >= 0 AND "refunded_minor" <= "amount_minor");
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_credits_within_grant" CHECK ("credits_granted" IS NULL OR ("credits_used" >= 0 AND "credits_reserved" >= 0 AND "credits_used" + "credits_reserved" <= "credits_granted"));

-- AlterTable
ALTER TABLE "ai_assessment_jobs" ADD COLUMN "credit_ref" TEXT;
