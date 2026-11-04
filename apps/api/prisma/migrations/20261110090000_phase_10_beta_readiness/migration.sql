-- CreateEnum
CREATE TYPE "InstructorReviewStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BetaAccessStatus" AS ENUM ('ALLOWED', 'REVOKED');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'TRIAGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED');

-- AlterEnum
ALTER TYPE "PublicationAction" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "calibration_samples" ADD COLUMN     "audio_storage_key" TEXT;

-- AlterTable
ALTER TABLE "exam_versions" ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "instructor_reviews" (
    "id" UUID NOT NULL,
    "writing_submission_id" UUID,
    "speaking_submission_id" UUID,
    "requested_by_id" UUID,
    "reviewer_id" UUID,
    "status" "InstructorReviewStatus" NOT NULL DEFAULT 'REQUESTED',
    "overall_band" DECIMAL(2,1),
    "criterion_bands" JSONB,
    "note" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instructor_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "beta_access" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "BetaAccessStatus" NOT NULL DEFAULT 'ALLOWED',
    "note" TEXT,
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "beta_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beta_feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "page" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "staff_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "beta_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "personal_data_affected" BOOLEAN NOT NULL DEFAULT false,
    "payments_affected" BOOLEAN NOT NULL DEFAULT false,
    "opened_by_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_updates" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "author_id" UUID,
    "status" "IncidentStatus",
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instructor_reviews_writing_submission_id_key" ON "instructor_reviews"("writing_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_reviews_speaking_submission_id_key" ON "instructor_reviews"("speaking_submission_id");

-- CreateIndex
CREATE INDEX "instructor_reviews_status_requested_at_idx" ON "instructor_reviews"("status", "requested_at");

-- CreateIndex
CREATE INDEX "instructor_reviews_requested_by_id_requested_at_idx" ON "instructor_reviews"("requested_by_id", "requested_at");

-- CreateIndex
CREATE INDEX "instructor_reviews_reviewer_id_idx" ON "instructor_reviews"("reviewer_id");

-- CreateIndex
CREATE INDEX "feature_flags_updated_by_id_idx" ON "feature_flags"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "beta_access_email_key" ON "beta_access"("email");

-- CreateIndex
CREATE INDEX "beta_access_added_by_id_idx" ON "beta_access"("added_by_id");

-- CreateIndex
CREATE INDEX "beta_feedback_status_created_at_idx" ON "beta_feedback"("status", "created_at");

-- CreateIndex
CREATE INDEX "beta_feedback_user_id_idx" ON "beta_feedback"("user_id");

-- CreateIndex
CREATE INDEX "incidents_status_started_at_idx" ON "incidents"("status", "started_at");

-- CreateIndex
CREATE INDEX "incidents_opened_by_id_idx" ON "incidents"("opened_by_id");

-- CreateIndex
CREATE INDEX "incident_updates_incident_id_created_at_idx" ON "incident_updates"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "incident_updates_author_id_idx" ON "incident_updates"("author_id");

-- AddForeignKey
ALTER TABLE "instructor_reviews" ADD CONSTRAINT "instructor_reviews_writing_submission_id_fkey" FOREIGN KEY ("writing_submission_id") REFERENCES "writing_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_reviews" ADD CONSTRAINT "instructor_reviews_speaking_submission_id_fkey" FOREIGN KEY ("speaking_submission_id") REFERENCES "speaking_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_reviews" ADD CONSTRAINT "instructor_reviews_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_reviews" ADD CONSTRAINT "instructor_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beta_access" ADD CONSTRAINT "beta_access_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beta_feedback" ADD CONSTRAINT "beta_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A review belongs to exactly one piece of work.
ALTER TABLE "instructor_reviews" ADD CONSTRAINT "instructor_reviews_one_subject" CHECK (("writing_submission_id" IS NULL) <> ("speaking_submission_id" IS NULL));
