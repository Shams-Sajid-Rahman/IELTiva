import { featureFlagDefinitions, type FeatureFlagKey, type ReleaseChannel } from "@ieltiva/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";

const FLAG_MEMORY_MS = 15_000;
const MAINTENANCE_KEY = "release.maintenance_message";
/** A student can leave several notes a day, but one account can't flood the team's queue. */
const DAILY_FEEDBACK_LIMIT = 20;

/**
 * Admin release controls: feature switches, private beta access, feedback and incident records.
 * A stored switch applies within about 15 seconds on every server, without a deployment.
 */
export function createReleaseService(prisma: PrismaClient, { channel }: { channel: ReleaseChannel | "test" }) {
  let memory: { until: number; values: Map<string, boolean> } | null = null;

  async function storedFlags() {
    if (memory && memory.until > Date.now()) return memory.values;
    const rows = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
    memory = { until: Date.now() + FLAG_MEMORY_MS, values: new Map(rows.map((row) => [row.key, row.enabled])) };
    return memory.values;
  }

  async function isEnabled(key: FeatureFlagKey) {
    const stored = (await storedFlags()).get(key);
    return stored ?? featureFlagDefinitions.find((flag) => flag.key === key)?.defaultOn ?? false;
  }

  /** On a beta or production server these two rules can't be switched off, however the switches are set. */
  const betaRequired = async () => channel === "beta" || (await isEnabled("beta.access_required"));
  const approvalRequired = async () => channel === "beta" || channel === "production" || (await isEnabled("content.publication_approval"));

  async function onAllowList(email: string) {
    return (await prisma.betaAccess.count({ where: { email: email.toLowerCase(), status: "ALLOWED" } })) > 0;
  }

  return {
    channel,
    isEnabled,
    approvalRequired,

    /** Used when a new account is created. */
    async canRegister(email: string) {
      if (!(await isEnabled("registration.open"))) return { allowed: false, message: "New accounts aren't being created right now." };
      if ((await betaRequired()) && !(await onAllowList(email))) return { allowed: false, message: "IELTiva is in a private beta, and this email isn't on the list." };
      return { allowed: true, message: "" };
    },

    /** Used at every sign-in. Staff always get in, so a beta can't lock out the people running it. */
    async canSignIn(userId: string, email: string) {
      if (!(await betaRequired()) || (await onAllowList(email))) return { allowed: true, message: "" };
      const staff = await prisma.userRole.count({ where: { userId, role: { code: { not: "STUDENT" } } } });
      return staff > 0 ? { allowed: true, message: "" } : { allowed: false, message: "IELTiva is in a private beta, and this account isn't on the list." };
    },

    /** What every visitor's browser may know. It holds no personal data. */
    async publicState() {
      const flags = await Promise.all(featureFlagDefinitions.map(async (flag) => [flag.key, await isEnabled(flag.key)] as const));
      const message = await prisma.platformSetting.findUnique({ where: { key: MAINTENANCE_KEY }, select: { value: true } });
      return { channel, betaRequired: await betaRequired(), maintenanceMessage: typeof message?.value === "string" ? message.value : null, flags: Object.fromEntries(flags) };
    },

    async adminOverview() {
      const [state, rows, releases] = await Promise.all([
        this.publicState(),
        prisma.featureFlag.findMany({ select: { key: true, updatedAt: true, updatedBy: { select: { email: true } } } }),
        prisma.bandRelease.groupBy({ by: ["visibility"], _count: { _all: true } }),
      ]);
      return {
        ...state,
        // These can't be changed here, and are shown so nobody assumes the switch alone decides.
        locked: { betaRequired: channel === "beta", approvalRequired: channel === "beta" || channel === "production" },
        approvalRequired: await approvalRequired(),
        flagDetails: featureFlagDefinitions.map((flag) => {
          const row = rows.find((item) => item.key === flag.key);
          return { key: flag.key, defaultOn: flag.defaultOn, enabled: state.flags[flag.key] ?? flag.defaultOn, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy?.email ?? null };
        }),
        bandReleases: Object.fromEntries(releases.map((row) => [row.visibility, row._count._all])),
      };
    },

    async setFlag(actor: Actor, key: FeatureFlagKey, enabled: boolean) {
      await prisma.featureFlag.upsert({ where: { key }, create: { key, enabled, updatedById: actor.userId }, update: { enabled, updatedById: actor.userId } });
      await recordAudit(prisma, actor, { action: "release.flag_set", entityType: "feature_flag", entityId: key, after: { enabled } });
      memory = null;
      return { key, enabled };
    },

    async setMaintenanceMessage(actor: Actor, message: string | null) {
      await prisma.platformSetting.upsert({
        where: { key: MAINTENANCE_KEY },
        create: { key: MAINTENANCE_KEY, value: message ?? Prisma.JsonNull, description: "Message shown across the app during planned work" },
        update: { value: message ?? Prisma.JsonNull },
      });
      await recordAudit(prisma, actor, { action: "release.maintenance_message", entityType: "platform_setting", entityId: MAINTENANCE_KEY, after: { message } });
      return { message };
    },

    // ----- Beta access -----

    async listBeta(query: { page: number; pageSize: number }) {
      const [items, total] = await prisma.$transaction([
        prisma.betaAccess.findMany({ orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, email: true, status: true, note: true, createdAt: true } }),
        prisma.betaAccess.count(),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    /** Only records that the address may enter. No message is sent to anyone. */
    async addBeta(actor: Actor, input: { email: string; note?: string | null | undefined }) {
      const row = await prisma.betaAccess.upsert({ where: { email: input.email }, create: { email: input.email, note: input.note ?? null, addedById: actor.userId }, update: { status: "ALLOWED", note: input.note ?? null } });
      await recordAudit(prisma, actor, { action: "release.beta_allow", entityType: "beta_access", entityId: row.id });
      return row;
    },

    /** Also ends any open sessions, so removal applies at once on a beta server. */
    async revokeBeta(actor: Actor, id: string) {
      const row = await prisma.betaAccess.findUnique({ where: { id } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This entry wasn't found.");
      await prisma.betaAccess.update({ where: { id }, data: { status: "REVOKED" } });
      if (await betaRequired()) {
        const now = new Date();
        await prisma.refreshToken.updateMany({ where: { revokedAt: null, session: { user: { email: row.email } } }, data: { revokedAt: now } });
        await prisma.userSession.updateMany({ where: { revokedAt: null, user: { email: row.email, userRoles: { every: { role: { code: "STUDENT" } } } } }, data: { revokedAt: now } });
      }
      await recordAudit(prisma, actor, { action: "release.beta_revoke", entityType: "beta_access", entityId: id });
    },

    // ----- Feedback -----

    async submitFeedback(actor: Actor, input: { category: string; message: string; page?: string | null | undefined }) {
      if (!(await isEnabled("feedback.collection"))) throw new AppError(503, "SERVICE_UNAVAILABLE", "Feedback isn't open right now.");
      const today = await prisma.betaFeedback.count({ where: { userId: actor.userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if (today >= DAILY_FEEDBACK_LIMIT) throw new AppError(429, "RATE_LIMITED", "You've sent a lot of feedback today. Thank you! Please try again tomorrow.");
      const row = await prisma.betaFeedback.create({ data: { userId: actor.userId, category: input.category, message: input.message, page: input.page ?? null } });
      return { id: row.id };
    },

    async listFeedback(query: { page: number; pageSize: number; status?: "NEW" | "TRIAGED" | "RESOLVED" | undefined }) {
      const where = query.status ? { status: query.status } : {};
      const [items, total] = await prisma.$transaction([
        prisma.betaFeedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, category: true, message: true, page: true, status: true, staffNote: true, createdAt: true, user: { select: { email: true } } } }),
        prisma.betaFeedback.count({ where }),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async updateFeedback(actor: Actor, id: string, input: { status: "NEW" | "TRIAGED" | "RESOLVED"; staffNote?: string | null | undefined }) {
      const found = await prisma.betaFeedback.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new AppError(404, "NOT_FOUND", "This feedback wasn't found.");
      await prisma.betaFeedback.update({ where: { id }, data: { status: input.status, ...(input.staffNote === undefined ? {} : { staffNote: input.staffNote }) } });
      await recordAudit(prisma, actor, { action: "feedback.update", entityType: "beta_feedback", entityId: id, after: { status: input.status } });
    },

    // ----- Incidents -----

    async listIncidents(query: { page: number; pageSize: number; status?: "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED" | undefined }) {
      const where = query.status ? { status: query.status } : {};
      const [items, total] = await prisma.$transaction([
        prisma.incident.findMany({ where, orderBy: { startedAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { openedBy: { select: { email: true } }, updates: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, body: true, status: true, createdAt: true, author: { select: { email: true } } } } } }),
        prisma.incident.count({ where }),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async openIncident(actor: Actor, input: { title: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; summary: string; personalDataAffected: boolean; paymentsAffected: boolean }) {
      const row = await prisma.incident.create({ data: { ...input, openedById: actor.userId } });
      await recordAudit(prisma, actor, { action: "incident.open", entityType: "incident", entityId: row.id, after: { severity: row.severity } });
      return row;
    },

    async updateIncident(actor: Actor, id: string, input: { body: string; status?: "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED" | undefined }) {
      const found = await prisma.incident.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new AppError(404, "NOT_FOUND", "This incident wasn't found.");
      await prisma.$transaction(async (tx) => {
        await tx.incidentUpdate.create({ data: { incidentId: id, authorId: actor.userId, body: input.body, status: input.status ?? null } });
        if (input.status) await tx.incident.update({ where: { id }, data: { status: input.status, resolvedAt: input.status === "RESOLVED" ? new Date() : null } });
        await recordAudit(tx, actor, { action: "incident.update", entityType: "incident", entityId: id, after: { status: input.status ?? null } });
      });
    },
  };
}

export type ReleaseService = ReturnType<typeof createReleaseService>;
