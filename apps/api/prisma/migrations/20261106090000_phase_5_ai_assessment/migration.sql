-- Phase 5: AI assessment, tutor, consent and human calibration. Every change adds to the schema, and no existing data changes.

CREATE TYPE "ConsentType" AS ENUM ('AI_PROCESSING', 'SPEECH_PROCESSING', 'CALIBRATION_USE');
CREATE TYPE "CalibrationSampleStatus" AS ENUM ('NEEDS_MARKS', 'NEEDS_ADJUDICATION', 'APPROVED');

CREATE TABLE "user_consents" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "type" "ConsentType" NOT NULL,
  "version" TEXT NOT NULL,
  "granted_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_consents_user_id_type_key" ON "user_consents"("user_id", "type");

CREATE TABLE "tutor_conversations" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "tutor_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tutor_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "tutor_conversations_user_id_updated_at_idx" ON "tutor_conversations"("user_id", "updated_at" DESC);

CREATE TABLE "tutor_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "content" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "tutor_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tutor_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "tutor_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tutor_messages_role_valid" CHECK ("role" IN ('user', 'assistant'))
);
CREATE INDEX "tutor_messages_conversation_id_created_at_idx" ON "tutor_messages"("conversation_id", "created_at");

CREATE TABLE "calibration_datasets" (
  "id" UUID NOT NULL,
  "version" TEXT NOT NULL,
  "skill" "Skill" NOT NULL,
  "exam_type" "ExamType",
  "task_type" "WritingTaskType",
  "description" TEXT,
  "mark_tolerance" DECIMAL(2,1) NOT NULL DEFAULT 0.5,
  "target_samples" INTEGER NOT NULL DEFAULT 200,
  "target_mae" DECIMAL(3,2) NOT NULL DEFAULT 0.50,
  "target_within_one" DECIMAL(3,2) NOT NULL DEFAULT 0.90,
  "thresholds_approved_by_id" UUID,
  "thresholds_approved_at" TIMESTAMPTZ(3),
  "frozen_at" TIMESTAMPTZ(3),
  "frozen_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calibration_datasets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calibration_datasets_thresholds_approved_by_id_fkey" FOREIGN KEY ("thresholds_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calibration_datasets_frozen_by_id_fkey" FOREIGN KEY ("frozen_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calibration_datasets_writing_is_separated" CHECK ("skill" <> 'WRITING' OR ("exam_type" IS NOT NULL AND "task_type" IS NOT NULL))
);
CREATE UNIQUE INDEX "calibration_datasets_version_key" ON "calibration_datasets"("version");

CREATE TABLE "calibration_samples" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "split" "CalibrationSplit" NOT NULL,
  "prompt" TEXT NOT NULL,
  "response_text" TEXT NOT NULL,
  "consent_version" TEXT NOT NULL,
  "deidentified_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "CalibrationSampleStatus" NOT NULL DEFAULT 'NEEDS_MARKS',
  "final_band" DECIMAL(2,1),
  "final_criterion_bands" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calibration_samples_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calibration_samples_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "calibration_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "calibration_samples_dataset_id_reference_key" ON "calibration_samples"("dataset_id", "reference");
CREATE INDEX "calibration_samples_dataset_id_status_idx" ON "calibration_samples"("dataset_id", "status");

CREATE TABLE "calibration_runs" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "split" "CalibrationSplit" NOT NULL,
  "task_key" TEXT NOT NULL,
  "model_configuration_id" UUID,
  "prompt_version_id" UUID,
  "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
  "metrics" JSONB,
  "error_message" TEXT,
  "created_by_id" UUID,
  "instructor_approved_by_id" UUID,
  "instructor_approved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calibration_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calibration_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "calibration_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "calibration_runs_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "ai_model_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calibration_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calibration_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calibration_runs_instructor_approved_by_id_fkey" FOREIGN KEY ("instructor_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "calibration_runs_dataset_id_created_at_idx" ON "calibration_runs"("dataset_id", "created_at" DESC);

-- A release covers one exact model, prompt, exam type and task. Anything else stays closed.
CREATE TABLE "band_releases" (
  "id" UUID NOT NULL,
  "model_configuration_id" UUID NOT NULL,
  "prompt_version_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "exam_type" "ExamType" NOT NULL,
  "task_type" "WritingTaskType" NOT NULL,
  "visibility" "BandVisibility" NOT NULL,
  "approved_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "band_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "band_releases_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "ai_model_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "band_releases_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "band_releases_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "calibration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "band_releases_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "band_releases_scope_key" ON "band_releases"("model_configuration_id", "prompt_version_id", "exam_type", "task_type");

ALTER TABLE "assessment_calibration_records" ADD COLUMN "sample_id" UUID;
ALTER TABLE "assessment_calibration_records" ADD COLUMN "run_id" UUID;
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "assessment_calibration_records_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "calibration_samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "assessment_calibration_records_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "calibration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "assessment_calibration_records_sample_id_idx" ON "assessment_calibration_records"("sample_id");
CREATE INDEX "assessment_calibration_records_run_id_idx" ON "assessment_calibration_records"("run_id");

-- Independent marking: one mark per marker, one adjudication and one prediction per run for each sample.
CREATE UNIQUE INDEX "calibration_samples_one_mark_per_marker" ON "assessment_calibration_records" ("sample_id", "marker_id") WHERE "record_type" = 'HUMAN_MARK';
CREATE UNIQUE INDEX "calibration_samples_one_adjudication" ON "assessment_calibration_records" ("sample_id") WHERE "record_type" = 'ADJUDICATION';
CREATE UNIQUE INDEX "calibration_samples_one_prediction_per_run" ON "assessment_calibration_records" ("sample_id", "run_id") WHERE "record_type" = 'AI_PREDICTION';

-- Records when a recording's file was removed, while its text and history stay.
ALTER TABLE "speaking_submissions" ADD COLUMN "audio_deleted_at" TIMESTAMPTZ(3);

-- A frozen dataset can't change, whatever code tries to do.
CREATE FUNCTION protect_frozen_calibration_sample() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dataset uuid;
BEGIN
  dataset := CASE WHEN TG_OP = 'DELETE' THEN OLD."dataset_id" ELSE NEW."dataset_id" END;
  IF EXISTS (SELECT 1 FROM "calibration_datasets" WHERE "id" = dataset AND "frozen_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'Calibration dataset % is frozen and cannot be changed.', dataset;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calibration_samples_protect_frozen BEFORE INSERT OR UPDATE OR DELETE ON "calibration_samples"
  FOR EACH ROW EXECUTE FUNCTION protect_frozen_calibration_sample();
