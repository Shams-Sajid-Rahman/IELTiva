import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib.js";
import { createPrismaClient } from "../src/config/database.js";

const apiRoot = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.resolve(apiRoot, "../../.env"), quiet: true });

// Every test here runs in a new database, created and dropped by this file. No other database is touched.
const dbName = `ieltiva_disposable_${Date.now()}`;
const baseUrl = new URL(process.env.TEST_DATABASE_URL!);
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
const url = new URL(baseUrl);
url.pathname = `/${dbName}`;

function prismaCli(args: string) {
  return execSync(`npx prisma ${args}`, { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url.href }, encoding: "utf8", stdio: "pipe" });
}

async function admin(sql: string) {
  const client = new Client({ connectionString: adminUrl.href });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

let prisma: ReturnType<typeof createPrismaClient>;
const seedEnv = { AI_PROVIDER: "example-provider", AI_MODEL_DEFAULT: "m-default", AI_MODEL_COMPLEX: "m-complex", AI_MODEL_LIGHT: "m-light" };

async function counts() {
  return {
    roles: await prisma.role.count(),
    permissions: await prisma.permission.count(),
    mappings: await prisma.rolePermission.count(),
    modules: await prisma.learningModule.count(),
    settings: await prisma.platformSetting.count(),
    gateways: await prisma.paymentGateway.count(),
    aiConfigs: await prisma.aIModelConfiguration.count(),
    users: await prisma.user.count(),
  };
}

async function publishedExam(slug: string) {
  const exam = await prisma.exam.create({ data: { slug, title: slug } });
  const version = await prisma.examVersion.create({ data: { examId: exam.id, versionNumber: 1 } });
  const section = await prisma.examSection.create({
    data: { examVersionId: version.id, position: 1, skill: "READING", title: "Section", durationSeconds: 1200 },
  });
  const group = await prisma.questionGroup.create({ data: { sectionId: section.id, position: 1, type: "SHORT_ANSWER" } });
  const question = await prisma.question.create({ data: { groupId: group.id, number: 1 } });
  await prisma.examVersion.update({ where: { id: version.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  return { exam, version, section, group, question };
}

function newUser(tag: string) {
  return prisma.user.create({ data: { email: `${tag}-${Date.now()}@example.com` } });
}

beforeAll(async () => {
  await admin(`CREATE DATABASE "${dbName}"`);
  prismaCli("migrate deploy");
  prisma = createPrismaClient(url.href);
  await runSeed(prisma, seedEnv);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
});

describe("migrations", () => {
  it("apply to an empty database and match the schema exactly", () => {
    const output = prismaCli("migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script");
    expect(output).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP |CREATE (UNIQUE )?INDEX/);
  });

  it("have nothing left to apply on a second run", () => {
    expect(prismaCli("migrate deploy")).toMatch(/No pending migrations/);
  });

  it("create the expected table count, foreign keys, indexes and triggers", async () => {
    const rows = await prisma.$queryRaw<{ tables: bigint; fks: bigint; indexes: bigint; triggers: bigint }[]>`
      SELECT
        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations') AS tables,
        (SELECT count(*) FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY') AS fks,
        (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS indexes,
        (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers`;
    const row = rows[0]!;
    expect(Number(row.tables)).toBe(57);
    expect(Number(row.fks)).toBeGreaterThan(70);
    expect(Number(row.indexes)).toBeGreaterThan(130);
    expect(Number(row.triggers)).toBe(12);
  });

  it("include every important named index", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = rows.map((r) => r.indexname);
    for (const name of [
      "users_email_key",
      "exam_attempts_one_in_progress",
      "exam_versions_one_published",
      "payment_transactions_gateway_id_gateway_transaction_id_key",
      "payment_transactions_idempotency_key_key",
      "ai_usage_logs_task_key_created_at_idx",
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe("seed", () => {
  it("creates defaults and no users, without duplicating on repeat runs", async () => {
    const first = await counts();
    expect(first).toEqual({ roles: 6, permissions: 29, mappings: expect.any(Number), modules: 5, settings: 7, gateways: 1, aiConfigs: 3, users: 0 });
    await runSeed(prisma, seedEnv);
    await runSeed(prisma, seedEnv);
    expect(await counts()).toEqual(first);
  });

  it("keeps later changes on repeat runs and stays closed by default", async () => {
    await prisma.platformSetting.update({ where: { key: "retention.speaking_recordings_days" }, data: { value: 30 } });
    await runSeed(prisma, seedEnv);
    const setting = await prisma.platformSetting.findUniqueOrThrow({ where: { key: "retention.speaking_recordings_days" } });
    expect(setting.value).toBe(30);
    const configs = await prisma.aIModelConfiguration.findMany();
    expect(configs.every((c) => c.bandVisibility === "HIDDEN" && !c.isActive)).toBe(true);
    const gateway = await prisma.paymentGateway.findUniqueOrThrow({ where: { code: "sslcommerz" } });
    expect(gateway.isEnabled).toBe(false);
  });

  it("doesn't restore a permission an administrator removed", async () => {
    const instructor = await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" }, include: { permissions: true } });
    const removed = instructor.permissions[0]!;
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: removed.roleId, permissionId: removed.permissionId } } });
    await runSeed(prisma, seedEnv);
    expect(await prisma.rolePermission.count({ where: { roleId: removed.roleId, permissionId: removed.permissionId } })).toBe(0);
    await prisma.rolePermission.create({ data: { roleId: removed.roleId, permissionId: removed.permissionId } });
  });

  it("gives the super admin every permission and students only their own", async () => {
    const all = await prisma.permission.count();
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, include: { permissions: true } });
    expect(superAdmin.permissions).toHaveLength(all);
    const student = await prisma.role.findUniqueOrThrow({ where: { code: "STUDENT" }, include: { permissions: { include: { permission: true } } } });
    expect(student.permissions.map((p) => p.permission.code).sort()).toEqual(["attempts.own", "content.read"]);
  });
});

describe("constraints", () => {
  it("prevents duplicate accounts and mixed-case emails", async () => {
    await prisma.user.create({ data: { email: "dup@example.com" } });
    await expect(prisma.user.create({ data: { email: "dup@example.com" } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { email: "Mixed@example.com" } })).rejects.toThrow();
  });

  it("enforces foreign keys and restrict rules", async () => {
    await expect(prisma.userProfile.create({ data: { userId: "00000000-0000-7000-8000-000000000000", firstName: "A", lastName: "B" } })).rejects.toThrow();
    const student = await prisma.role.findUniqueOrThrow({ where: { code: "STUDENT" } });
    const user = await newUser("role");
    await prisma.userRole.create({ data: { userId: user.id, roleId: student.id } });
    await expect(prisma.role.delete({ where: { id: student.id } })).rejects.toThrow();
  });

  it("cascades authentication data when a user is removed", async () => {
    const user = await newUser("cascade");
    const session = await prisma.userSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 1000) } });
    await prisma.refreshToken.create({ data: { userId: user.id, sessionId: session.id, familyId: session.id, tokenHash: `h-${user.id}`, expiresAt: new Date() } });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects invalid band values", async () => {
    const user = await newUser("band");
    await expect(prisma.userProfile.create({ data: { userId: user.id, firstName: "A", lastName: "B", targetBand: 6.3 } })).rejects.toThrow();
    await expect(prisma.userProfile.create({ data: { userId: user.id, firstName: "A", lastName: "B", targetBand: 9.5 } })).rejects.toThrow();
    await expect(prisma.userProfile.create({ data: { userId: user.id, firstName: "A", lastName: "B", targetBand: 6.5 } })).resolves.toBeTruthy();
  });

  it("blocks a public band without validation and approvals", async () => {
    const config = await prisma.aIModelConfiguration.findFirstOrThrow();
    await expect(prisma.aIModelConfiguration.update({ where: { id: config.id }, data: { bandVisibility: "PUBLIC" } })).rejects.toThrow(/ai_public_band_requires_validation/);
  });

  it("prevents duplicate transactions and overspent credits", async () => {
    const user = await newUser("pay");
    const gateway = await prisma.paymentGateway.findUniqueOrThrow({ where: { code: "sslcommerz" } });
    const pack = await prisma.assessmentPackage.create({ data: { code: "w5", name: "Writing 5", skill: "WRITING", credits: 5, currency: "BDT", priceMinor: 100 } });
    const purchase = await prisma.userPurchase.create({
      data: { userId: user.id, assessmentPackageId: pack.id, currency: "BDT", amountMinor: 100, packageSnapshot: { code: pack.code } },
    });
    const base = { purchaseId: purchase.id, gatewayId: gateway.id, currency: "BDT", amountMinor: 100 };
    await prisma.paymentTransaction.create({ data: { ...base, trackingId: "t1", idempotencyKey: "k1", gatewayTransactionId: "g1" } });
    await expect(prisma.paymentTransaction.create({ data: { ...base, trackingId: "t2", idempotencyKey: "k2", gatewayTransactionId: "g1" } })).rejects.toThrow();
    await expect(prisma.paymentTransaction.create({ data: { ...base, trackingId: "t3", idempotencyKey: "k1" } })).rejects.toThrow();
    await expect(prisma.userPurchase.create({ data: { userId: user.id, currency: "BDT", amountMinor: 1, packageSnapshot: {} } })).rejects.toThrow(/user_purchases_one_package/);
    await expect(
      prisma.userEntitlement.create({ data: { userId: user.id, featureKey: "writing", creditsGranted: 1, creditsUsed: 2 } }),
    ).rejects.toThrow(/user_entitlements_credits_valid/);
  });
});

