import path from "node:path";
import { config as loadEnv } from "dotenv";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/config/database.js";
import { buildApp } from "./helpers.js";

const root = path.resolve(import.meta.dirname, "../../..");
loadEnv({ path: [path.join(root, ".env.test"), path.join(root, ".env")], quiet: true });
const url = process.env.TEST_DATABASE_URL;

describe("real PostgreSQL connection", () => {
  it("has TEST_DATABASE_URL set", () => {
    expect(url, "Set TEST_DATABASE_URL to a migrated test database").toBeTruthy();
  });

  it("connects to PostgreSQL, reads the migrated table and reports healthy", async () => {
    const prisma = createPrismaClient(url!);
    try {
      const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
      expect(rows[0]?.version).toMatch(/^PostgreSQL 18/);
      await expect(prisma.appMetadata.count()).resolves.toBeGreaterThanOrEqual(0);
      const app = buildApp(async () => {
        await prisma.$queryRaw`SELECT 1`;
      });
      const res = await request(app).get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.body.data.database).toBe("connected");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("reports disconnected for an unreachable server", async () => {
    const prisma = createPrismaClient("postgresql://nobody:nothing@127.0.0.1:1/none");
    try {
      const app = buildApp(async () => {
        await prisma.$queryRaw`SELECT 1`;
      });
      const res = await request(app).get("/api/v1/health");
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain("nobody");
    } finally {
      await prisma.$disconnect();
    }
  });
});
