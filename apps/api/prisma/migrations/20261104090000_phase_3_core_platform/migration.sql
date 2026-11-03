-- CreateEnum
CREATE TYPE "DifficultyLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'ROLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SECURITY';
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';

-- AlterEnum
ALTER TYPE "PublicationAction" ADD VALUE 'CONTENT_UPDATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResourceType" ADD VALUE 'EXTERNAL_LINK';
ALTER TYPE "ResourceType" ADD VALUE 'VOCABULARY';
ALTER TYPE "ResourceType" ADD VALUE 'GRAMMAR';
ALTER TYPE "ResourceType" ADD VALUE 'PRACTICE_GUIDANCE';

-- AlterTable
ALTER TABLE "content_publication_history" ADD COLUMN     "module_id" UUID;

-- AlterTable
ALTER TABLE "course_sections" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "is_visible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "difficulty" "DifficultyLevel",
ADD COLUMN     "estimated_minutes" INTEGER,
ADD COLUMN     "instructor_id" UUID,
ADD COLUMN     "learning_objectives" TEXT[],
ADD COLUMN     "thumbnail_url" TEXT;

-- AlterTable
ALTER TABLE "email_verification_tokens" ADD COLUMN     "new_email" TEXT;

-- AlterTable
ALTER TABLE "learning_modules" ADD COLUMN     "difficulty" "DifficultyLevel",
ADD COLUMN     "estimated_minutes" INTEGER,
ADD COLUMN     "exam_type" "ExamType",
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "learning_progress" ADD COLUMN     "last_accessed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "learning_resources" ADD COLUMN     "external_url" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "audience" "AnnouncementAudience",
ADD COLUMN     "audience_role" TEXT,
ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "status" "PublicationStatus" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "user_enrollments" ADD COLUMN     "last_accessed_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_resource_id" UUID;

-- AlterTable
ALTER TABLE "user_notifications" ADD COLUMN     "dismissed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "daily_goal_minutes" INTEGER,
ADD COLUMN     "notification_prefs" JSONB,
ADD COLUMN     "preferred_skills" "Skill"[];

-- CreateIndex
CREATE INDEX "content_publication_history_module_id_idx" ON "content_publication_history"("module_id");

-- CreateIndex
CREATE INDEX "courses_instructor_id_idx" ON "courses"("instructor_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_created_by_id_idx" ON "notifications"("created_by_id");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "user_enrollments_last_resource_id_idx" ON "user_enrollments"("last_resource_id");

-- CreateIndex
CREATE INDEX "user_enrollments_status_created_at_idx" ON "user_enrollments"("status", "created_at");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_enrollments" ADD CONSTRAINT "user_enrollments_last_resource_id_fkey" FOREIGN KEY ("last_resource_id") REFERENCES "learning_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publication_history" ADD CONSTRAINT "content_publication_history_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "learning_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Modules that already exist were in use before publication status was added.
UPDATE "learning_modules" SET "status" = 'PUBLISHED', "published_at" = now();

-- Personal notifications stay published. Announcements set their own status.
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_percent_complete" CHECK ("status" <> 'COMPLETED' OR "percent" = 100);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_audience_role_valid" CHECK ("audience" IS DISTINCT FROM 'ROLE' OR "audience_role" IS NOT NULL);

-- Audit history can't be rewritten. The only allowed change is the database clearing a deleted actor.
CREATE FUNCTION protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit log entries cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'actor_id') <> (to_jsonb(OLD) - 'actor_id') OR NEW."actor_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Audit log entries cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_protect BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION protect_audit_log();
