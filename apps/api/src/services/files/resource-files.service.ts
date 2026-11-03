import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import { canManageCourse } from "../course-access.js";
import type { CourseService } from "../course.service.js";
import { detectDocumentType, MAX_DOCUMENT_BYTES, safeFileName } from "../storage/file-types.js";
import type { PrivateStorage } from "../storage/private-storage.js";

const LINK_SECONDS = 300;

/** Files attached to learning resources. Who may open one is decided by the same check as the resource itself. */
export function createResourceFileService({ prisma, storage, courses }: { prisma: PrismaClient; storage: PrivateStorage; courses: Pick<CourseService, "getResource"> }) {
  async function managed(actor: Actor, resourceId: string) {
    const row = await prisma.learningResource.findFirst({ where: { id: resourceId, deletedAt: null }, select: { id: true, storageKey: true, section: { select: { courseId: true, course: { select: { instructorId: true } } } } } });
    if (!row) throw new AppError(404, "NOT_FOUND", "Resource not found.");
    if (!canManageCourse(actor, row.section.course)) throw new AppError(403, "FORBIDDEN", "You can't change this resource.");
    return row;
  }

  return {
    async upload(actor: Actor, resourceId: string, data: Buffer, originalName: string) {
      const row = await managed(actor, resourceId);
      if (data.length === 0) throw new AppError(400, "VALIDATION_ERROR", "This file is empty.");
      if (data.length > MAX_DOCUMENT_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "This file is too large.");
      const type = detectDocumentType(data);
      if (!type) throw new AppError(400, "VALIDATION_ERROR", "Upload a PDF, PNG or JPEG file.");
      const storageKey = `documents/${row.section.courseId}/${row.id}-${Date.now()}.${type.extension}`;
      await storage.put(storageKey, data, { contentType: type.contentType });
      await prisma.learningResource.update({ where: { id: row.id }, data: { storageKey, fileName: safeFileName(originalName, type.extension), fileContentType: type.contentType, fileBytes: data.length } });
      // The new file is safely recorded before the old one goes.
      if (row.storageKey) await storage.delete(row.storageKey);
      return { fileName: safeFileName(originalName, type.extension), bytes: data.length, contentType: type.contentType };
    },

    async remove(actor: Actor, resourceId: string) {
      const row = await managed(actor, resourceId);
      if (row.storageKey) await storage.delete(row.storageKey);
      await prisma.learningResource.update({ where: { id: row.id }, data: { storageKey: null, fileName: null, fileContentType: null, fileBytes: null } });
    },

    /** Runs the resource's own access check first, and only then gives out a link or the file. */
    async open(actor: Actor, resourceId: string) {
      await courses.getResource(actor, resourceId);
      const row = await prisma.learningResource.findUnique({ where: { id: resourceId }, select: { storageKey: true, fileName: true, fileContentType: true } });
      if (!row?.storageKey) throw new AppError(404, "NOT_FOUND", "This resource has no file.");
      const fileName = row.fileName ?? "resource";
      const contentType = row.fileContentType ?? "application/octet-stream";
      const url = storage.signedDownloadUrl ? await storage.signedDownloadUrl(row.storageKey, { expiresSeconds: LINK_SECONDS, fileName, contentType }) : null;
      if (url) return { url };
      const data = await storage.get(row.storageKey);
      if (!data) throw new AppError(404, "NOT_FOUND", "This file isn't available.");
      return { data, contentType, fileName };
    },
  };
}

export type ResourceFileService = ReturnType<typeof createResourceFileService>;
