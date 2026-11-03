import type { z } from "zod";
import type { packageInputSchema, packageUpdateSchema } from "@ieltiva/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import type { Cache } from "../cache.js";

type PackageInput = z.infer<typeof packageInputSchema>;
type PackageUpdate = z.infer<typeof packageUpdateSchema>;

const include = {
  prices: { orderBy: { currency: "asc" } },
  features: { orderBy: { featureKey: "asc" } },
} satisfies Prisma.PackageInclude;

type PackageRow = Prisma.PackageGetPayload<{ include: typeof include }>;

const view = (row: PackageRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  category: row.category,
  validityDays: row.validityDays,
  isActive: row.isActive,
  isFeatured: row.isFeatured,
  sortOrder: row.sortOrder,
  prices: row.prices.map((price) => ({ currency: price.currency, amountMinor: price.amountMinor, isActive: price.isActive })),
  features: row.features.map((feature) => ({ featureKey: feature.featureKey, quantity: feature.quantity })),
  updatedAt: row.updatedAt,
});

const PUBLIC_KEY = "packages:";

export function createPackageService(prisma: PrismaClient, cache?: Cache) {
  const changed = () => cache?.invalidate("public", PUBLIC_KEY);
  const find = async (id: string) => {
    const row = await prisma.package.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw new AppError(404, "NOT_FOUND", "This package wasn't found.");
    return row;
  };

  function checkSellable(input: { isActive?: boolean | undefined; prices?: { isActive?: boolean | undefined }[] | undefined; features?: unknown[] | undefined }) {
    if (!input.isActive) return;
    if (input.prices && !input.prices.some((price) => price.isActive !== false)) throw new AppError(400, "VALIDATION_ERROR", "A package on sale needs at least one active price.");
    if (input.features && input.features.length === 0) throw new AppError(400, "VALIDATION_ERROR", "A package on sale needs at least one feature.");
  }

  async function writeChildren(tx: Prisma.TransactionClient, packageId: string, input: { prices?: PackageInput["prices"] | undefined; features?: PackageInput["features"] | undefined }) {
    if (input.features) {
      await tx.packageFeature.deleteMany({ where: { packageId } });
      await tx.packageFeature.createMany({ data: input.features.map((feature) => ({ packageId, featureKey: feature.featureKey, quantity: feature.quantity })) });
    }
    if (input.prices) {
      const keep = input.prices.map((price) => price.currency);
      // A price that's no longer listed is switched off and kept, so history stays explainable.
      await tx.packagePrice.updateMany({ where: { packageId, currency: { notIn: keep } }, data: { isActive: false } });
      for (const price of input.prices) {
        await tx.packagePrice.upsert({
          where: { packageId_currency: { packageId, currency: price.currency } },
          create: { packageId, currency: price.currency, amountMinor: price.amountMinor, isActive: price.isActive },
          update: { amountMinor: price.amountMinor, isActive: price.isActive },
        });
      }
    }
  }

  return {
    /** What students see: packages on sale, with only their active prices. */
    async listPublic() {
      const load = async () => {
        const rows = await prisma.package.findMany({
          where: { isActive: true, deletedAt: null, prices: { some: { isActive: true } } },
          orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
          include,
        });
        return rows.map((row) => view({ ...row, prices: row.prices.filter((price) => price.isActive) }));
      };
      return cache ? cache.getOrSet("public", `${PUBLIC_KEY}list`, 120, load) : load();
    },

    async getPublic(id: string) {
      const row = await prisma.package.findFirst({ where: { id, isActive: true, deletedAt: null }, include });
      if (!row) throw new AppError(404, "NOT_FOUND", "This package isn't available.");
      return view({ ...row, prices: row.prices.filter((price) => price.isActive) });
    },

    async listAdmin() {
      const rows = await prisma.package.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include });
      const sold = await prisma.userPurchase.groupBy({ by: ["packageId"], where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, packageId: { not: null } }, _count: { _all: true } });
      const counts = new Map(sold.map((row) => [row.packageId, row._count._all]));
      return rows.map((row) => ({ ...view(row), sold: counts.get(row.id) ?? 0 }));
    },

    async create(actor: Actor, input: PackageInput) {
      checkSellable(input);
      try {
        const created = await prisma.$transaction(async (tx) => {
          const row = await tx.package.create({
            data: { code: input.code, name: input.name, description: input.description ?? null, category: input.category, validityDays: input.validityDays, isActive: input.isActive, isFeatured: input.isFeatured, sortOrder: input.sortOrder },
          });
          await writeChildren(tx, row.id, input);
          await recordAudit(tx, actor, { action: "package.create", entityType: "package", entityId: row.id, after: input });
          return row;
        });
        await changed();
        return view(await find(created.id));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "CONFLICT", "A package with this code already exists.");
        throw error;
      }
    },

    async update(actor: Actor, id: string, input: PackageUpdate) {
      const before = await find(id);
      const prices = input.prices ?? before.prices;
      const features = input.features ?? before.features;
      checkSellable({ isActive: input.isActive ?? before.isActive, prices, features });
      await prisma.$transaction(async (tx) => {
        const { prices: newPrices, features: newFeatures, ...fields } = input;
        await tx.package.update({
          where: { id },
          data: {
            ...(fields.code !== undefined ? { code: fields.code } : {}),
            ...(fields.name !== undefined ? { name: fields.name } : {}),
            ...(fields.description !== undefined ? { description: fields.description } : {}),
            ...(fields.category !== undefined ? { category: fields.category } : {}),
            ...(fields.validityDays !== undefined ? { validityDays: fields.validityDays } : {}),
            ...(fields.isActive !== undefined ? { isActive: fields.isActive } : {}),
            ...(fields.isFeatured !== undefined ? { isFeatured: fields.isFeatured } : {}),
            ...(fields.sortOrder !== undefined ? { sortOrder: fields.sortOrder } : {}),
          },
        });
        await writeChildren(tx, id, { prices: newPrices, features: newFeatures });
        await recordAudit(tx, actor, { action: "package.update", entityType: "package", entityId: id, before: view(before), after: input });
      });
      await changed();
      return view(await find(id));
    },

    /** Packages with purchases are archived, never deleted, so purchase records keep making sense. */
    async archive(actor: Actor, id: string) {
      await find(id);
      await prisma.$transaction(async (tx) => {
        await tx.package.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
        await recordAudit(tx, actor, { action: "package.archive", entityType: "package", entityId: id });
      });
      await changed();
    },
  };
}

export type PackageService = ReturnType<typeof createPackageService>;
