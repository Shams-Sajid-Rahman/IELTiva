-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('ACADEMIC', 'GENERAL_TRAINING');

-- CreateEnum
CREATE TYPE "Skill" AS ENUM ('LISTENING', 'READING', 'WRITING', 'SPEAKING');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentProvenance" AS ENUM ('ORIGINAL', 'LICENSED', 'AI_ASSISTED_REVIEWED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('ARTICLE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'EXERCISE');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE_SINGLE', 'MULTIPLE_CHOICE_MULTI', 'TRUE_FALSE_NOT_GIVEN', 'YES_NO_NOT_GIVEN', 'MATCHING_GENERAL', 'MATCHING_HEADINGS', 'MATCHING_INFORMATION', 'MATCHING_FEATURES', 'MATCHING_SENTENCE_ENDINGS', 'SENTENCE_COMPLETION', 'SUMMARY_COMPLETION', 'NOTE_COMPLETION', 'TABLE_COMPLETION', 'FLOW_CHART_COMPLETION', 'FORM_COMPLETION', 'DIAGRAM_LABELLING', 'PLAN_LABELLING', 'MAP_LABELLING', 'SHORT_ANSWER');

-- CreateEnum
CREATE TYPE "WritingTaskType" AS ENUM ('ACADEMIC_TASK_1', 'GENERAL_TASK_1', 'TASK_2');

-- CreateEnum
CREATE TYPE "SpeakingPart" AS ENUM ('PART_1', 'PART_2', 'PART_3');

-- CreateEnum
CREATE TYPE "AttemptMode" AS ENUM ('PRACTICE', 'TIMED', 'MOCK');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssessmentCriterion" AS ENUM ('TASK_ACHIEVEMENT', 'TASK_RESPONSE', 'COHERENCE_COHESION', 'LEXICAL_RESOURCE', 'GRAMMATICAL_RANGE_ACCURACY', 'FLUENCY_COHERENCE', 'PRONUNCIATION');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('SUMMARY', 'STRENGTH', 'IMPROVEMENT', 'CORRECTION', 'PRONUNCIATION');

-- CreateEnum
CREATE TYPE "BandVisibility" AS ENUM ('HIDDEN', 'INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AITier" AS ENUM ('DEFAULT', 'COMPLEX', 'LIGHT');

-- CreateEnum
CREATE TYPE "CalibrationRecordType" AS ENUM ('HUMAN_MARK', 'ADJUDICATION', 'AI_PREDICTION');

-- CreateEnum
CREATE TYPE "CalibrationSplit" AS ENUM ('TUNING', 'VALIDATION', 'TEST');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'LEARNING', 'ASSESSMENT', 'PAYMENT');

-- CreateEnum
CREATE TYPE "PublicationAction" AS ENUM ('SUBMITTED_FOR_REVIEW', 'PUBLISHED', 'ARCHIVED', 'RESTORED_TO_DRAFT');

