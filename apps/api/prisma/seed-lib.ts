import type { PrismaClient } from "../src/generated/prisma/client.js";
import { AITier } from "../src/generated/prisma/enums.js";

const ROLE_MAPPING_SETTING = "seed.role_mapping_version";
const ROLE_MAPPING_VERSION = 5;

const roles = [
  { code: "STUDENT", name: "Student", description: "Learner using purchased and free practice" },
  { code: "INSTRUCTOR", name: "Instructor", description: "Creates and publishes their own courses" },
  { code: "MARKER", name: "Marker", description: "Marks assigned, de-identified calibration samples" },
  { code: "EDITOR", name: "Editor", description: "Authors and reviews content" },
  { code: "ADMIN", name: "Administrator", description: "Manages users, content and payments" },
  { code: "SUPER_ADMIN", name: "Super administrator", description: "Manages roles, AI routing and band releases" },
];

const permissions = [
  ["content.read", "Read published content"],
  ["content.write", "Create and edit draft content"],
  ["content.review", "Review content"],
  ["content.publish", "Publish content"],
  ["attempts.own", "Take exams and see own attempts"],
  ["assessments.review", "Review AI assessments"],
  ["calibration.mark", "Mark assigned calibration samples"],
  ["calibration.manage", "Manage calibration datasets and runs"],
  ["users.read", "View users"],
  ["users.manage", "Suspend and restore users"],
  ["roles.manage", "Change user roles"],
  ["payments.read", "View payments"],
  ["payments.manage", "Manage packages, pricing and payment checks"],
  ["refunds.manage", "Approve, reject and send refunds"],
  ["gateways.manage", "Switch payment gateways on and off"],
  ["operations.read", "View system health, queues and error counts"],
  ["release.manage", "Change feature switches, beta access and maintenance messages"],
  ["support.manage", "Handle feedback and incident records"],
  ["ai.usage.read", "View AI usage and cost"],
  ["ai.configure", "Change AI model configuration"],
  ["ai.band_release", "Approve public band releases"],
  ["settings.manage", "Change platform settings"],
  ["audit.read", "Read the audit log"],
  ["dashboard.admin", "View the administration overview and analytics"],
  ["roles.read", "View roles and permissions"],
  ["roles.assign", "Assign roles within your own authority"],
  ["courses.manage", "Create and edit courses you teach"],
  ["courses.manage_all", "Create and edit any course"],
  ["courses.publish", "Publish, unpublish and archive courses you can edit"],
  ["modules.manage", "Manage learning modules"],
  ["enrollments.read", "View all enrollments"],
  ["enrollments.manage", "Change any enrollment"],
  ["notifications.manage", "Create platform announcements"],
  ["settings.read", "View platform settings"],
] as const;

const editor = ["content.read", "content.write", "content.review", "courses.manage", "courses.manage_all", "modules.manage"];
const admin = [
  ...editor,
  "content.publish",
  "assessments.review",
  "calibration.manage",
  "users.read",
  "users.manage",
  "payments.read",
  "payments.manage",
  "refunds.manage",
  "operations.read",
  "support.manage",
  "ai.usage.read",
  "audit.read",
  "dashboard.admin",
  "roles.read",
  "roles.assign",
  "courses.publish",
  "enrollments.read",
  "enrollments.manage",
  "notifications.manage",
  "settings.read",
];

const rolePermissions: Record<string, string[]> = {
  STUDENT: ["content.read", "attempts.own"],
  INSTRUCTOR: ["content.read", "content.write", "content.review", "assessments.review", "courses.manage", "courses.publish"],
  MARKER: ["calibration.mark"],
  EDITOR: editor,
  ADMIN: admin,
  SUPER_ADMIN: permissions.map(([code]) => code),
};

const modules = [
  { code: "LISTENING", name: "Listening", skill: "LISTENING", position: 1 },
  { code: "READING", name: "Reading", skill: "READING", position: 2 },
  { code: "WRITING", name: "Writing", skill: "WRITING", position: 3 },
  { code: "SPEAKING", name: "Speaking", skill: "SPEAKING", position: 4 },
  { code: "GENERAL", name: "General IELTS preparation", skill: null, position: 5 },
] as const;