describe("published exam content", () => {
  it("can't be changed or deleted, but can be archived", async () => {
    const { version, section, question } = await publishedExam("immutable");
    await expect(prisma.question.update({ where: { id: question.id }, data: { prompt: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.question.delete({ where: { id: question.id } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.questionAnswer.create({ data: { questionId: question.id, acceptedValue: "new" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.examSection.update({ where: { id: section.id }, data: { title: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.examVersion.update({ where: { id: version.id }, data: { sourceNote: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.examVersion.update({ where: { id: version.id }, data: { status: "DRAFT" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.examVersion.delete({ where: { id: version.id } })).rejects.toThrow();
    await expect(prisma.examVersion.update({ where: { id: version.id }, data: { status: "ARCHIVED", archivedAt: new Date() } })).resolves.toBeTruthy();
  });

  it("stays editable while still a draft", async () => {
    const exam = await prisma.exam.create({ data: { slug: "draft", title: "Draft" } });
    const version = await prisma.examVersion.create({ data: { examId: exam.id, versionNumber: 1 } });
    const section = await prisma.examSection.create({ data: { examVersionId: version.id, position: 1, skill: "WRITING", title: "A", durationSeconds: 60 } });
    await expect(prisma.examSection.update({ where: { id: section.id }, data: { title: "B" } })).resolves.toBeTruthy();
    await expect(prisma.examVersion.delete({ where: { id: version.id } })).resolves.toBeTruthy();
  });

  it("allows attempts only on published versions, with one in progress per student", async () => {
    const user = await newUser("attempt");
    const exam = await prisma.exam.create({ data: { slug: "unpublished", title: "U" } });
    const draft = await prisma.examVersion.create({ data: { examId: exam.id, versionNumber: 1 } });
    await expect(prisma.examAttempt.create({ data: { userId: user.id, examVersionId: draft.id, mode: "TIMED" } })).rejects.toThrow(/published/);

    const { version, section, question } = await publishedExam("attemptable");
    const attempt = await prisma.examAttempt.create({ data: { userId: user.id, examVersionId: version.id, mode: "TIMED" } });
    await expect(prisma.examAttempt.create({ data: { userId: user.id, examVersionId: version.id, mode: "TIMED" } })).rejects.toThrow();

    // Autosave updates one response row, so history stays consistent.
    const sectionAttempt = await prisma.sectionAttempt.create({ data: { examAttemptId: attempt.id, sectionId: section.id } });
    const key = { sectionAttemptId_questionId: { sectionAttemptId: sectionAttempt.id, questionId: question.id } };
    for (const text of ["first", "second"]) {
      await prisma.questionResponse.upsert({
        where: key,
        create: { sectionAttemptId: sectionAttempt.id, questionId: question.id, response: { text } },
        update: { response: { text } },
      });
    }
    expect((await prisma.questionResponse.findUniqueOrThrow({ where: key })).response).toEqual({ text: "second" });

    await prisma.examAttempt.update({ where: { id: attempt.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await expect(prisma.examAttempt.create({ data: { userId: user.id, examVersionId: version.id, mode: "PRACTICE" } })).resolves.toBeTruthy();
  });
});
