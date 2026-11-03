import type { Env } from "../config/env.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import type { AuthContext } from "./auth.js";
import type { Logger } from "../utils/logger.js";

export type Db = PrismaClient | Prisma.TransactionClient;

export type Actor = AuthContext & { ipAddress?: string };

export type ServiceDeps = {
  prisma: PrismaClient;
  env: Pick<Env, "FRONTEND_URL">;
  logger: Pick<Logger, "warn" | "error" | "info">;
};

export const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING"] as const;