-- AlterTable
ALTER TABLE "app_metadata" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "deletion_requested_at" TIMESTAMPTZ(3),
    "deletion_scheduled_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "avatar_storage_key" TEXT,
    "country_code" CHAR(2),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "exam_type" "ExamType",
    "target_band" DECIMAL(2,1),
    "exam_date" DATE,
    "weekly_study_hours" INTEGER,
    "onboarded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "replaced_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_modules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "skill" "Skill",
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learning_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "exam_type" "ExamType",
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "provenance" "ContentProvenance" NOT NULL DEFAULT 'ORIGINAL',
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_sections" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_resources" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ResourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "storage_key" TEXT,
    "duration_minutes" INTEGER,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learning_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_enrollments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learning_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ai_job_id" UUID,
    "target_band" DECIMAL(2,1),
    "exam_date" DATE,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "summary" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "study_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plan_tasks" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "skill" "Skill",
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimated_minutes" INTEGER,
    "resource_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "study_plan_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_learning_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "course_id" UUID,
    "resource_id" UUID,
    "event_type" TEXT NOT NULL,
    "minutes" INTEGER,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_learning_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "exam_type" "ExamType",
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_versions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "provenance" "ContentProvenance" NOT NULL DEFAULT 'ORIGINAL',
    "source_note" TEXT,
    "band_table_version" TEXT,
    "created_by_id" UUID,
    "reviewed_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sections" (
    "id" UUID NOT NULL,
    "exam_version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "skill" "Skill" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "duration_seconds" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_passages" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reading_passages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listening_audios" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "transcript" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listening_audios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_groups" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "instructions" TEXT,
    "stimulus" JSONB,
    "image_storage_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "question_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "prompt" TEXT,
    "explanation" TEXT,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_answers" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "accepted_value" TEXT NOT NULL,
    "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "max_words" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "question_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_tasks" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "task_type" "WritingTaskType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "image_storage_key" TEXT,
    "min_words" INTEGER NOT NULL,
    "suggested_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "writing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaking_questions" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "part" "SpeakingPart" NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "cue_card" JSONB,
    "audio_storage_key" TEXT,
    "prep_seconds" INTEGER,
    "max_answer_seconds" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "speaking_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exam_version_id" UUID NOT NULL,
    "mode" "AttemptMode" NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "band_table_version" TEXT,
    "overall_band" DECIMAL(2,1),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_attempts" (
    "id" UUID NOT NULL,
    "exam_attempt_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "last_saved_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "time_spent_seconds" INTEGER NOT NULL DEFAULT 0,
    "raw_score" INTEGER,
    "band_score" DECIMAL(2,1),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "section_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_responses" (
    "id" UUID NOT NULL,
    "section_attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "response" JSONB,
    "is_correct" BOOLEAN,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "answered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "question_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_submissions" (
    "id" UUID NOT NULL,
    "section_attempt_id" UUID NOT NULL,
    "writing_task_id" UUID NOT NULL,
    "parent_submission_id" UUID,
    "text" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "time_spent_seconds" INTEGER NOT NULL DEFAULT 0,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "last_saved_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "writing_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaking_submissions" (
    "id" UUID NOT NULL,
    "section_attempt_id" UUID NOT NULL,
    "speaking_question_id" UUID NOT NULL,
    "audio_storage_key" TEXT,
    "duration_seconds" INTEGER,
    "transcript" TEXT,
    "word_timings" JSONB,
    "fluency_metrics" JSONB,
    "pronunciation_feedback" JSONB,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "audio_delete_after" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "speaking_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL,
    "writing_submission_id" UUID,
    "speaking_submission_id" UUID,
    "section_attempt_id" UUID,
    "ai_job_id" UUID,
    "model_configuration_id" UUID,
    "prompt_version_id" UUID,
    "provider_snapshot" TEXT,
    "model_snapshot" TEXT,
    "overall_band" DECIMAL(2,1),
    "band_visibility" "BandVisibility" NOT NULL DEFAULT 'HIDDEN',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "reviewed_by_id" UUID,
    "reviewer_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_feedback" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "position" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criterion_scores" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "criterion" "AssessmentCriterion" NOT NULL,
    "band" DECIMAL(2,1) NOT NULL,
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "criterion_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_configurations" (
    "id" UUID NOT NULL,
    "task_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "tier" "AITier" NOT NULL DEFAULT 'DEFAULT',
    "effort" TEXT,
    "parameters" JSONB,
    "input_microusd_per_mtok" BIGINT,
    "output_microusd_per_mtok" BIGINT,
    "band_visibility" "BandVisibility" NOT NULL DEFAULT 'HIDDEN',
    "calibration_validated_at" TIMESTAMPTZ(3),
    "instructor_approved_by_id" UUID,
    "owner_approved_by_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_model_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_versions" (
    "id" UUID NOT NULL,
    "task_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rubric_version" TEXT,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assessment_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "task_key" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "model_configuration_id" UUID,
    "prompt_version_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_assessment_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "job_id" UUID,
    "model_configuration_id" UUID,
    "task_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "is_batch" BOOLEAN NOT NULL DEFAULT false,
    "cost_microusd" BIGINT,
    "latency_ms" INTEGER,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_calibration_records" (
    "id" UUID NOT NULL,
    "sample_reference" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "skill" "Skill" NOT NULL,
    "task_key" TEXT NOT NULL,
    "split" "CalibrationSplit" NOT NULL,
    "record_type" "CalibrationRecordType" NOT NULL,
    "marker_id" UUID,
    "model_configuration_id" UUID,
    "prompt_version_id" UUID,
    "response_text" TEXT,
    "audio_storage_key" TEXT,
    "consent_version" TEXT,
    "deidentified_at" TIMESTAMPTZ(3),
    "overall_band" DECIMAL(2,1),
    "criterion_bands" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_calibration_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_packages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL DEFAULT 'GLOBAL',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practice_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_packages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL DEFAULT 'GLOBAL',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "skill" "Skill" NOT NULL,
    "credits" INTEGER NOT NULL,
    "validity_days" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_gateways" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT true,
    "region_codes" TEXT[],
    "currencies" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "practice_package_id" UUID,
    "assessment_package_id" UUID,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "package_snapshot" JSONB NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "gateway_id" UUID NOT NULL,
    "tracking_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "gateway_transaction_id" TEXT,
    "gateway_validation_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "raw_response" JSONB,
    "succeeded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_entitlements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purchase_id" UUID,
    "practice_package_id" UUID,
    "assessment_package_id" UUID,
    "feature_key" TEXT NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "credits_granted" INTEGER,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "credits_reserved" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_records" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "processed_by_id" UUID,
    "gateway_refund_id" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reason" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "content_publication_history" (
    "id" UUID NOT NULL,
    "exam_version_id" UUID,
    "course_id" UUID,
    "actor_id" UUID,
    "action" "PublicationAction" NOT NULL,
    "from_status" "PublicationStatus",
    "to_status" "PublicationStatus" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_publication_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_deletion_scheduled_at_idx" ON "users"("deletion_scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_user_id_provider_key" ON "oauth_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "learning_modules_code_key" ON "learning_modules"("code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_module_id_status_idx" ON "courses"("module_id", "status");

-- CreateIndex
CREATE INDEX "courses_status_exam_type_idx" ON "courses"("status", "exam_type");

-- CreateIndex
CREATE UNIQUE INDEX "course_sections_course_id_position_key" ON "course_sections"("course_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "learning_resources_section_id_position_key" ON "learning_resources"("section_id", "position");

-- CreateIndex
CREATE INDEX "user_enrollments_course_id_idx" ON "user_enrollments"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_enrollments_user_id_course_id_key" ON "user_enrollments"("user_id", "course_id");

-- CreateIndex
CREATE INDEX "learning_progress_resource_id_idx" ON "learning_progress"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_progress_user_id_resource_id_key" ON "learning_progress"("user_id", "resource_id");

-- CreateIndex
CREATE INDEX "study_plans_user_id_idx" ON "study_plans"("user_id");

-- CreateIndex
CREATE INDEX "study_plans_ai_job_id_idx" ON "study_plans"("ai_job_id");

-- CreateIndex
CREATE INDEX "study_plan_tasks_plan_id_scheduled_date_idx" ON "study_plan_tasks"("plan_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "user_learning_history_user_id_occurred_at_idx" ON "user_learning_history"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "user_learning_history_course_id_idx" ON "user_learning_history"("course_id");

-- CreateIndex
CREATE INDEX "user_learning_history_resource_id_idx" ON "user_learning_history"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "exams_slug_key" ON "exams"("slug");

-- CreateIndex
CREATE INDEX "exams_exam_type_is_mock_idx" ON "exams"("exam_type", "is_mock");

-- CreateIndex
CREATE INDEX "exam_versions_status_idx" ON "exam_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_versions_exam_id_version_number_key" ON "exam_versions"("exam_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sections_exam_version_id_position_key" ON "exam_sections"("exam_version_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "reading_passages_section_id_position_key" ON "reading_passages"("section_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "listening_audios_section_id_position_key" ON "listening_audios"("section_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "question_groups_section_id_position_key" ON "question_groups"("section_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "questions_group_id_number_key" ON "questions"("group_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_position_key" ON "question_options"("question_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_label_key" ON "question_options"("question_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "question_answers_question_id_accepted_value_key" ON "question_answers"("question_id", "accepted_value");

-- CreateIndex
CREATE UNIQUE INDEX "writing_tasks_section_id_position_key" ON "writing_tasks"("section_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "speaking_questions_section_id_part_position_key" ON "speaking_questions"("section_id", "part", "position");

-- CreateIndex
CREATE INDEX "exam_attempts_user_id_created_at_idx" ON "exam_attempts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "exam_attempts_exam_version_id_idx" ON "exam_attempts"("exam_version_id");

-- CreateIndex
CREATE INDEX "exam_attempts_status_expires_at_idx" ON "exam_attempts"("status", "expires_at");

-- CreateIndex
CREATE INDEX "section_attempts_section_id_idx" ON "section_attempts"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_attempts_exam_attempt_id_section_id_key" ON "section_attempts"("exam_attempt_id", "section_id");

-- CreateIndex
CREATE INDEX "question_responses_question_id_idx" ON "question_responses"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_responses_section_attempt_id_question_id_key" ON "question_responses"("section_attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "writing_submissions_writing_task_id_idx" ON "writing_submissions"("writing_task_id");

-- CreateIndex
CREATE INDEX "writing_submissions_parent_submission_id_idx" ON "writing_submissions"("parent_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "writing_submissions_section_attempt_id_writing_task_id_key" ON "writing_submissions"("section_attempt_id", "writing_task_id");

-- CreateIndex
CREATE INDEX "speaking_submissions_speaking_question_id_idx" ON "speaking_submissions"("speaking_question_id");

-- CreateIndex
CREATE INDEX "speaking_submissions_audio_delete_after_idx" ON "speaking_submissions"("audio_delete_after");

-- CreateIndex
CREATE UNIQUE INDEX "speaking_submissions_section_attempt_id_speaking_question_i_key" ON "speaking_submissions"("section_attempt_id", "speaking_question_id");

-- CreateIndex
CREATE INDEX "assessment_results_writing_submission_id_idx" ON "assessment_results"("writing_submission_id");

-- CreateIndex
CREATE INDEX "assessment_results_speaking_submission_id_idx" ON "assessment_results"("speaking_submission_id");

-- CreateIndex
CREATE INDEX "assessment_results_section_attempt_id_idx" ON "assessment_results"("section_attempt_id");

-- CreateIndex
CREATE INDEX "assessment_results_ai_job_id_idx" ON "assessment_results"("ai_job_id");

-- CreateIndex
CREATE INDEX "assessment_results_model_configuration_id_idx" ON "assessment_results"("model_configuration_id");

-- CreateIndex
CREATE INDEX "assessment_results_prompt_version_id_idx" ON "assessment_results"("prompt_version_id");

-- CreateIndex
CREATE INDEX "assessment_results_reviewed_by_id_idx" ON "assessment_results"("reviewed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_feedback_result_id_type_position_key" ON "assessment_feedback"("result_id", "type", "position");

-- CreateIndex
CREATE UNIQUE INDEX "criterion_scores_result_id_criterion_key" ON "criterion_scores"("result_id", "criterion");

-- CreateIndex
CREATE INDEX "ai_model_configurations_instructor_approved_by_id_idx" ON "ai_model_configurations"("instructor_approved_by_id");

-- CreateIndex
CREATE INDEX "ai_model_configurations_owner_approved_by_id_idx" ON "ai_model_configurations"("owner_approved_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_configurations_task_key_provider_model_id_key" ON "ai_model_configurations"("task_key", "provider", "model_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_versions_task_key_version_key" ON "ai_prompt_versions"("task_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assessment_jobs_idempotency_key_key" ON "ai_assessment_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_assessment_jobs_status_queued_at_idx" ON "ai_assessment_jobs"("status", "queued_at");

-- CreateIndex
CREATE INDEX "ai_assessment_jobs_user_id_queued_at_idx" ON "ai_assessment_jobs"("user_id", "queued_at" DESC);

-- CreateIndex
CREATE INDEX "ai_assessment_jobs_subject_type_subject_id_idx" ON "ai_assessment_jobs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "ai_assessment_jobs_model_configuration_id_idx" ON "ai_assessment_jobs"("model_configuration_id");

-- CreateIndex
CREATE INDEX "ai_assessment_jobs_prompt_version_id_idx" ON "ai_assessment_jobs"("prompt_version_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_task_key_created_at_idx" ON "ai_usage_logs"("task_key", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_created_at_idx" ON "ai_usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_job_id_idx" ON "ai_usage_logs"("job_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_model_configuration_id_idx" ON "ai_usage_logs"("model_configuration_id");

-- CreateIndex
CREATE INDEX "assessment_calibration_records_dataset_version_split_idx" ON "assessment_calibration_records"("dataset_version", "split");

-- CreateIndex
CREATE INDEX "assessment_calibration_records_sample_reference_idx" ON "assessment_calibration_records"("sample_reference");

-- CreateIndex
CREATE INDEX "assessment_calibration_records_marker_id_idx" ON "assessment_calibration_records"("marker_id");

-- CreateIndex
CREATE INDEX "assessment_calibration_records_model_configuration_id_idx" ON "assessment_calibration_records"("model_configuration_id");

-- CreateIndex
CREATE INDEX "assessment_calibration_records_prompt_version_id_idx" ON "assessment_calibration_records"("prompt_version_id");

-- CreateIndex
CREATE INDEX "practice_packages_is_active_region_code_idx" ON "practice_packages"("is_active", "region_code");

-- CreateIndex
CREATE UNIQUE INDEX "practice_packages_code_region_code_currency_key" ON "practice_packages"("code", "region_code", "currency");

-- CreateIndex
CREATE INDEX "assessment_packages_is_active_region_code_skill_idx" ON "assessment_packages"("is_active", "region_code", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_packages_code_region_code_currency_key" ON "assessment_packages"("code", "region_code", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateways_code_key" ON "payment_gateways"("code");

-- CreateIndex
CREATE INDEX "user_purchases_user_id_created_at_idx" ON "user_purchases"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_purchases_practice_package_id_idx" ON "user_purchases"("practice_package_id");

-- CreateIndex
CREATE INDEX "user_purchases_assessment_package_id_idx" ON "user_purchases"("assessment_package_id");

-- CreateIndex
CREATE INDEX "user_purchases_status_idx" ON "user_purchases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_tracking_id_key" ON "payment_transactions"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_idempotency_key_key" ON "payment_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_transactions_purchase_id_idx" ON "payment_transactions"("purchase_id");

-- CreateIndex
CREATE INDEX "payment_transactions_status_created_at_idx" ON "payment_transactions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gateway_id_gateway_transaction_id_key" ON "payment_transactions"("gateway_id", "gateway_transaction_id");

-- CreateIndex
CREATE INDEX "user_entitlements_user_id_feature_key_status_idx" ON "user_entitlements"("user_id", "feature_key", "status");

-- CreateIndex
CREATE INDEX "user_entitlements_ends_at_idx" ON "user_entitlements"("ends_at");

-- CreateIndex
CREATE INDEX "user_entitlements_practice_package_id_idx" ON "user_entitlements"("practice_package_id");

-- CreateIndex
CREATE INDEX "user_entitlements_assessment_package_id_idx" ON "user_entitlements"("assessment_package_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_entitlements_purchase_id_feature_key_key" ON "user_entitlements"("purchase_id", "feature_key");

-- CreateIndex
CREATE INDEX "refund_records_purchase_id_idx" ON "refund_records"("purchase_id");

-- CreateIndex
CREATE INDEX "refund_records_processed_by_id_idx" ON "refund_records"("processed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_records_transaction_id_gateway_refund_id_key" ON "refund_records"("transaction_id", "gateway_refund_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_type_created_at_idx" ON "notifications"("type", "created_at");

-- CreateIndex
CREATE INDEX "user_notifications_user_id_read_at_idx" ON "user_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "user_notifications_notification_id_idx" ON "user_notifications"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notifications_user_id_notification_id_key" ON "user_notifications"("user_id", "notification_id");

-- CreateIndex
CREATE INDEX "content_publication_history_exam_version_id_idx" ON "content_publication_history"("exam_version_id");

-- CreateIndex
CREATE INDEX "content_publication_history_course_id_idx" ON "content_publication_history"("course_id");

-- CreateIndex
CREATE INDEX "content_publication_history_actor_id_idx" ON "content_publication_history"("actor_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "learning_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_enrollments" ADD CONSTRAINT "user_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_enrollments" ADD CONSTRAINT "user_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "learning_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_ai_job_id_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_assessment_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plan_tasks" ADD CONSTRAINT "study_plan_tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "study_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning_history" ADD CONSTRAINT "user_learning_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning_history" ADD CONSTRAINT "user_learning_history_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning_history" ADD CONSTRAINT "user_learning_history_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "learning_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sections" ADD CONSTRAINT "exam_sections_exam_version_id_fkey" FOREIGN KEY ("exam_version_id") REFERENCES "exam_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_passages" ADD CONSTRAINT "reading_passages_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_audios" ADD CONSTRAINT "listening_audios_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "question_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_tasks" ADD CONSTRAINT "writing_tasks_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_questions" ADD CONSTRAINT "speaking_questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_version_id_fkey" FOREIGN KEY ("exam_version_id") REFERENCES "exam_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_attempts" ADD CONSTRAINT "section_attempts_exam_attempt_id_fkey" FOREIGN KEY ("exam_attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_attempts" ADD CONSTRAINT "section_attempts_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_section_attempt_id_fkey" FOREIGN KEY ("section_attempt_id") REFERENCES "section_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_section_attempt_id_fkey" FOREIGN KEY ("section_attempt_id") REFERENCES "section_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_writing_task_id_fkey" FOREIGN KEY ("writing_task_id") REFERENCES "writing_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_parent_submission_id_fkey" FOREIGN KEY ("parent_submission_id") REFERENCES "writing_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_submissions" ADD CONSTRAINT "speaking_submissions_section_attempt_id_fkey" FOREIGN KEY ("section_attempt_id") REFERENCES "section_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_submissions" ADD CONSTRAINT "speaking_submissions_speaking_question_id_fkey" FOREIGN KEY ("speaking_question_id") REFERENCES "speaking_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_writing_submission_id_fkey" FOREIGN KEY ("writing_submission_id") REFERENCES "writing_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_speaking_submission_id_fkey" FOREIGN KEY ("speaking_submission_id") REFERENCES "speaking_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_section_attempt_id_fkey" FOREIGN KEY ("section_attempt_id") REFERENCES "section_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_ai_job_id_fkey" FOREIGN KEY ("ai_job_id") REFERENCES "ai_assessment_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "ai_model_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_feedback" ADD CONSTRAINT "assessment_feedback_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "assessment_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "assessment_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_configurations" ADD CONSTRAINT "ai_model_configurations_instructor_approved_by_id_fkey" FOREIGN KEY ("instructor_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_configurations" ADD CONSTRAINT "ai_model_configurations_owner_approved_by_id_fkey" FOREIGN KEY ("owner_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_jobs" ADD CONSTRAINT "ai_assessment_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_jobs" ADD CONSTRAINT "ai_assessment_jobs_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "ai_model_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assessment_jobs" ADD CONSTRAINT "ai_assessment_jobs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_assessment_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "ai_model_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "assessment_calibration_records_marker_id_fkey" FOREIGN KEY ("marker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "assessment_calibration_records_model_configuration_id_fkey" FOREIGN KEY ("model_configuration_id") REFERENCES "ai_model_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "assessment_calibration_records_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_practice_package_id_fkey" FOREIGN KEY ("practice_package_id") REFERENCES "practice_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_assessment_package_id_fkey" FOREIGN KEY ("assessment_package_id") REFERENCES "assessment_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "user_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "payment_gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "user_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_practice_package_id_fkey" FOREIGN KEY ("practice_package_id") REFERENCES "practice_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_assessment_package_id_fkey" FOREIGN KEY ("assessment_package_id") REFERENCES "assessment_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "user_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publication_history" ADD CONSTRAINT "content_publication_history_exam_version_id_fkey" FOREIGN KEY ("exam_version_id") REFERENCES "exam_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publication_history" ADD CONSTRAINT "content_publication_history_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publication_history" ADD CONSTRAINT "content_publication_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Hand-written rules Prisma's schema can't express ----------

-- One record per person and purchase state.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- Band scores: 0 to 9 in half-band steps.
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_target_band_valid" CHECK ("target_band" IS NULL OR ("target_band" BETWEEN 0 AND 9 AND "target_band" % 0.5 = 0));
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_target_band_valid" CHECK ("target_band" IS NULL OR ("target_band" BETWEEN 0 AND 9 AND "target_band" % 0.5 = 0));
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_overall_band_valid" CHECK ("overall_band" IS NULL OR ("overall_band" BETWEEN 0 AND 9 AND "overall_band" % 0.5 = 0));
ALTER TABLE "section_attempts" ADD CONSTRAINT "section_attempts_band_score_valid" CHECK ("band_score" IS NULL OR ("band_score" BETWEEN 0 AND 9 AND "band_score" % 0.5 = 0));
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_overall_band_valid" CHECK ("overall_band" IS NULL OR ("overall_band" BETWEEN 0 AND 9 AND "overall_band" % 0.5 = 0));
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_band_valid" CHECK ("band" BETWEEN 0 AND 9 AND "band" % 0.5 = 0);
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "calibration_overall_band_valid" CHECK ("overall_band" IS NULL OR ("overall_band" BETWEEN 0 AND 9 AND "overall_band" % 0.5 = 0));

-- Other ranges.
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_percent_valid" CHECK ("percent" BETWEEN 0 AND 100);
ALTER TABLE "section_attempts" ADD CONSTRAINT "section_attempts_raw_score_valid" CHECK ("raw_score" IS NULL OR "raw_score" >= 0);

-- Money is never negative.
ALTER TABLE "practice_packages" ADD CONSTRAINT "practice_packages_price_valid" CHECK ("price_minor" >= 0 AND "duration_days" > 0);
ALTER TABLE "assessment_packages" ADD CONSTRAINT "assessment_packages_price_valid" CHECK ("price_minor" >= 0 AND "credits" > 0);
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_amount_valid" CHECK ("amount_minor" >= 0 AND "discount_minor" >= 0);
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_amount_valid" CHECK ("amount_minor" >= 0);
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_amount_valid" CHECK ("amount_minor" > 0);

-- A purchase buys exactly one package.
ALTER TABLE "user_purchases" ADD CONSTRAINT "user_purchases_one_package" CHECK (num_nonnulls("practice_package_id", "assessment_package_id") = 1);

-- Credits can't be overspent.
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_credits_valid" CHECK (
  "credits_used" >= 0 AND "credits_reserved" >= 0
  AND ("credits_granted" IS NULL OR "credits_used" + "credits_reserved" <= "credits_granted")
);

-- An assessment belongs to exactly one subject.
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_one_subject" CHECK (
  num_nonnulls("writing_submission_id", "speaking_submission_id", "section_attempt_id") = 1
);

-- Exam publication state must be coherent.
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_published_has_date" CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

-- The band gate: a public band needs recorded validation and both human approvals.
ALTER TABLE "ai_model_configurations" ADD CONSTRAINT "ai_public_band_requires_validation" CHECK (
  "band_visibility" <> 'PUBLIC'
  OR ("calibration_validated_at" IS NOT NULL AND "instructor_approved_by_id" IS NOT NULL AND "owner_approved_by_id" IS NOT NULL)
);

-- Calibration: human marks name a marker, and AI predictions name a model.
ALTER TABLE "assessment_calibration_records" ADD CONSTRAINT "calibration_record_source_valid" CHECK (
  ("record_type" = 'AI_PREDICTION' AND "model_configuration_id" IS NOT NULL) OR ("record_type" <> 'AI_PREDICTION' AND "marker_id" IS NOT NULL)
);

-- Partial unique indexes.
CREATE UNIQUE INDEX "exam_attempts_one_in_progress" ON "exam_attempts" ("user_id", "exam_version_id") WHERE "status" = 'IN_PROGRESS';
CREATE UNIQUE INDEX "exam_versions_one_published" ON "exam_versions" ("exam_id") WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "study_plans_one_active" ON "study_plans" ("user_id") WHERE "is_active";
CREATE UNIQUE INDEX "ai_model_configurations_one_active" ON "ai_model_configurations" ("task_key", "tier") WHERE "is_active";
CREATE UNIQUE INDEX "ai_prompt_versions_one_active" ON "ai_prompt_versions" ("task_key") WHERE "is_active";
CREATE UNIQUE INDEX "assessment_results_current_writing" ON "assessment_results" ("writing_submission_id") WHERE "is_current" AND "writing_submission_id" IS NOT NULL;
CREATE UNIQUE INDEX "assessment_results_current_speaking" ON "assessment_results" ("speaking_submission_id") WHERE "is_current" AND "speaking_submission_id" IS NOT NULL;
CREATE UNIQUE INDEX "assessment_results_current_section" ON "assessment_results" ("section_attempt_id") WHERE "is_current" AND "section_attempt_id" IS NOT NULL;
CREATE UNIQUE INDEX "calibration_one_mark_per_marker" ON "assessment_calibration_records" ("dataset_version", "sample_reference", "marker_id", "record_type") WHERE "marker_id" IS NOT NULL;
CREATE UNIQUE INDEX "calibration_one_prediction_per_config" ON "assessment_calibration_records" ("dataset_version", "sample_reference", "model_configuration_id", "prompt_version_id") WHERE "record_type" = 'AI_PREDICTION';

-- Published exam content can't change, so past attempts always show what the student saw.
CREATE FUNCTION protect_published_exam_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."published_at" IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published exam version % cannot be deleted', OLD."id" USING ERRCODE = 'restrict_violation';
  END IF;
  -- Only archiving is allowed after publication.
  IF NEW."status" NOT IN ('PUBLISHED', 'ARCHIVED')
     OR (to_jsonb(NEW) - 'status' - 'archived_at' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'archived_at' - 'updated_at') THEN
    RAISE EXCEPTION 'Published exam version % cannot be changed. Create a new version.', OLD."id" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_versions_protect_published BEFORE UPDATE OR DELETE ON "exam_versions"
  FOR EACH ROW EXECUTE FUNCTION protect_published_exam_version();

CREATE FUNCTION exam_version_of_content(table_name text, content jsonb) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  section uuid;
  grp uuid;
BEGIN
  IF table_name = 'exam_sections' THEN
    RETURN (content->>'exam_version_id')::uuid;
  ELSIF table_name IN ('question_options', 'question_answers') THEN
    SELECT "group_id" INTO grp FROM "questions" WHERE "id" = (content->>'question_id')::uuid;
    SELECT "section_id" INTO section FROM "question_groups" WHERE "id" = grp;
  ELSIF table_name = 'questions' THEN
    SELECT "section_id" INTO section FROM "question_groups" WHERE "id" = (content->>'group_id')::uuid;
  ELSE
    section := (content->>'section_id')::uuid;
  END IF;
  RETURN (SELECT "exam_version_id" FROM "exam_sections" WHERE "id" = section);
END;
$$;

CREATE FUNCTION protect_published_exam_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  version_id uuid;
BEGIN
  FOREACH row_data IN ARRAY CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)]
    WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
    ELSE ARRAY[to_jsonb(OLD), to_jsonb(NEW)]
  END LOOP
    version_id := exam_version_of_content(TG_TABLE_NAME, row_data);
    IF EXISTS (SELECT 1 FROM "exam_versions" WHERE "id" = version_id AND "published_at" IS NOT NULL) THEN
      RAISE EXCEPTION 'Content of published exam version % cannot be changed. Create a new version.', version_id USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_sections_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "exam_sections" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER reading_passages_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "reading_passages" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER listening_audios_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "listening_audios" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER question_groups_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "question_groups" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER questions_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "questions" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER question_options_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "question_options" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER question_answers_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "question_answers" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER writing_tasks_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "writing_tasks" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();
CREATE TRIGGER speaking_questions_protect_published BEFORE INSERT OR UPDATE OR DELETE ON "speaking_questions" FOR EACH ROW EXECUTE FUNCTION protect_published_exam_content();

-- Attempts can begin only on published content.
CREATE FUNCTION require_published_exam_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "exam_versions" WHERE "id" = NEW."exam_version_id" AND "status" = 'PUBLISHED') THEN
    RAISE EXCEPTION 'Attempts require a published exam version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_attempts_require_published BEFORE INSERT ON "exam_attempts"
  FOR EACH ROW EXECUTE FUNCTION require_published_exam_version();

