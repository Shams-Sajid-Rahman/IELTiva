import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export function createPrismaClient(databaseUrl: string) {
  const adapter = new PrismaPg({
    // Prisma sends times in UTC, so the session must read them as UTC whatever the server's own timezone is.
    // The time limits stop one stuck query or forgotten transaction from holding a connection indefinitely.
    options: "-c timezone=UTC -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX) || 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}
