-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "reminder_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "reminder_time" TEXT,
ADD COLUMN     "reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weekly_session_goal" INTEGER;

-- CreateIndex
CREATE INDEX "credit_ledger_created_at_idx" ON "credit_ledger"("created_at");

-- CreateIndex
CREATE INDEX "exam_attempts_created_at_idx" ON "exam_attempts"("created_at");

-- CreateIndex
CREATE INDEX "exam_attempts_submitted_at_idx" ON "exam_attempts"("submitted_at");

-- CreateIndex
CREATE INDEX "user_learning_history_occurred_at_idx" ON "user_learning_history"("occurred_at");

-- CreateIndex
CREATE INDEX "user_sessions_last_seen_at_idx" ON "user_sessions"("last_seen_at");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

