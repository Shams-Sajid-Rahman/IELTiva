import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "../src/config/database.js";
import { runSeed } from "./seed-lib.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed the database");

const prisma = createPrismaClient(url);
try {
  await runSeed(prisma, process.env);
  console.log("Seed complete");
} finally {
  await prisma.$disconnect();
}
