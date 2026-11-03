import type { PrismaClient } from "../../generated/prisma/client.js";

type DayRow = { day: Date; gross: bigint; count: bigint };

/**
 * Revenue comes only from payments a gateway confirmed, and refunds only once completed.
 * Each currency is reported on its own, because amounts in different currencies can't be added.
 */
export function createRevenueService(prisma: PrismaClient) {
  return {
    async summary(query: { days: number; currency?: string | undefined }) {
      const since = new Date(Date.now() - query.days * 86_400_000);
      const currencies = query.currency ? [query.currency] : (await prisma.paymentTransaction.findMany({ where: { status: { in: ["SUCCEEDED", "REFUNDED"] } }, distinct: ["currency"], select: { currency: true } })).map((row) => row.currency);

      const byCurrency = [];
      for (const currency of currencies) {
        const [paid, refunded, daily, perPackage, perGateway, statuses] = await Promise.all([
          prisma.paymentTransaction.aggregate({ where: { currency, status: { in: ["SUCCEEDED", "REFUNDED"] }, succeededAt: { gte: since } }, _sum: { amountMinor: true }, _count: { _all: true } }),
          prisma.refundRecord.aggregate({ where: { currency, status: "COMPLETED", completedAt: { gte: since } }, _sum: { amountMinor: true }, _count: { _all: true } }),
          prisma.$queryRaw<DayRow[]>`
            SELECT date_trunc('day', succeeded_at) AS day, SUM(amount_minor)::bigint AS gross, COUNT(*)::bigint AS count
            FROM payment_transactions
            WHERE currency = ${currency} AND status IN ('SUCCEEDED'::"PaymentStatus", 'REFUNDED'::"PaymentStatus") AND succeeded_at >= ${since}
            GROUP BY 1 ORDER BY 1`,
          prisma.$queryRaw<{ name: string; gross: bigint; count: bigint }[]>`
            SELECT COALESCE(p.package_snapshot->'package'->>'name', 'Package') AS name, SUM(t.amount_minor)::bigint AS gross, COUNT(*)::bigint AS count
            FROM payment_transactions t JOIN user_purchases p ON p.id = t.purchase_id
            WHERE t.currency = ${currency} AND t.status IN ('SUCCEEDED'::"PaymentStatus", 'REFUNDED'::"PaymentStatus") AND t.succeeded_at >= ${since}
            GROUP BY 1 ORDER BY gross DESC LIMIT 10`,
          prisma.$queryRaw<{ name: string; gross: bigint; count: bigint }[]>`
            SELECT g.name AS name, SUM(t.amount_minor)::bigint AS gross, COUNT(*)::bigint AS count
            FROM payment_transactions t JOIN payment_gateways g ON g.id = t.gateway_id
            WHERE t.currency = ${currency} AND t.status IN ('SUCCEEDED'::"PaymentStatus", 'REFUNDED'::"PaymentStatus") AND t.succeeded_at >= ${since}
            GROUP BY 1 ORDER BY gross DESC`,
          prisma.paymentTransaction.groupBy({ by: ["status"], where: { currency, createdAt: { gte: since } }, _count: { _all: true } }),
        ]);
        const gross = paid._sum.amountMinor ?? 0;
        const refundedMinor = refunded._sum.amountMinor ?? 0;
        byCurrency.push({
          currency,
          grossMinor: gross,
          refundedMinor,
          netMinor: gross - refundedMinor,
          payments: paid._count._all,
          refunds: refunded._count._all,
          averageOrderMinor: paid._count._all ? Math.floor(gross / paid._count._all) : 0,
          daily: daily.map((row) => ({ day: row.day.toISOString().slice(0, 10), grossMinor: Number(row.gross), payments: Number(row.count) })),
          packages: perPackage.map((row) => ({ name: row.name, grossMinor: Number(row.gross), payments: Number(row.count) })),
          gateways: perGateway.map((row) => ({ name: row.name, grossMinor: Number(row.gross), payments: Number(row.count) })),
          statuses: Object.fromEntries(statuses.map((row) => [row.status, row._count._all])),
        });
      }
      const pendingRefunds = await prisma.refundRecord.count({ where: { status: "REQUESTED" } });
      return { days: query.days, currencies: byCurrency, pendingRefunds };
    },
  };
}

export type RevenueService = ReturnType<typeof createRevenueService>;
