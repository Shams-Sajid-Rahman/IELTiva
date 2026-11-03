import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { Db } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";

/** Features that open premium courses and exams for as long as the entitlement is active. */
export const PREMIUM_FEATURES = ["practice_pass", "listening_tests", "reading_tests", "mock_tests"] as const;

export type CreditRef = { type: string; id: string };

type Candidate = { id: string; feature_key: string; credits_granted: number | null };

export function createEntitlementService(prisma: PrismaClient) {
  async function inTransaction<T>(db: Db, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return "$transaction" in db ? db.$transaction((tx) => work(tx)) : work(db);
  }

  /** Marks entitlements whose time has run out. Reads also ignore them, so this only keeps the stored status tidy. */
  async function expireDue(db: Db = prisma) {
    const result = await db.userEntitlement.updateMany({ where: { status: "ACTIVE", endsAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
    return result.count;
  }

  /**
   * Uses one credit from the entitlement that expires first. A repeat call for the same item uses nothing more,
   * and two requests for the last credit can't both succeed because the row is locked while it's checked.
   */
  async function consume(db: Db, userId: string, featureKeys: readonly string[], ref: CreditRef, reason: string) {
    return inTransaction(db, async (tx) => {
      const already = await tx.creditLedger.findFirst({ where: { userId, featureKey: { in: [...featureKeys] }, refType: ref.type, refId: ref.id } });
      if (already) return { entitlementId: already.entitlementId, featureKey: already.featureKey, charged: false };

      const rows = await tx.$queryRaw<Candidate[]>`
        SELECT id, feature_key, credits_granted FROM user_entitlements
        WHERE user_id = ${userId}::uuid AND feature_key = ANY(${[...featureKeys]}::text[])
          AND status = 'ACTIVE'::"EntitlementStatus" AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
          AND (credits_granted IS NULL OR credits_used + credits_reserved < credits_granted)
        ORDER BY ends_at ASC NULLS LAST, created_at ASC
        LIMIT 1
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new AppError(403, "ENTITLEMENT_REQUIRED", "You don't have a package with credits left for this. You can buy one on the Packages page.");

      if (row.credits_granted !== null) {
        await tx.$executeRaw`
          UPDATE user_entitlements
          SET credits_used = credits_used + 1,
              status = CASE WHEN credits_used + 1 + credits_reserved >= credits_granted THEN 'EXHAUSTED'::"EntitlementStatus" ELSE status END,
              updated_at = now()
          WHERE id = ${row.id}::uuid`;
      }
      await tx.creditLedger.create({
        data: { userId, entitlementId: row.id, featureKey: row.feature_key, delta: row.credits_granted === null ? 0 : -1, reason, refType: ref.type, refId: ref.id },
      });
      return { entitlementId: row.id, featureKey: row.feature_key, charged: true };
    });
  }

  /** Gives a credit back, for example when feedback couldn't be produced. Doing it twice gives back once. */
  async function release(db: Db, userId: string, ref: CreditRef) {
    await inTransaction(db, async (tx) => {
      const used = await tx.creditLedger.findFirst({ where: { userId, refType: ref.type, refId: ref.id, delta: { lte: 0 } } });
      if (!used) return;
      const released = await tx.creditLedger.findFirst({ where: { userId, refType: `${ref.type}:release`, refId: ref.id } });
      if (released) return;
      if (used.delta < 0) {
        await tx.$executeRaw`
          UPDATE user_entitlements
          SET credits_used = GREATEST(credits_used - 1, 0),
              status = CASE WHEN status = 'EXHAUSTED'::"EntitlementStatus" AND (ends_at IS NULL OR ends_at > now()) THEN 'ACTIVE'::"EntitlementStatus" ELSE status END,
              updated_at = now()
          WHERE id = ${used.entitlementId}::uuid`;
      }
      await tx.creditLedger.create({
        data: { userId, entitlementId: used.entitlementId, featureKey: used.featureKey, delta: used.delta < 0 ? 1 : 0, reason: "released", refType: `${ref.type}:release`, refId: ref.id },
      });
    });
  }

  /** Creates what a paid purchase includes. Running it again for the same purchase changes nothing. */
  async function grantForPurchase(tx: Prisma.TransactionClient, purchase: { id: string; userId: string; packageId: string | null; paidAt: Date }, features: { featureKey: string; quantity: number | null }[], validityDays: number | null) {
    const endsAt = validityDays ? new Date(purchase.paidAt.getTime() + validityDays * 86_400_000) : null;
    for (const feature of features) {
      const exists = await tx.userEntitlement.findFirst({ where: { purchaseId: purchase.id, featureKey: feature.featureKey } });
      if (exists) continue;
      const entitlement = await tx.userEntitlement.create({
        data: { userId: purchase.userId, purchaseId: purchase.id, packageId: purchase.packageId, featureKey: feature.featureKey, creditsGranted: feature.quantity, startsAt: purchase.paidAt, endsAt },
      });
      await tx.creditLedger.create({
        data: { userId: purchase.userId, entitlementId: entitlement.id, featureKey: feature.featureKey, delta: feature.quantity ?? 0, reason: "purchase", refType: "purchase", refId: purchase.id },
      });
    }
  }

  /** Stops whatever is left of a refunded purchase. */
  async function revokeForPurchase(tx: Prisma.TransactionClient, purchaseId: string) {
    await tx.userEntitlement.updateMany({ where: { purchaseId, status: { in: ["ACTIVE", "EXHAUSTED"] } }, data: { status: "REVOKED" } });
  }

  async function hasPremiumAccess(db: Db, userId: string) {
    const now = new Date();
    return (
      (await db.userEntitlement.count({
        where: { userId, featureKey: { in: [...PREMIUM_FEATURES] }, status: "ACTIVE", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      })) > 0
    );
  }

  return {
    consume,
    release,
    expireDue,
    grantForPurchase,
    revokeForPurchase,
    hasPremiumAccess,

    /** What a student can use right now, worked out from the stored rows. */
    async balance(userId: string) {
      await expireDue();
      const now = new Date();
      const rows = await prisma.userEntitlement.findMany({
        where: { userId, OR: [{ status: "ACTIVE" }, { status: { in: ["EXHAUSTED", "EXPIRED"] }, updatedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }] },
        orderBy: [{ endsAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        include: { package: { select: { name: true, code: true } } },
      });
      const entitlements = rows.map((row) => ({
        id: row.id,
        featureKey: row.featureKey,
        packageName: row.package?.name ?? "Practice pass",
        status: row.status,
        unlimited: row.creditsGranted === null,
        granted: row.creditsGranted,
        used: row.creditsUsed,
        remaining: row.creditsGranted === null ? null : Math.max(0, row.creditsGranted - row.creditsUsed - row.creditsReserved),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }));
      const totals = new Map<string, { featureKey: string; remaining: number; unlimited: boolean; nextExpiry: Date | null }>();
      for (const row of entitlements.filter((item) => item.status === "ACTIVE")) {
        const total = totals.get(row.featureKey) ?? { featureKey: row.featureKey, remaining: 0, unlimited: false, nextExpiry: null };
        total.unlimited ||= row.unlimited;
        total.remaining += row.remaining ?? 0;
        if (row.endsAt && (!total.nextExpiry || row.endsAt < total.nextExpiry)) total.nextExpiry = row.endsAt;
        totals.set(row.featureKey, total);
      }
      return { totals: [...totals.values()], entitlements };
    },

    async history(userId: string, query: { page: number; pageSize: number }) {
      const where = { userId };
      const [items, total] = await prisma.$transaction([
        prisma.creditLedger.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, featureKey: true, delta: true, reason: true, createdAt: true } }),
        prisma.creditLedger.count({ where }),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },
  };
}

export type EntitlementService = ReturnType<typeof createEntitlementService>;
