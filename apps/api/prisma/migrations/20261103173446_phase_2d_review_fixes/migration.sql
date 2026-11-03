-- CreateIndex
CREATE INDEX "exam_versions_created_by_id_idx" ON "exam_versions"("created_by_id");

-- CreateIndex
CREATE INDEX "exam_versions_reviewed_by_id_idx" ON "exam_versions"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "study_plan_tasks_resource_id_idx" ON "study_plan_tasks"("resource_id");

-- CreateIndex
CREATE INDEX "user_roles_assigned_by_id_idx" ON "user_roles"("assigned_by_id");

-- AddForeignKey
ALTER TABLE "study_plan_tasks" ADD CONSTRAINT "study_plan_tasks_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "learning_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
