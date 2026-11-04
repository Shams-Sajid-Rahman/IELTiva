import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import type { PrivateStorage } from "../storage/private-storage.js";

type Kind = "writing" | "speaking";
type Notify = (userId: string, message: { type: "ASSESSMENT"; title: string; body: string; link?: string; dedupeKey?: string }) => Promise<void>;

const DAILY_REQUEST_LIMIT = 3;
const SPEAKING_CRITERIA = ["FLUENCY_COHERENCE", "LEXICAL_RESOURCE", "GRAMMATICAL_RANGE_ACCURACY", "PRONUNCIATION"];
const writingCriteria = (taskType: string) => [taskType === "TASK_2" ? "TASK_RESPONSE" : "TASK_ACHIEVEMENT", "COHERENCE_COHESION", "LEXICAL_RESOURCE", "GRAMMATICAL_RANGE_ACCURACY"];

const include = {
  writingSubmission: { select: { id: true, text: true, wordCount: true, sectionAttemptId: true, writingTask: { select: { taskType: true, prompt: true, minWords: true } }, sectionAttempt: { select: { examAttempt: { select: { userId: true } } } } } },
  speakingSubmission: { select: { id: true, transcript: true, durationSeconds: true, audioStorageKey: true, speakingQuestion: { select: { part: true, prompt: true } }, sectionAttempt: { select: { examAttempt: { select: { userId: true } } } } } },
} satisfies Prisma.InstructorReviewInclude;
type Row = Prisma.InstructorReviewGetPayload<{ include: typeof include }>;

const ownerOf = (row: Row) => row.writingSubmission?.sectionAttempt.examAttempt.userId ?? row.speakingSubmission?.sectionAttempt.examAttempt.userId ?? null;

/**
 * A student asks for an instructor's assessment of one piece of work. It's stored apart from AI results, so a human
 * score can be compared with the AI's and never overwrites it. Instructors see the work without the student's name.
 * A pronunciation score needs the recording, because it can't be judged from a transcript.
 */
