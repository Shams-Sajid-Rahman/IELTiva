import type { Env } from "../config/env.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AuthService } from "./auth.service.js";
import { createAdminService } from "./admin.service.js";
import { createCourseService } from "./course.service.js";
import { createDashboardService } from "./dashboard.service.js";
import type { EmailProvider } from "./email/email.provider.js";
import { createEnrollmentService } from "./enrollment.service.js";
import { createAttemptService } from "./exam/attempt.service.js";
import { createExamAdminService } from "./exam/exam-admin.service.js";
import { createModuleService } from "./module.service.js";
import { createNotificationService, type NotificationService } from "./notification.service.js";
import { createPlannerService } from "./planner.service.js";
import { createProfileService } from "./profile.service.js";
import { createRoleService } from "./role.service.js";
import type { PrivateStorage } from "./storage/private-storage.js";
import { createUserAdminService } from "./user-admin.service.js";
import type { Logger } from "../utils/logger.js";

type Deps = {
  prisma: PrismaClient;
  env: Pick<Env, "FRONTEND_URL">;
  email: EmailProvider;
  logger: Logger;
  storage: PrivateStorage;
  auth: AuthService;
  notifications: NotificationService;
};

export function createPlatformServices({ prisma, env, email, logger, storage, auth, notifications }: Deps) {
  return {
    admin: createAdminService(prisma),
    attempts: createAttemptService(prisma, storage),
    examAdmin: createExamAdminService(prisma, storage),
    courses: createCourseService(prisma, notifications),
    dashboard: createDashboardService(prisma, notifications),
    enrollments: createEnrollmentService(prisma, notifications),
    modules: createModuleService(prisma),
    notifications,
    planner: createPlannerService(prisma),
    profile: createProfileService({ prisma, env, email, logger, notifications, storage }),
    roles: createRoleService(prisma, notifications),
    users: createUserAdminService(prisma, notifications, auth.revokeAllSessions),
  };
}

export { createNotificationService };
