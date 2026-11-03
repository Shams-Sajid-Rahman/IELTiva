-- Phase 4: IELTS practice engine. Every change here adds to the schema, and no existing data changes.

-- A section exists from the moment an attempt starts, but its timer starts later.
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'NOT_STARTED';

CREATE TYPE "ScoringMode" AS ENUM ('ALL_OR_NOTHING', 'PER_ITEM');

-- Configurable rules, so timing and navigation aren't hard-coded.
ALTER TABLE "exam_versions" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "exam_sections" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "questions" ADD COLUMN "scoring_mode" "ScoringMode" NOT NULL DEFAULT 'ALL_OR_NOTHING';
ALTER TABLE "question_answers" ADD COLUMN "ignore_punctuation" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "question_responses" ADD COLUMN "marks_awarded" INTEGER;

ALTER TABLE "section_attempts" ADD COLUMN "max_score" INTEGER;
ALTER TABLE "section_attempts" ADD COLUMN "audio_plays" JSONB NOT NULL DEFAULT '{}';

-- Raw scores stay separate from any band.
ALTER TABLE "exam_attempts" ADD COLUMN "raw_score" INTEGER;
ALTER TABLE "exam_attempts" ADD COLUMN "max_score" INTEGER;

ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_marks_valid" CHECK ("marks_awarded" IS NULL OR "marks_awarded" >= 0);
ALTER TABLE "section_attempts" ADD CONSTRAINT "section_attempts_max_score_valid" CHECK ("max_score" IS NULL OR "max_score" >= 0);
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_scores_valid" CHECK (("raw_score" IS NULL OR "raw_score" >= 0) AND ("max_score" IS NULL OR "max_score" >= 0));

-- Two requests starting the same exam at once can't create two active attempts.
CREATE UNIQUE INDEX "exam_attempts_one_active" ON "exam_attempts" ("user_id", "exam_version_id") WHERE "status" = 'IN_PROGRESS';
