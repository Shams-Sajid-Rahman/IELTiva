-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('PROGRESS_REPORT', 'DATA_EXPORT');

-- AlterTable
ALTER TABLE "learning_resources" ADD COLUMN     "file_bytes" INTEGER,
ADD COLUMN     "file_content_type" TEXT,
ADD COLUMN     "file_name" TEXT;

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "content_type" TEXT,
    "file_name" TEXT,
    "byte_size" INTEGER,
    "error_message" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_events" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "bucket_start" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_reports_user_id_created_at_idx" ON "generated_reports"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "generated_reports_expires_at_idx" ON "generated_reports"("expires_at");

-- CreateIndex
CREATE INDEX "operational_events_bucket_start_idx" ON "operational_events"("bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "operational_events_source_code_bucket_start_key" ON "operational_events"("source", "code", "bucket_start");

-- CreateIndex
CREATE INDEX "section_attempts_submitted_at_idx" ON "section_attempts"("submitted_at");

-- CreateIndex
CREATE INDEX "user_profiles_reminders_enabled_idx" ON "user_profiles"("reminders_enabled");

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Payment safety rules enforced by the database, whatever the application does.
-- A purchase can only ever have one successful payment, so it can't be fulfilled twice.
CREATE UNIQUE INDEX "payment_transactions_one_success_per_purchase" ON "payment_transactions"("purchase_id") WHERE "status" IN ('SUCCEEDED', 'REFUNDED');
-- A purchase can only have one refund being worked on at a time.
CREATE UNIQUE INDEX "refund_records_one_open_per_purchase" ON "refund_records"("purchase_id") WHERE "status" IN ('REQUESTED', 'APPROVED');

CREATE FUNCTION protect_payment_state() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('SUCCEEDED', 'REFUNDED') AND NEW."status" NOT IN ('SUCCEEDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'A confirmed payment cannot go back to %', NEW."status";
  END IF;
  IF OLD."status" = 'REFUNDED' AND NEW."status" <> 'REFUNDED' THEN
    RAISE EXCEPTION 'A refunded payment cannot change status';
  END IF;
  IF NEW."status" = 'REFUNDED' AND OLD."status" NOT IN ('SUCCEEDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'Only a confirmed payment can be refunded';
  END IF;
  -- Success needs a gateway check on record, so no code path can mark a payment paid without one.
  IF NEW."status" = 'SUCCEEDED' AND NEW."verified_at" IS NULL THEN
    RAISE EXCEPTION 'A payment cannot succeed without server-side verification';
  END IF;
  IF NEW."amount_minor" <> OLD."amount_minor" OR NEW."currency" <> OLD."currency" THEN
    RAISE EXCEPTION 'A payment amount cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_state_guard BEFORE UPDATE ON "payment_transactions"
  FOR EACH ROW EXECUTE FUNCTION protect_payment_state();