// Retention values are starting points, editable later without a code change.
const settings = [
  { key: "retention.speaking_recordings_days", value: 90, description: "Days before speaking recordings are deleted" },
  { key: "retention.expired_tokens_days", value: 7, description: "Days after expiry before tokens are purged" },
  { key: "retention.data_exports_days", value: 7, description: "Days before data exports are deleted" },
  { key: "retention.audit_ip_days", value: 365, description: "Days before IP addresses are cleared from the audit log" },
  { key: "privacy.deletion_cancel_window_days", value: 14, description: "Days a deletion request can be canceled" },
  { key: "regions.default", value: "BD", description: "Default region code" },
  { key: "regions.bd", value: { currency: "BDT", locale: "en", gateways: ["sslcommerz", "aamarpay"] }, description: "Bangladesh defaults" },
  { key: "billing.enforce_credits", value: false, description: "When true, AI feedback uses package credits. Off until packages are on sale" },
  { key: "billing.refund_window_days", value: 7, description: "Days after buying that a refund can be requested" },
];

const tierTasks: { taskKey: string; tier: AITier; effort: string; envKey: string }[] = [
  { taskKey: "writing.assess", tier: AITier.DEFAULT, effort: "high", envKey: "AI_MODEL_DEFAULT" },
  { taskKey: "writing.assess_complex", tier: AITier.COMPLEX, effort: "high", envKey: "AI_MODEL_COMPLEX" },
  { taskKey: "explain.light", tier: AITier.LIGHT, effort: "low", envKey: "AI_MODEL_LIGHT" },
];

export type SeedEnv = Record<string, string | undefined>;

/** Safe to run repeatedly. Existing settings and AI records keep any later changes. No user accounts are created. */
export async function runSeed(prisma: PrismaClient, env: SeedEnv) {
  for (const role of roles) {
    const { code, ...rest } = role;
    await prisma.role.upsert({ where: { code }, create: { ...role, isSystem: true }, update: { ...rest, isSystem: true } });
  }
  for (const [code, description] of permissions) {
    await prisma.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
  }

  const roleRows = await prisma.role.findMany({ where: { code: { in: roles.map((r) => r.code) } } });
  const permissionRows = await prisma.permission.findMany();
  const permissionId = new Map(permissionRows.map((p) => [p.code, p.id]));
  // Default mappings apply once per version, so a repeat seed can't undo an administrator's later change.
  const applied = await prisma.platformSetting.findUnique({ where: { key: ROLE_MAPPING_SETTING } });
  if (applied?.value !== ROLE_MAPPING_VERSION) {
    await prisma.rolePermission.createMany({
      data: roleRows.flatMap((role) =>
        (rolePermissions[role.code] ?? []).map((code) => ({ roleId: role.id, permissionId: permissionId.get(code)! })),
      ),
      skipDuplicates: true,
    });
    await prisma.platformSetting.upsert({
      where: { key: ROLE_MAPPING_SETTING },
      create: { key: ROLE_MAPPING_SETTING, value: ROLE_MAPPING_VERSION, description: "Applied default role mapping version" },
      update: { value: ROLE_MAPPING_VERSION },
    });
  }

  for (const learningModule of modules) {
    await prisma.learningModule.upsert({
      where: { code: learningModule.code },
      create: { ...learningModule, status: "PUBLISHED", publishedAt: new Date() },
      update: {},
    });
  }

  for (const setting of settings) {
    await prisma.platformSetting.upsert({ where: { key: setting.key }, create: setting, update: {} });
  }

  // Disabled and in sandbox mode until a later phase configures payments.
  await prisma.paymentGateway.upsert({
    where: { code: "sslcommerz" },
    create: { code: "sslcommerz", name: "SSLCommerz", regionCodes: ["BD"], currencies: ["BDT"] },
    update: {},
  });

  // Example routes come from the environment. They stay inactive with bands hidden.
  const provider = env.AI_PROVIDER;
  if (!provider) return;
  for (const { taskKey, tier, effort, envKey } of tierTasks) {
    const modelId = env[envKey];
    if (!modelId) continue;
    await prisma.aIModelConfiguration.upsert({
      where: { taskKey_provider_modelId: { taskKey, provider, modelId } },
      create: { taskKey, provider, modelId, tier, effort },
      update: {},
    });
  }
}
