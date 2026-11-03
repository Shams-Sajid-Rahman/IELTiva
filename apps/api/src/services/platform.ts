import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AuthService } from "./auth.service.js";
import { createAdminService } from "./admin.service.js";
import { createAdminAnalyticsService } from "./analytics/admin.service.js";
import { createLearningService } from "./analytics/learning.service.js";
import { createStudentAnalyticsService } from "./analytics/student.service.js";
import type { AudioInfo } from "./audio/audio.service.js";
import { createCache, type Cache } from "./cache.js";
import { createResourceFileService } from "./files/resource-files.service.js";
import { createNotifier } from "./notifier.js";
import { createOperationsService } from "./ops/operations.service.js";
import { createPrivacyService } from "./privacy/privacy.service.js";
import type { JobQueues } from "./queue/jobs.js";
import { createReportService } from "./reports/report.service.js";
import { BILLING_OFF, createBillingRuntime, type BillingEnv } from "./billing/runtime.js";
import { createAiRuntime, type AiEnv } from "./ai/runtime.js";
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
  /** AI settings. Without them, AI features stay switched off. */
  aiEnv?: AiEnv;
  /** Payment settings. Without them, no payment method can be switched on. */
  billingEnv?: BillingEnv;
  /** Left out in tests, so every read sees the database directly. */
  cache?: Cache;
  redis?: Redis | null;
  queues?: JobQueues | null;
  redisUrl?: string | undefined;
  /** Checks uploads with ffmpeg. Left out in tests, which use small placeholder files. */
  audioProbe?: (data: Buffer) => Promise<AudioInfo>;
};

const AI_OFF: AiEnv = { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined, AI_MODEL_DEFAULT: "", AI_MODEL_COMPLEX: "", AI_MODEL_LIGHT: "", AI_TIMEOUT_SECONDS: 300, AI_DAILY_SPEND_ALERT_USD: undefined, AI_DAILY_SPEND_LIMIT_USD: undefined, REDIS_URL: undefined, AZURE_SPEECH_KEY: undefined, AZURE_SPEECH_REGION: undefined, AZURE_SPEECH_LANGUAGE: "en-GB", AI_ALLOWED_MODELS: undefined, AI_USER_DAILY_TOKEN_LIMIT: 0 };

export function createPlatformServices({ prisma, env, email, logger, storage, auth, notifications, aiEnv, billingEnv, cache, redis = null, queues = null, redisUrl, audioProbe }: Deps) {
  const readCache = cache ?? createCache({ maxEntries: 0 });
  const notify = createNotifier(notifications, queues);
  const operations = createOperationsService({ prisma, redis, redisUrl, storage, cache: readCache });
  const billing = createBillingRuntime({ prisma, env: billingEnv ?? BILLING_OFF, logger, notify, cache });
  const aiRuntime = createAiRuntime({ prisma, env: aiEnv ?? AI_OFF, storage, logger });
  const studentAnalytics = createStudentAnalyticsService(prisma, readCache);
  const courses = createCourseService(prisma, notifications, cache);
  const privacy = createPrivacyService({ prisma, storage, auth, logger });
  const reports = createReportService({ prisma, storage, queues, analytics: studentAnalytics, buildExport: privacy.buildExport, logger });
  return {
    billing,
    aiRuntime,
    analytics: {
      student: studentAnalytics,
      learning: createLearningService({ prisma, analytics: studentAnalytics, ai: aiRuntime.ai, notify }),
      admin: createAdminAnalyticsService({ prisma, cache: readCache, revenue: billing.revenue }),
    },
    operations,
    reports,
    privacy,
    resourceFiles: createResourceFileService({ prisma, storage, courses }),
    admin: createAdminService(prisma),
    attempts: createAttemptService(prisma, storage, {
      credits: billing.entitlements,
      cache,
      onRecordingSaved: queues ? (submissionId) => queues.add("audio.process-recording", { submissionId }, `${submissionId}-${Date.now()}`) : undefined,
    }),
    examAdmin: createExamAdminService(prisma, storage, audioProbe),
    courses,
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