export function createInstructorReviewService({ prisma, storage, notify }: { prisma: PrismaClient; storage: PrivateStorage; notify: Notify }) {
  const where = (kind: Kind, id: string) => (kind === "writing" ? { writingSubmissionId: id } : { speakingSubmissionId: id });

  async function ownSubmission(actor: Actor, kind: Kind, id: string) {
    const owned = { id, sectionAttempt: { examAttempt: { userId: actor.userId } } };
    const row = kind === "writing" ? await prisma.writingSubmission.findFirst({ where: owned, select: { id: true, submittedAt: true } }) : await prisma.speakingSubmission.findFirst({ where: owned, select: { id: true, submittedAt: true } });
    if (!row) throw new AppError(404, "NOT_FOUND", "This work wasn't found.");
    return row;
  }

  async function reviewFor(actor: Actor, id: string) {
    const row = await prisma.instructorReview.findUnique({ where: { id }, include });
    if (!row) throw new AppError(404, "NOT_FOUND", "This review wasn't found.");
    // Nobody marks their own work, even if they hold the permission.
    if (ownerOf(row) === actor.userId) throw new AppError(403, "FORBIDDEN", "You can't review your own work.");
    return row;
  }

  return {
    /** The student's view of their own request. */
    async mine(actor: Actor, kind: Kind, id: string) {
      await ownSubmission(actor, kind, id);
      const row = await prisma.instructorReview.findFirst({ where: where(kind, id), select: { status: true, overallBand: true, criterionBands: true, note: true, requestedAt: true, completedAt: true } });
      if (!row || row.status === "CANCELED") return null;
      const done = row.status === "COMPLETED";
      return { status: row.status, requestedAt: row.requestedAt, completedAt: row.completedAt, overallBand: done && row.overallBand !== null ? Number(row.overallBand) : null, criterionBands: done ? ((row.criterionBands ?? {}) as Record<string, number>) : {}, note: done ? row.note : null };
    },

    async request(actor: Actor, kind: Kind, id: string) {
      const submission = await ownSubmission(actor, kind, id);
      if (!submission.submittedAt) throw new AppError(409, "CONFLICT", "Submit your work first.");
      const existing = await prisma.instructorReview.findFirst({ where: where(kind, id) });
      if (existing && existing.status !== "CANCELED") throw new AppError(409, "CONFLICT", "You've already asked for a review of this work.");
      const today = await prisma.instructorReview.count({ where: { requestedById: actor.userId, requestedAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if (today >= DAILY_REQUEST_LIMIT) throw new AppError(429, "RATE_LIMITED", "You've reached today's limit for review requests. Please try again tomorrow.");
      if (existing) await prisma.instructorReview.update({ where: { id: existing.id }, data: { status: "REQUESTED", requestedAt: new Date(), requestedById: actor.userId } });
      else await prisma.instructorReview.create({ data: { ...where(kind, id), requestedById: actor.userId } });
      return { status: "REQUESTED" };
    },

    async cancel(actor: Actor, kind: Kind, id: string) {
      await ownSubmission(actor, kind, id);
      const changed = await prisma.instructorReview.updateMany({ where: { ...where(kind, id), status: "REQUESTED" }, data: { status: "CANCELED" } });
      if (changed.count !== 1) throw new AppError(409, "CONFLICT", "There's no open request to cancel.");
    },

    /** The list instructors work from. It leaves out who wrote each piece. */
    async queue(query: { page: number; pageSize: number; status: "REQUESTED" | "COMPLETED" }) {
      const filter = { status: query.status };
      const [rows, total] = await prisma.$transaction([
        prisma.instructorReview.findMany({ where: filter, orderBy: { requestedAt: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include }),
        prisma.instructorReview.count({ where: filter }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          skill: row.writingSubmission ? "WRITING" : "SPEAKING",
          task: row.writingSubmission?.writingTask.taskType ?? row.speakingSubmission?.speakingQuestion.part ?? null,
          requestedAt: row.requestedAt,
          completedAt: row.completedAt,
          status: row.status,
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async get(actor: Actor, id: string) {
      const row = await reviewFor(actor, id);
      const speaking = row.speakingSubmission;
      return {
        id: row.id,
        status: row.status,
        skill: row.writingSubmission ? "WRITING" : "SPEAKING",
        prompt: row.writingSubmission?.writingTask.prompt ?? speaking?.speakingQuestion.prompt ?? "",
        task: row.writingSubmission?.writingTask.taskType ?? speaking?.speakingQuestion.part ?? null,
        text: row.writingSubmission?.text ?? null,
        wordCount: row.writingSubmission?.wordCount ?? null,
        minWords: row.writingSubmission?.writingTask.minWords ?? null,
        transcript: speaking?.transcript ?? null,
        hasRecording: Boolean(speaking?.audioStorageKey),
        criteria: row.writingSubmission ? writingCriteria(row.writingSubmission.writingTask.taskType) : SPEAKING_CRITERIA,
        overallBand: row.overallBand === null ? null : Number(row.overallBand),
        criterionBands: (row.criterionBands ?? {}) as Record<string, number>,
        note: row.note,
      };
    },

    async audio(actor: Actor, id: string) {
      const row = await reviewFor(actor, id);
      const key = row.speakingSubmission?.audioStorageKey;
      const data = key ? await storage.get(key) : null;
      if (!key || !data) throw new AppError(404, "NOT_FOUND", "This recording isn't available.");
      const extension = key.split(".").pop() ?? "";
      const types: Record<string, string> = { webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav" };
      await recordAudit(prisma, actor, { action: "review.recording_opened", entityType: "instructor_review", entityId: id });
      return { data, contentType: types[extension] ?? "application/octet-stream" };
    },

    async complete(actor: Actor, id: string, input: { overallBand: number | null; criterionBands: Record<string, number>; note?: string | null | undefined }) {
      const row = await reviewFor(actor, id);
      if (row.status === "CANCELED") throw new AppError(409, "CONFLICT", "The student cancelled this request.");
      const criteria = row.writingSubmission ? writingCriteria(row.writingSubmission.writingTask.taskType) : SPEAKING_CRITERIA;
      const unknown = Object.keys(input.criterionBands).filter((key) => !criteria.includes(key));
      if (unknown.length) throw new AppError(400, "VALIDATION_ERROR", `These criteria don't apply here: ${unknown.join(", ")}.`);
      if (Object.keys(input.criterionBands).length === 0 && !input.note) throw new AppError(400, "VALIDATION_ERROR", "Give at least one criterion score or a note.");
      if (input.criterionBands.PRONUNCIATION !== undefined && !row.speakingSubmission?.audioStorageKey) throw new AppError(409, "CONFLICT", "Pronunciation can't be scored without the recording, and it's no longer available.");
      if (input.overallBand !== null && !criteria.every((key) => input.criterionBands[key] !== undefined)) throw new AppError(400, "VALIDATION_ERROR", "An overall band needs a score for every criterion.");
      const saved = await prisma.instructorReview.update({
        where: { id },
        data: { status: "COMPLETED", reviewerId: actor.userId, overallBand: input.overallBand, criterionBands: input.criterionBands, note: input.note ?? null, completedAt: new Date() },
      });
      await recordAudit(prisma, actor, { action: "review.complete", entityType: "instructor_review", entityId: id });
      const owner = ownerOf(row);
      if (owner) await notify(owner, { type: "ASSESSMENT", title: "Your instructor review is ready", body: "An instructor has reviewed your work.", link: "/practice/history", dedupeKey: `review-done:${id}:${saved.updatedAt.getTime()}` }).catch(() => undefined);
      return { id, status: saved.status };
    },
  };
}

export type InstructorReviewService = ReturnType<typeof createInstructorReviewService>;
