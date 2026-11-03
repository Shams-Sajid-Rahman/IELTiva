import { createApp } from "./app.js";
import { API_PREFIX } from "./config/constants.js";
import { createPrismaClient } from "./config/database.js";
import { loadConfig } from "./config/env.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createAuthService } from "./services/auth.service.js";
import { createEmailProvider } from "./services/email/index.js";
import { createGoogleProvider } from "./services/google-oauth.service.js";
import { createTokenService } from "./services/token.service.js";
import { createShutdown } from "./utils/graceful-shutdown.js";
import { createLogger } from "./utils/logger.js";

const env = loadConfig();
const logger = createLogger(env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
const tokens = createTokenService(env);
const email = createEmailProvider(env, logger);
const google = createGoogleProvider(env);
const auth = createAuthService({ prisma, env, tokens, email, logger });

const app = createApp({
  env,
  logger,
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  authRouter: createAuthRouter({ env, auth, tokens, google }),
});

const server = app.listen(env.PORT, () => {
  logger.info(
    { url: `${env.API_BASE_URL}${API_PREFIX}`, environment: env.NODE_ENV, emailProvider: email.name, googleSignIn: Boolean(google) },
    "API listening",
  );
});

const shutdown = createShutdown({
  server,
  disconnect: () => prisma.$disconnect(),
  logger,
  exit: (code) => process.exit(code),
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
