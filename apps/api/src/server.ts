import { createApp } from "./app.js";
import { createPrismaClient } from "./config/database.js";
import { API_PREFIX } from "./config/constants.js";
import { loadConfig } from "./config/env.js";
import { createShutdown } from "./utils/graceful-shutdown.js";
import { createLogger } from "./utils/logger.js";

const env = loadConfig();
const logger = createLogger(env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);

const app = createApp({
  env,
  logger,
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});

const server = app.listen(env.PORT, () => {
  logger.info({ url: `${env.API_BASE_URL}${API_PREFIX}`, environment: env.NODE_ENV }, "API listening");
});

const shutdown = createShutdown({
  server,
  disconnect: () => prisma.$disconnect(),
  logger,
  exit: (code) => process.exit(code),
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
