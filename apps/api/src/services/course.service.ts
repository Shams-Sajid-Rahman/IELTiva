import type { Cache } from "./cache.js";
import { randomBytes } from "node:crypto";
import { Prisma, type DifficultyLevel, type ExamType, type PublicationAction, type PublicationStatus, type ResourceType, type Skill } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { resourceBodySchema } from "@ieltiva/shared";
import type { Actor, Db } from "../types/platform.js";
import { pageMeta } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";
import { canAuthorCourses, canManageAllCourses, canManageCourse, courseProgress, hasPremiumAccess } from "./course-access.js";
import type { NotificationService } from "./notification.service.js";

const courseSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  examType: true,
  status: true,
  provenance: true,
  isPremium: true,
  thumbnailUrl: true,
  difficulty: true,
  learningObjectives: true,
  estimatedMinutes: true,
  instructorId: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  module: { select: { id: true, name: true, code: true, skill: true } },
  instructor: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
  _count: { select: { enrollments: { where: { status: { not: "CANCELED" as const } } } } },
} satisfies Prisma.CourseSelect;

type CourseRow = Prisma.CourseGetPayload<{ select: typeof courseSelect }>;

function present(course: CourseRow) {
  const { instructor, _count, ...rest } = course;
  return {
    ...rest,
    enrollmentCount: _count.enrollments,
    instructor: instructor ? { id: instructor.id, name: `${instructor.profile?.firstName ?? ""} ${instructor.profile?.lastName ?? ""}`.trim() } : null,
  };
}

// Never includes storage keys, which stay on the server.
const resourceSummary = {
  id: true,
  position: true,
  type: true,
  title: true,
  durationMinutes: true,
  fileName: true,
  fileBytes: true,
} satisfies Prisma.LearningResourceSelect;

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "course"
  );
}

type CourseInput = {
  title?: string | undefined;
  slug?: string | undefined;
  description?: string | undefined;
  moduleId?: string | undefined;
  examType?: ExamType | null | undefined;
  difficulty?: DifficultyLevel | null | undefined;
  thumbnailUrl?: string | null | undefined;
  learningObjectives?: string[] | undefined;
  estimatedMinutes?: number | null | undefined;
  isPremium?: boolean | undefined;
  instructorId?: string | null | undefined;
};

type ListQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: PublicationStatus | undefined;
  moduleId?: string | undefined;
  skill?: Skill | undefined;
  examType?: ExamType | undefined;
  difficulty?: DifficultyLevel | undefined;
  sort: string;
  scope: "catalog" | "manage";
};

const NOT_FOUND = () => new AppError(404, "NOT_FOUND", "Course not found.");
const FORBIDDEN = () => new AppError(403, "FORBIDDEN", "You can't change this course.");

function writeHistory(db: Db, actor: Actor, target: { courseId: string } | { moduleId: string }, action: PublicationAction, fromStatus: PublicationStatus | null, toStatus: PublicationStatus, note?: string) {
  return db.contentPublicationHistory.create({ data: { ...target, actorId: actor.userId, action, fromStatus, toStatus, note: note ?? null } });
}

export { writeHistory };

