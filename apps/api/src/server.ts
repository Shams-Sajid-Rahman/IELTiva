import { createApp } from "./app.js";
import { API_PREFIX } from "./config/constants.js";
import { createPrismaClient } from "./config/database.js";
import { loadConfig } from "./config/env.js";
import { createAuthMiddleware } from "./middleware/authenticate.js";
import { useRedisForRateLimits } from "./middleware/rate-limit.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createPaymentCallbackRouter } from "./routes/billing.routes.js";
import { createProbeRouter } from "./routes/ops.routes.js";
import { createPlatformRouter } from "./routes/platform.routes.js";
import { createReleasePublicRouter } from "./routes/release.routes.js";
import { createReleaseService } from "./services/release/release.service.js";
import { createAuthService } from "./services/auth.service.js";
import { createEmailProvider } from "./services/email/index.js";
import { createGoogleProvider } from "./services/google-oauth.service.js";
import { createNotificationService, createPlatformServices } from "./services/platform.js";
import { probeAudio } from "./services/audio/audio.service.js";
import { createCache } from "./services/cache.js";
import { createEventRecorder } from "./services/ops/events.js";
import { createJobQueues, createRedisClient, createRedisStore } from "./services/queue/jobs.js";
import { createStorage, withErrorTracking } from "./services/storage/index.js";
import { createTokenService } from "./services/token.service.js";
import { createShutdown } from "./utils/graceful-shutdown.js";
import { createLogger } from "./utils/logger.js";

const env = loadConfig();
const logger = createLogger(env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
const tokens = createTokenService(env);
const email = createEmailProvider(env, logger);
const google = createGoogleProvider(env);
const notifications = createNotificationService(prisma);
const release = createReleaseService(prisma, { channel: env.RELEASE_CHANNEL });
const auth = createAuthService({ prisma, env, tokens, email, logger, notifyUser: notifications.notifyUser, accessGate: release });
const events = createEventRecorder(prisma, logger);
const storage = withErrorTracking(createStorage(env), (code, name) => events.record("storage", code, name));
const redis = createRedisClient(env.REDIS_URL, logger);
const queues = createJobQueues(env.REDIS_URL, logger);
const cache = createCache({ shared: redis ? createRedisStore(redis) : null });
useRedisForRateLimits(redis);
const { authenticateUser } = createAuthMiddleware({ tokens, auth });
const services = createPlatformServices({ prisma, env, email, logger, storage, auth, notifications, aiEnv: env, billingEnv: env, cache, redis, queues, redisUrl: env.REDIS_URL, audioProbe: probeAudio, release });
const platformRouter = createPlatformRouter(services, authenticateUser);

const app = createApp({
  env,
  logger,
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  authRouter: createAuthRouter({ env, auth, tokens, google }),
  platformRouter,
  paymentCallbackRouter: createPaymentCallbackRouter(services.billing, logger, env.FRONTEND_URL),
  probeRouter: createProbeRouter(services.operations),
  publicRouter: createReleasePublicRouter(release),
});

const server = app.listen(env.PORT, () => {
  logger.info(
    { url: `${env.API_BASE_URL}${API_PREFIX}`, environment: env.NODE_ENV, emailProvider: email.name, googleSignIn: Boolean(google), aiProvider: env.AI_PROVIDER, aiReady: services.aiRuntime.ai.isConfigured() },
    "API listening",
  );
});

const shutdown = createShutdown({
  server,
  disconnect: async () => {
    await Promise.allSettled([services.operations.close(), queues?.close(), redis?.quit()]);
    await prisma.$disconnect();
  },
  logger,
  exit: (code) => process.exit(code),
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
