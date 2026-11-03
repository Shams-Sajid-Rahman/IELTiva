import { randomBytes } from "node:crypto";
import { Prisma, type DifficultyLevel, type ExamType, type PrismaClient, type PublicationStatus, type Skill } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { pageMeta } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";
import { writeHistory } from "./course.service.js";

type ModuleInput = {
  name?: string | undefined;
  description?: string | undefined;
  skill?: Skill | null | undefined;
  examType?: ExamType | null | undefined;
  difficulty?: DifficultyLevel | null | undefined;
  estimatedMinutes?: number | null | undefined;
  position?: number | undefined;
};

const canManage = (actor: Actor) => actor.permissions.includes("modules.manage");
const NOT_FOUND = () => new AppError(404, "NOT_FOUND", "Learning module not found.");

export function createModuleService(prisma: PrismaClient) {
  return {
    async list(actor: Actor, query: { page: number; pageSize: number; search?: string | undefined; status?: PublicationStatus | undefined }) {
      const where: Prisma.LearningModuleWhereInput = {
        ...(canManage(actor) ? (query.status ? { status: query.status } : {}) : { status: "PUBLISHED" as const }),
        ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.learningModule.findMany({
          where,
          orderBy: [{ position: "asc" }, { name: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { _count: { select: { courses: { where: { deletedAt: null } } } } },
        }),
        prisma.learningModule.count({ where }),
      ]);
      return {
        items: rows.map(({ _count, ...row }) => ({ ...row, courseCount: _count.courses })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async get(actor: Actor, id: string) {
      const row = await prisma.learningModule.findUnique({ where: { id }, include: { _count: { select: { courses: { where: { deletedAt: null } } } } } });
      if (!row || (!canManage(actor) && row.status !== "PUBLISHED")) throw NOT_FOUND();
      const { _count, ...rest } = row;
      return { ...rest, courseCount: _count.courses };
    },

    async create(actor: Actor, input: ModuleInput & { name: string }) {
      const code = `${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "MODULE"}_${randomBytes(2).toString("hex").toUpperCase()}`;
      const row = await prisma.learningModule.create({ data: { ...input, code, status: "DRAFT" } });
      await recordAudit(prisma, actor, { action: "module.create", entityType: "LearningModule", entityId: row.id, after: { name: row.name } });
      return row;
    },

    async update(actor: Actor, id: string, input: ModuleInput) {
      const before = await prisma.learningModule.findUnique({ where: { id } });
      if (!before) throw NOT_FOUND();
      return prisma.$transaction(async (tx) => {
        const row = await tx.learningModule.update({ where: { id }, data: input });
        if (before.status === "PUBLISHED") await writeHistory(tx, actor, { moduleId: id }, "CONTENT_UPDATED", "PUBLISHED", "PUBLISHED", "Module details updated");
        await recordAudit(tx, actor, { action: "module.update", entityType: "LearningModule", entityId: id, before: { name: before.name, position: before.position }, after: input });
        return row;
      });
    },

    async publish(actor: Actor, id: string) {
      const before = await prisma.learningModule.findUnique({ where: { id } });
      if (!before) throw NOT_FOUND();
      if (before.status === "PUBLISHED") throw new AppError(409, "CONFLICT", "This module is already published.");
      if (!before.description || before.description.length < 10) {
        throw new AppError(400, "VALIDATION_ERROR", "This module isn't ready to publish.", [{ path: "description", message: "Add a description of at least 10 characters." }]);
      }
      return prisma.$transaction(async (tx) => {
        const row = await tx.learningModule.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
        await writeHistory(tx, actor, { moduleId: id }, "PUBLISHED", before.status, "PUBLISHED");
        await recordAudit(tx, actor, { action: "module.publish", entityType: "LearningModule", entityId: id, before: { status: before.status }, after: { status: "PUBLISHED" } });
        return row;
      });
    },

    async archive(actor: Actor, id: string) {
      const before = await prisma.learningModule.findUnique({ where: { id } });
      if (!before) throw NOT_FOUND();
      if (before.status === "ARCHIVED") throw new AppError(409, "CONFLICT", "This module is already archived.");
      if (await prisma.course.count({ where: { moduleId: id, status: "PUBLISHED", deletedAt: null } })) {
        throw new AppError(409, "CONFLICT", "Published courses use this module. Archive or move them first.");
      }
      return prisma.$transaction(async (tx) => {
        const row = await tx.learningModule.update({ where: { id }, data: { status: "ARCHIVED" } });
        await writeHistory(tx, actor, { moduleId: id }, "ARCHIVED", before.status, "ARCHIVED");
        await recordAudit(tx, actor, { action: "module.archive", entityType: "LearningModule", entityId: id, before: { status: before.status }, after: { status: "ARCHIVED" } });
        return row;
      });
    },
  };
}

export type ModuleService = ReturnType<typeof createModuleService>;