export function createCourseService(prisma: PrismaClient, notifications: NotificationService, cache?: Cache) {
  async function loadForManage(actor: Actor, id: string) {
    const course = await prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw NOT_FOUND();
    if (!canManageCourse(actor, course)) throw FORBIDDEN();
    return course;
  }

  async function loadSection(actor: Actor, id: string) {
    const section = await prisma.courseSection.findFirst({ where: { id, archivedAt: null, course: { deletedAt: null } }, include: { course: true } });
    if (!section) throw new AppError(404, "NOT_FOUND", "Section not found.");
    if (!canManageCourse(actor, section.course)) throw FORBIDDEN();
    return section;
  }

  async function loadResource(actor: Actor, id: string) {
    const resource = await prisma.learningResource.findFirst({
      where: { id, deletedAt: null, section: { course: { deletedAt: null } } },
      include: { section: { include: { course: true } } },
    });
    if (!resource) throw new AppError(404, "NOT_FOUND", "Resource not found.");
    if (!canManageCourse(actor, resource.section.course)) throw FORBIDDEN();
    return resource;
  }

  /** Students can see that published content changed, because each change leaves a history entry. */
  async function noteContentChange(db: Db, actor: Actor, course: { id: string; status: PublicationStatus }, note: string) {
    if (course.status === "PUBLISHED") await writeHistory(db, actor, { courseId: course.id }, "CONTENT_UPDATED", course.status, course.status, note);
  }

  async function uniqueSlug(title: string) {
    const base = slugify(title);
    if (!(await prisma.course.count({ where: { slug: base } }))) return base;
    return `${base}-${randomBytes(3).toString("hex")}`;
  }

  async function publicationProblems(courseId: string) {
    const course = await prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        module: true,
        sections: { where: { archivedAt: null, isVisible: true }, include: { resources: { where: { deletedAt: null }, select: { id: true } } } },
      },
    });
    const problems: { path: string; message: string }[] = [];
    if (!course.description || course.description.length < 20) problems.push({ path: "description", message: "Add a description of at least 20 characters." });
    if (course.learningObjectives.length === 0) problems.push({ path: "learningObjectives", message: "Add at least one learning objective." });
    if (course.module.status !== "PUBLISHED") problems.push({ path: "moduleId", message: "Its learning module must be published." });
    if (!course.sections.some((section) => section.resources.length > 0)) problems.push({ path: "sections", message: "Add a visible section with at least one resource." });
    return problems;
  }

  return {
    async list(actor: Actor, query: ListQuery) {
      if (query.scope === "manage" && !canAuthorCourses(actor)) throw new AppError(403, "FORBIDDEN", "You don't have access to this resource.");
      const where: Prisma.CourseWhereInput = {
        deletedAt: null,
        ...(query.scope === "catalog" ? { status: "PUBLISHED" as const } : query.status ? { status: query.status } : {}),
        ...(query.scope === "manage" && !canManageAllCourses(actor) ? { instructorId: actor.userId } : {}),
        ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
        ...(query.moduleId ? { moduleId: query.moduleId } : {}),
        ...(query.skill ? { module: { skill: query.skill } } : {}),
        ...(query.examType ? { OR: [{ examType: query.examType }, { examType: null }] } : {}),
        ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      };
      const descending = query.sort.startsWith("-");
      const field = query.sort.replace("-", "") as "title" | "createdAt" | "publishedAt";
      const load = () =>
        prisma.$transaction([
          prisma.course.findMany({
            where,
            select: courseSelect,
            orderBy: { [field]: descending ? "desc" : "asc" },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          prisma.course.count({ where }),
        ]);
      // Only the public catalog is shared. Staff views, and each student's enrollments below, are always read fresh.
      const [rows, total] = cache && query.scope === "catalog" ? await cache.getOrSet("public", `courses:${JSON.stringify(query)}`, 60, load) : await load();
      const enrollments = await prisma.userEnrollment.findMany({
        where: { userId: actor.userId, courseId: { in: rows.map((row) => row.id) } },
        select: { id: true, courseId: true, status: true },
      });
      const byCourse = new Map(enrollments.map((row) => [row.courseId, row]));
      return {
        items: rows.map((row) => ({ ...present(row), enrollment: byCourse.get(row.id) ?? null })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    /** Students see published courses, and archived ones they're enrolled in. */
    async get(actor: Actor, id: string) {
      const course = await prisma.course.findFirst({ where: { id, deletedAt: null }, select: courseSelect });
      if (!course) throw NOT_FOUND();
      const manager = canManageCourse(actor, course);
      const enrollment = await prisma.userEnrollment.findUnique({ where: { userId_courseId: { userId: actor.userId, courseId: id } } });
      const enrolled = Boolean(enrollment && enrollment.status !== "CANCELED");
      if (!manager && course.status !== "PUBLISHED" && !(course.status === "ARCHIVED" && enrolled)) throw NOT_FOUND();

      const sections = await prisma.courseSection.findMany({
        where: { courseId: id, archivedAt: null, ...(manager ? {} : { isVisible: true }) },
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          title: true,
          description: true,
          isVisible: true,
          resources: { where: { deletedAt: null }, orderBy: { position: "asc" }, select: { ...resourceSummary, ...(manager ? { body: true, externalUrl: true } : {}) } },
        },
      });
      const statuses = await prisma.learningProgress.findMany({
        where: { userId: actor.userId, resource: { section: { courseId: id } } },
        select: { resourceId: true, status: true },
      });
      const statusByResource = new Map(statuses.map((row) => [row.resourceId, row.status]));
      const progress = (await courseProgress(prisma, actor.userId, [id])).get(id)!;
      return {
        ...present(course),
        canManage: manager,
        locked: course.isPremium && !enrolled && !manager && !(await hasPremiumAccess(prisma, actor.userId)),
        enrollment: enrollment ? { id: enrollment.id, status: enrollment.status, createdAt: enrollment.createdAt, lastResourceId: enrollment.lastResourceId } : null,
        progress,
        sections: sections.map((section) => ({
          ...section,
          resources: section.resources.map((resource) => ({ ...resource, progress: statusByResource.get(resource.id) ?? "NOT_STARTED" })),
        })),
      };
    },

    async create(actor: Actor, input: CourseInput & { title: string; moduleId: string }) {
      if (!canAuthorCourses(actor)) throw new AppError(403, "FORBIDDEN", "You can't create courses.");
      if (!(await prisma.learningModule.count({ where: { id: input.moduleId } }))) throw new AppError(400, "VALIDATION_ERROR", "That learning module doesn't exist.");
      const { instructorId, slug, ...data } = input;
      const owner = canManageAllCourses(actor) ? (instructorId ?? actor.userId) : actor.userId;
      try {
        const course = await prisma.course.create({
          data: { ...data, slug: slug ?? (await uniqueSlug(input.title)), instructorId: owner, status: "DRAFT" },
          select: courseSelect,
        });
        await recordAudit(prisma, actor, { action: "course.create", entityType: "Course", entityId: course.id, after: { title: course.title, slug: course.slug } });
        return present(course);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "CONFLICT", "That slug is already in use.");
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new AppError(400, "VALIDATION_ERROR", "That instructor doesn't exist.");
        throw error;
      }
    },

    async update(actor: Actor, id: string, input: CourseInput) {
      const before = await loadForManage(actor, id);
      if (input.instructorId !== undefined && !canManageAllCourses(actor)) throw new AppError(403, "FORBIDDEN", "Only course administrators can reassign a course.");
      if (input.moduleId && !(await prisma.learningModule.count({ where: { id: input.moduleId } }))) throw new AppError(400, "VALIDATION_ERROR", "That learning module doesn't exist.");
      try {
        return await prisma.$transaction(async (tx) => {
          const course = await tx.course.update({ where: { id }, data: input, select: courseSelect });
          await noteContentChange(tx, actor, before, "Course details updated");
          await recordAudit(tx, actor, {
            action: "course.update",
            entityType: "Course",
            entityId: id,
            before: { title: before.title, slug: before.slug, moduleId: before.moduleId, isPremium: before.isPremium, instructorId: before.instructorId },
            after: input,
          });
          return present(course);
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "CONFLICT", "That slug is already in use.");
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new AppError(400, "VALIDATION_ERROR", "That instructor doesn't exist.");
        throw error;
      }
    },

    /** Removes only courses no student has ever used. Others must be archived, which keeps their history. */
    async remove(actor: Actor, id: string) {
      const course = await loadForManage(actor, id);
      if (course.status === "PUBLISHED") throw new AppError(409, "CONFLICT", "Archive a published course instead of deleting it.");
      if (await prisma.userEnrollment.count({ where: { courseId: id } })) throw new AppError(409, "CONFLICT", "Students have enrolled in this course, so it can only be archived.");
      await prisma.$transaction(async (tx) => {
        await tx.course.update({ where: { id }, data: { deletedAt: new Date() } });
        await recordAudit(tx, actor, { action: "course.delete", entityType: "Course", entityId: id, before: { title: course.title } });
      });
    },

    async publish(actor: Actor, id: string) {
      if (!actor.permissions.includes("courses.publish")) throw new AppError(403, "FORBIDDEN", "You can't publish courses.");
      const course = await loadForManage(actor, id);
      if (course.status === "PUBLISHED") throw new AppError(409, "CONFLICT", "This course is already published.");
      const problems = await publicationProblems(id);
      if (problems.length) throw new AppError(400, "VALIDATION_ERROR", "This course isn't ready to publish.", problems);
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.course.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() }, select: courseSelect });
        await writeHistory(tx, actor, { courseId: id }, "PUBLISHED", course.status, "PUBLISHED");
        await recordAudit(tx, actor, { action: "course.publish", entityType: "Course", entityId: id, before: { status: course.status }, after: { status: "PUBLISHED" } });
        return row;
      });
      await notifications.notifyCoursePublished({ id, title: course.title });
      return present(updated);
    },

    async unpublish(actor: Actor, id: string) {
      if (!actor.permissions.includes("courses.publish")) throw new AppError(403, "FORBIDDEN", "You can't unpublish courses.");
      const course = await loadForManage(actor, id);
      if (course.status !== "PUBLISHED") throw new AppError(409, "CONFLICT", "Only published courses can be unpublished.");
      if (await prisma.userEnrollment.count({ where: { courseId: id, status: "ACTIVE" } })) {
        throw new AppError(409, "CONFLICT", "Students are taking this course. Archive it, so they keep access.");
      }
      return prisma.$transaction(async (tx) => {
        const row = await tx.course.update({ where: { id }, data: { status: "DRAFT" }, select: courseSelect });
        await writeHistory(tx, actor, { courseId: id }, "RESTORED_TO_DRAFT", "PUBLISHED", "DRAFT");
        await recordAudit(tx, actor, { action: "course.unpublish", entityType: "Course", entityId: id, before: { status: "PUBLISHED" }, after: { status: "DRAFT" } });
        return present(row);
      });
    },

    async archive(actor: Actor, id: string) {
      if (!actor.permissions.includes("courses.publish")) throw new AppError(403, "FORBIDDEN", "You can't archive courses.");
      const course = await loadForManage(actor, id);
      if (course.status === "ARCHIVED") throw new AppError(409, "CONFLICT", "This course is already archived.");
      return prisma.$transaction(async (tx) => {
        const row = await tx.course.update({ where: { id }, data: { status: "ARCHIVED" }, select: courseSelect });
        await writeHistory(tx, actor, { courseId: id }, "ARCHIVED", course.status, "ARCHIVED");
        await recordAudit(tx, actor, { action: "course.archive", entityType: "Course", entityId: id, before: { status: course.status }, after: { status: "ARCHIVED" } });
        return present(row);
      });
    },

    async history(actor: Actor, id: string) {
      await loadForManage(actor, id);
      const rows = await prisma.contentPublicationHistory.findMany({
        where: { courseId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { profile: { select: { firstName: true, lastName: true } } } } },
      });
      return rows.map(({ actor: person, ...row }) => ({ ...row, actorName: person?.profile ? `${person.profile.firstName} ${person.profile.lastName}` : null }));
    },

    // Sections

    async listSections(actor: Actor, courseId: string) {
      const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
      if (!course) throw NOT_FOUND();
      const manager = canManageCourse(actor, course);
      if (!manager && course.status !== "PUBLISHED") throw NOT_FOUND();
      return prisma.courseSection.findMany({
        where: { courseId, archivedAt: null, ...(manager ? {} : { isVisible: true }) },
        orderBy: { position: "asc" },
        select: { id: true, position: true, title: true, description: true, isVisible: true, resources: { where: { deletedAt: null }, orderBy: { position: "asc" }, select: resourceSummary } },
      });
    },

    async createSection(actor: Actor, courseId: string, input: { title: string; description?: string | undefined; isVisible?: boolean | undefined }) {
      const course = await loadForManage(actor, courseId);
      const last = await prisma.courseSection.aggregate({ where: { courseId }, _max: { position: true } });
      return prisma.$transaction(async (tx) => {
        const section = await tx.courseSection.create({ data: { ...input, courseId, position: (last._max.position ?? 0) + 1 } });
        await noteContentChange(tx, actor, course, `Section added: ${input.title}`);
        await recordAudit(tx, actor, { action: "section.create", entityType: "CourseSection", entityId: section.id, after: { courseId, title: input.title } });
        return section;
      });
    },

    async updateSection(actor: Actor, id: string, input: { title?: string | undefined; description?: string | undefined; isVisible?: boolean | undefined; position?: number | undefined }) {
      const section = await loadSection(actor, id);
      const { position, ...data } = input;
      return prisma.$transaction(async (tx) => {
        if (position !== undefined && position !== section.position) {
          const siblings = await tx.courseSection.findMany({ where: { courseId: section.courseId, archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, position: true } });
          const slots = siblings.map((row) => row.position);
          const ordered = siblings.filter((row) => row.id !== id);
          ordered.splice(Math.min(position - 1, ordered.length), 0, { id, position: section.position });
          // Two passes, because the unique index on position applies at each statement.
          for (const [index, row] of ordered.entries()) await tx.courseSection.update({ where: { id: row.id }, data: { position: -(index + 1) } });
          for (const [index, row] of ordered.entries()) await tx.courseSection.update({ where: { id: row.id }, data: { position: slots[index]! } });
        }
        const updated = await tx.courseSection.update({ where: { id }, data });
        await noteContentChange(tx, actor, section.course, `Section updated: ${updated.title}`);
        await recordAudit(tx, actor, { action: "section.update", entityType: "CourseSection", entityId: id, before: { title: section.title, isVisible: section.isVisible, position: section.position }, after: input });
        return updated;
      });
    },

    /** Archives, so student progress on its resources remains. */
    async archiveSection(actor: Actor, id: string) {
      const section = await loadSection(actor, id);
      await prisma.$transaction(async (tx) => {
        await tx.courseSection.update({ where: { id }, data: { archivedAt: new Date() } });
        await noteContentChange(tx, actor, section.course, `Section archived: ${section.title}`);
        await recordAudit(tx, actor, { action: "section.archive", entityType: "CourseSection", entityId: id, before: { title: section.title } });
      });
    },

    // Resources

    async createResource(actor: Actor, sectionId: string, input: { type: ResourceType; title: string; body?: string | null | undefined; externalUrl?: string | null | undefined; durationMinutes?: number | null | undefined }) {
      const section = await loadSection(actor, sectionId);
      const last = await prisma.learningResource.aggregate({ where: { sectionId }, _max: { position: true } });
      return prisma.$transaction(async (tx) => {
        const resource = await tx.learningResource.create({
          data: { ...input, sectionId, position: (last._max.position ?? 0) + 1 },
          select: { ...resourceSummary, body: true, externalUrl: true },
        });
        await noteContentChange(tx, actor, section.course, `Resource added: ${input.title}`);
        await recordAudit(tx, actor, { action: "resource.create", entityType: "LearningResource", entityId: resource.id, after: { sectionId, type: input.type, title: input.title } });
        return resource;
      });
    },

    async updateResource(actor: Actor, id: string, input: { type?: ResourceType | undefined; title?: string | undefined; body?: string | null | undefined; externalUrl?: string | null | undefined; durationMinutes?: number | null | undefined; position?: number | undefined }) {
      const resource = await loadResource(actor, id);
      const { position, ...data } = input;
      const merged = resourceBodySchema.safeParse({
        type: data.type ?? resource.type,
        title: data.title ?? resource.title,
        body: data.body !== undefined ? data.body : resource.body,
        externalUrl: data.externalUrl !== undefined ? data.externalUrl : resource.externalUrl,
        durationMinutes: data.durationMinutes !== undefined ? data.durationMinutes : resource.durationMinutes,
      });
      if (!merged.success) throw merged.error;
      return prisma.$transaction(async (tx) => {
        if (position !== undefined && position !== resource.position) {
          const siblings = await tx.learningResource.findMany({ where: { sectionId: resource.sectionId, deletedAt: null }, orderBy: { position: "asc" }, select: { id: true, position: true } });
          const slots = siblings.map((row) => row.position);
          const ordered = siblings.filter((row) => row.id !== id);
          ordered.splice(Math.min(position - 1, ordered.length), 0, { id, position: resource.position });
          for (const [index, row] of ordered.entries()) await tx.learningResource.update({ where: { id: row.id }, data: { position: -(index + 1) } });
          for (const [index, row] of ordered.entries()) await tx.learningResource.update({ where: { id: row.id }, data: { position: slots[index]! } });
        }
        const updated = await tx.learningResource.update({ where: { id }, data, select: { ...resourceSummary, body: true, externalUrl: true } });
        await noteContentChange(tx, actor, resource.section.course, `Resource updated: ${updated.title}`);
        await recordAudit(tx, actor, { action: "resource.update", entityType: "LearningResource", entityId: id, before: { title: resource.title, type: resource.type }, after: { title: updated.title, type: updated.type } });
        return updated;
      });
    },

    async removeResource(actor: Actor, id: string) {
      const resource = await loadResource(actor, id);
      await prisma.$transaction(async (tx) => {
        await tx.learningResource.update({ where: { id }, data: { deletedAt: new Date() } });
        await noteContentChange(tx, actor, resource.section.course, `Resource removed: ${resource.title}`);
        await recordAudit(tx, actor, { action: "resource.delete", entityType: "LearningResource", entityId: id, before: { title: resource.title } });
      });
    },

    /** Content is available to enrolled students and course managers only. */
    async getResource(actor: Actor, id: string) {
      const resource = await prisma.learningResource.findFirst({
        where: { id, deletedAt: null, section: { archivedAt: null, course: { deletedAt: null } } },
        select: {
          ...resourceSummary,
          body: true,
          externalUrl: true,
          section: { select: { id: true, title: true, isVisible: true, courseId: true, course: { select: { id: true, title: true, instructorId: true, status: true } } } },
        },
      });
      if (!resource) throw new AppError(404, "NOT_FOUND", "Resource not found.");
      const { course } = resource.section;
      const manager = canManageCourse(actor, course);
      const enrollment = await prisma.userEnrollment.findUnique({ where: { userId_courseId: { userId: actor.userId, courseId: course.id } } });
      const enrolled = Boolean(enrollment && enrollment.status !== "CANCELED");
      if (!manager && (!enrolled || !resource.section.isVisible || course.status === "DRAFT")) {
        throw new AppError(403, "FORBIDDEN", "Enroll in this course to open this resource.");
      }
      const ordered = await prisma.learningResource.findMany({
        where: { deletedAt: null, section: { courseId: course.id, archivedAt: null, ...(manager ? {} : { isVisible: true }) } },
        orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
        select: { id: true },
      });
      const index = ordered.findIndex((row) => row.id === id);
      const progress = await prisma.learningProgress.findUnique({ where: { userId_resourceId: { userId: actor.userId, resourceId: id } }, select: { status: true, completedAt: true } });
      const { section, ...rest } = resource;
      return {
        ...rest,
        enrolled,
        section: { id: section.id, title: section.title },
        course: { id: course.id, title: course.title },
        previousId: ordered[index - 1]?.id ?? null,
        nextId: ordered[index + 1]?.id ?? null,
        progress: progress?.status ?? "NOT_STARTED",
        completedAt: progress?.completedAt ?? null,
      };
    },
  };
}

export type CourseService = ReturnType<typeof createCourseService>;
