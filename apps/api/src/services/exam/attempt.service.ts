import type { AnswerResponse, ExamSettings, SectionSettings } from "@ieltiva/shared";
import { Prisma, type AttemptMode, type AttemptStatus, type PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import type { EntitlementService } from "../billing/entitlement.service.js";
import type { Cache } from "../cache.js";
import { hasPremiumAccess } from "../course-access.js";
import { contentTypeForKey } from "../storage/private-storage.js";
import type { PrivateStorage } from "../storage/private-storage.js";
import { audioContentType, countWords, detectAudioType, markQuestion } from "./marking.js";

/** Lets a save already on its way when time runs out still count. Uploads take longer, so they get more. */
const SAVE_GRACE_MS = 5_000;
const UPLOAD_GRACE_MS = 30_000;
const DEFAULT_RESUME_HOURS = 72;
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** Used if the platform setting is missing. Administrators change retention.speaking_recordings_days. */
const DEFAULT_RETENTION_DAYS = 90;

const FINAL: AttemptStatus[] = ["SUBMITTED", "EXPIRED", "ABANDONED"];
const isFinal = (status: AttemptStatus) => FINAL.includes(status);

const settingsOf = (value: unknown) => (value ?? {}) as ExamSettings;
const sectionSettingsOf = (value: unknown) => (value ?? {}) as SectionSettings;

/** Everything a student sees while answering. Answer keys, explanations and transcripts are left out here, by design. */
const questionForStudent = {
  id: true,
  number: true,
  prompt: true,
  marks: true,
  options: { orderBy: { position: "asc" }, select: { id: true, label: true, body: true } },
} satisfies Prisma.QuestionSelect;

const sectionForStudent = {
  id: true,
  position: true,
  skill: true,
  title: true,
  instructions: true,
  durationSeconds: true,
  settings: true,
  readingPassages: { orderBy: { position: "asc" }, select: { id: true, position: true, title: true, body: true } },
  listeningAudios: { orderBy: { position: "asc" }, select: { id: true, position: true, durationSeconds: true } },
  questionGroups: {
    orderBy: { position: "asc" },
    select: { id: true, position: true, type: true, instructions: true, stimulus: true, imageStorageKey: true, questions: { orderBy: { number: "asc" }, select: questionForStudent } },
  },
  writingTasks: { orderBy: { position: "asc" }, select: { id: true, position: true, taskType: true, prompt: true, imageStorageKey: true, minWords: true, suggestedMinutes: true } },
  speakingQuestions: { orderBy: [{ part: "asc" }, { position: "asc" }], select: { id: true, part: true, position: true, prompt: true, cueCard: true, prepSeconds: true, maxAnswerSeconds: true } },
} satisfies Prisma.ExamSectionSelect;

type Tx = Prisma.TransactionClient;

async function lockAttempt(tx: Tx, attemptId: string) {
  await tx.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
}

async function lockSection(tx: Tx, sectionAttemptId: string) {
  await tx.$queryRaw`SELECT id FROM section_attempts WHERE id = ${sectionAttemptId}::uuid FOR UPDATE`;
}

/** Finishes one section: marks it, seals its work, and records the raw score. Calling it again changes nothing. */
async function finalizeSection(tx: Tx, sectionAttemptId: string, status: "SUBMITTED" | "EXPIRED", now: Date) {
  await lockSection(tx, sectionAttemptId);
  const attempt = await tx.sectionAttempt.findUniqueOrThrow({ where: { id: sectionAttemptId }, include: { section: { select: { skill: true } } } });
  if (isFinal(attempt.status)) return false;

  let rawScore: number | null = null;
  let maxScore: number | null = null;
  const { skill } = attempt.section;

  if (skill === "LISTENING" || skill === "READING") {
    const questions = await tx.question.findMany({
      where: { group: { sectionId: attempt.sectionId } },
      include: { answers: true, options: { select: { id: true } }, group: { select: { type: true } } },
    });
    const responses = await tx.questionResponse.findMany({ where: { sectionAttemptId } });
    const byQuestion = new Map(responses.map((row) => [row.questionId, row]));
    rawScore = 0;
    maxScore = 0;
    for (const question of questions) {
      maxScore += question.marks;
      const saved = byQuestion.get(question.id);
      const result = markQuestion(
        { type: question.group.type, marks: question.marks, scoringMode: question.scoringMode, hasOptions: question.options.length > 0, answers: question.answers },
        saved?.response as AnswerResponse | null | undefined,
      );
      rawScore += result.marksAwarded;
      if (saved) await tx.questionResponse.update({ where: { id: saved.id }, data: result });
    }
  }

  if (skill === "WRITING") {
    const drafts = await tx.writingSubmission.findMany({ where: { sectionAttemptId, submittedAt: null } });
    for (const draft of drafts) {
      if (!draft.text.trim()) continue;
      await tx.writingSubmission.update({ where: { id: draft.id }, data: { submittedAt: now, wordCount: countWords(draft.text) } });
      // A hidden placeholder. Real AI results are separate rows, created only if the student asks for feedback.
      await tx.assessmentResult.create({ data: { writingSubmissionId: draft.id, bandVisibility: "HIDDEN" } });
    }
  }

  if (skill === "SPEAKING") {
    const setting = await tx.platformSetting.findUnique({ where: { key: "retention.speaking_recordings_days" } });
    const days = Number(setting?.value ?? DEFAULT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
    await tx.speakingSubmission.updateMany({
      where: { sectionAttemptId, submittedAt: null, audioStorageKey: { not: null } },
      data: { submittedAt: now, audioDeleteAfter: new Date(now.getTime() + days * DAY_MS) },
    });
  }

  const started = attempt.startedAt?.getTime();
  await tx.sectionAttempt.update({
    where: { id: sectionAttemptId },
    data: { status, submittedAt: now, rawScore, maxScore, timeSpentSeconds: started ? Math.max(0, Math.round((now.getTime() - started) / 1000)) : 0 },
  });
  return true;
}

/** Closes the attempt once every section is finished. An attempt that ran out of time reads as expired, even though its answers still count. */
async function closeAttemptIfDone(tx: Tx, attemptId: string, now: Date) {
  const attempt = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { sections: true } });
  if (isFinal(attempt.status) || attempt.sections.some((row) => !isFinal(row.status))) return;
  const scored = attempt.sections.filter((row) => row.maxScore !== null);
  const expired = attempt.sections.some((row) => row.status === "EXPIRED");
  await tx.examAttempt.update({
    where: { id: attemptId },
    data: {
      status: expired ? "EXPIRED" : "SUBMITTED",
      submittedAt: now,
      rawScore: scored.length ? scored.reduce((sum, row) => sum + (row.rawScore ?? 0), 0) : null,
      maxScore: scored.length ? scored.reduce((sum, row) => sum + (row.maxScore ?? 0), 0) : null,
    },
  });
}

/** Which kinds of package can open a premium exam. A mock test needs a mock package, so a Listening package can't unlock it. */
const premiumKeysFor = (isMock: boolean, skills: string[]) => [
  "practice_pass",
  ...(isMock ? ["mock_tests"] : []),
  ...(!isMock && skills.includes("LISTENING") ? ["listening_tests"] : []),
  ...(!isMock && skills.includes("READING") ? ["reading_tests"] : []),
];

type AttemptOptions = { credits?: EntitlementService | undefined; cache?: Cache | undefined; onRecordingSaved?: ((submissionId: string) => Promise<void>) | undefined };

export function createAttemptService(prisma: PrismaClient, storage: PrivateStorage, { credits, cache, onRecordingSaved }: AttemptOptions = {}) {
  /** Time limits live on the server. Anything past its limit is finished here, whenever the attempt is next touched. */
  async function settle(attemptId: string) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - SAVE_GRACE_MS);
    const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { sections: true } });
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    const windowOver = attempt.expiresAt !== null && attempt.expiresAt < now;
    const due = attempt.sections.filter((row) => (row.status === "IN_PROGRESS" && row.expiresAt !== null && row.expiresAt < cutoff) || (windowOver && !isFinal(row.status)));
    if (!due.length) return;
    await prisma.$transaction(async (tx) => {
      await lockAttempt(tx, attemptId);
      for (const row of due) await finalizeSection(tx, row.id, "EXPIRED", now);
      await closeAttemptIfDone(tx, attemptId, now);
    });
  }

  /** Returns 404 for someone else's attempt, so its existence isn't revealed. */
  async function own(actor: Actor, attemptId: string) {
    await settle(attemptId);
    const attempt = await prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: actor.userId },
      include: {
        sections: { include: { section: { select: { id: true, position: true, skill: true, title: true, durationSeconds: true } } } },
        examVersion: { select: { id: true, settings: true, exam: { select: { id: true, title: true, examType: true, isMock: true } } } },
      },
    });
    if (!attempt) throw new AppError(404, "NOT_FOUND", "This attempt wasn't found.");
    attempt.sections.sort((a, b) => a.section.position - b.section.position);
    return attempt;
  }

  async function ownSection(actor: Actor, attemptId: string, sectionId: string) {
    const attempt = await own(actor, attemptId);
    const sectionAttempt = attempt.sections.find((row) => row.sectionId === sectionId);
    if (!sectionAttempt) throw new AppError(404, "NOT_FOUND", "This section isn't part of the attempt.");
    return { attempt, sectionAttempt };
  }

  function refuseIfClosed(status: AttemptStatus) {
    if (status === "EXPIRED") throw new AppError(410, "ATTEMPT_EXPIRED", "Time ran out, so this can't be changed.");
    if (status === "SUBMITTED") throw new AppError(409, "ATTEMPT_ALREADY_SUBMITTED", "This has already been submitted.");
    if (status === "ABANDONED") throw new AppError(409, "CONFLICT", "This attempt was cancelled.");
    if (status === "NOT_STARTED") throw new AppError(409, "CONFLICT", "Start this section first.");
  }

  /** Checks inside a transaction, after taking the section lock, so a save can't slip in behind a submission. */
  async function assertOpen(tx: Tx, sectionAttemptId: string, graceMs: number) {
    await lockSection(tx, sectionAttemptId);
    const fresh = await tx.sectionAttempt.findUniqueOrThrow({ where: { id: sectionAttemptId } });
    refuseIfClosed(fresh.status);
    if (fresh.expiresAt && fresh.expiresAt.getTime() + graceMs < Date.now()) throw new AppError(410, "ATTEMPT_EXPIRED", "Time ran out, so this can't be changed.");
    return fresh;
  }

  const attemptView = (attempt: Awaited<ReturnType<typeof own>>) => ({
    id: attempt.id,
    mode: attempt.mode,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    serverTime: new Date(),
    exam: attempt.examVersion.exam,
    navigation: settingsOf(attempt.examVersion.settings).navigation ?? (attempt.examVersion.exam.isMock ? "SEQUENTIAL" : "FREE"),
    sections: attempt.sections.map((row) => ({
      id: row.sectionId,
      position: row.section.position,
      skill: row.section.skill,
      title: row.section.title,
      durationSeconds: row.section.durationSeconds,
      status: row.status,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      lastSavedAt: row.lastSavedAt,
    })),
  });

  return {
    async start(actor: Actor, examId: string, requested?: AttemptMode) {
      const exam = await prisma.exam.findFirst({
        where: { id: examId, deletedAt: null },
        include: { versions: { where: { status: "PUBLISHED" }, orderBy: { versionNumber: "desc" }, take: 1, include: { sections: { orderBy: { position: "asc" }, select: { id: true, skill: true } } } } },
      });
      const version = exam?.versions[0];
      if (!exam || !version) throw new AppError(404, "NOT_FOUND", "This exam isn't available.");
      if (exam.isPremium && !(await hasPremiumAccess(prisma, actor.userId))) {
        throw new AppError(403, "ENTITLEMENT_REQUIRED", "This exam needs a practice package. You can buy one on the Packages page.");
      }
      const mode: AttemptMode = exam.isMock ? "MOCK" : (requested ?? "TIMED");
      if (mode === "MOCK" && !exam.isMock) throw new AppError(400, "VALIDATION_ERROR", "This exam isn't a mock test.");

      const existing = await prisma.examAttempt.findFirst({ where: { userId: actor.userId, examVersionId: version.id, status: "IN_PROGRESS" } });
      if (existing) {
        await settle(existing.id);
        const still = await prisma.examAttempt.findUnique({ where: { id: existing.id } });
        if (still?.status === "IN_PROGRESS") return attemptView(await own(actor, existing.id));
      }

      const settings = settingsOf(version.settings);
      if (settings.maxAttempts) {
        const used = await prisma.examAttempt.count({ where: { userId: actor.userId, examVersion: { examId }, status: { not: "ABANDONED" } } });
        if (used >= settings.maxAttempts) throw new AppError(409, "CONFLICT", "You've used all the attempts allowed for this exam.");
      }

      const hours = settings.resumeWindowHours ?? DEFAULT_RESUME_HOURS;
      try {
        // For a premium exam, starting the attempt and using up one credit happen together or not at all.
        const created = await prisma.$transaction(async (tx) => {
          const attempt = await tx.examAttempt.create({
            data: {
              userId: actor.userId,
              examVersionId: version.id,
              mode,
              expiresAt: new Date(Date.now() + hours * 3_600_000),
              sections: { create: version.sections.map((section) => ({ sectionId: section.id, status: "NOT_STARTED" as const })) },
            },
          });
          if (exam.isPremium && credits) {
            await credits.consume(tx, actor.userId, premiumKeysFor(exam.isMock, version.sections.map((section) => section.skill)), { type: "exam_attempt", id: attempt.id }, "exam_attempt");
          }
          return attempt;
        });
        return attemptView(await own(actor, created.id));
      } catch (error) {
        // A second request lost the race for the one active attempt, so it joins the winner's.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const winner = await prisma.examAttempt.findFirstOrThrow({ where: { userId: actor.userId, examVersionId: version.id, status: "IN_PROGRESS" } });
          return attemptView(await own(actor, winner.id));
        }
        throw error;
      }
    },

    async list(actor: Actor, query: { page: number; pageSize: number; status?: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED" | "ABANDONED" | undefined }) {
      const open = await prisma.examAttempt.findMany({ where: { userId: actor.userId, status: "IN_PROGRESS" }, select: { id: true }, take: 20 });
      for (const row of open) await settle(row.id);
      const where = { userId: actor.userId, ...(query.status ? { status: query.status } : {}) };
      const [rows, total] = await prisma.$transaction([
        prisma.examAttempt.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            mode: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            rawScore: true,
            maxScore: true,
            examVersion: { select: { exam: { select: { id: true, title: true, examType: true, isMock: true } } } },
          },
        }),
        prisma.examAttempt.count({ where }),
      ]);
      return { items: rows.map(({ examVersion, ...row }) => ({ ...row, exam: examVersion.exam })), meta: pageMeta(query.page, query.pageSize, total) };
    },

    async get(actor: Actor, attemptId: string) {
      return attemptView(await own(actor, attemptId));
    },

    async cancel(actor: Actor, attemptId: string) {
      const attempt = await own(actor, attemptId);
      if (attempt.mode === "MOCK") throw new AppError(409, "CONFLICT", "A mock test can't be cancelled. Submit it instead.");
      refuseIfClosed(attempt.status);
      await prisma.$transaction(async (tx) => {
        await lockAttempt(tx, attemptId);
        const fresh = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
        refuseIfClosed(fresh.status);
        await tx.sectionAttempt.updateMany({ where: { examAttemptId: attemptId, status: { in: ["IN_PROGRESS", "NOT_STARTED"] } }, data: { status: "ABANDONED" } });
        await tx.examAttempt.update({ where: { id: attemptId }, data: { status: "ABANDONED" } });
      });
      return attemptView(await own(actor, attemptId));
    },

    /** Starts a section's timer. Starting it again returns the same deadline, so a reload can't add time. */
    async startSection(actor: Actor, attemptId: string, sectionId: string) {
      const { attempt, sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(attempt.status);
      if (sectionAttempt.status === "NOT_STARTED") {
        const navigation = settingsOf(attempt.examVersion.settings).navigation ?? (attempt.examVersion.exam.isMock ? "SEQUENTIAL" : "FREE");
        if (navigation === "SEQUENTIAL") {
          const next = attempt.sections.find((row) => !isFinal(row.status));
          if (next?.sectionId !== sectionId) throw new AppError(409, "CONFLICT", "Finish the current section first.");
        }
        await prisma.$transaction(async (tx) => {
          await lockSection(tx, sectionAttempt.id);
          const fresh = await tx.sectionAttempt.findUniqueOrThrow({ where: { id: sectionAttempt.id } });
          if (fresh.status !== "NOT_STARTED") return;
          const now = new Date();
          await tx.sectionAttempt.update({
            where: { id: sectionAttempt.id },
            data: {
              status: "IN_PROGRESS",
              startedAt: now,
              // Practice mode has no clock. Timed and mock attempts do.
              expiresAt: attempt.mode === "PRACTICE" ? null : new Date(now.getTime() + sectionAttempt.section.durationSeconds * 1000),
            },
          });
        });
      } else {
        refuseIfClosed(sectionAttempt.status);
      }
      return this.getSection(actor, attemptId, sectionId);
    },

    /** The content for answering, plus saved work for resuming. It never contains answer keys. */
    async getSection(actor: Actor, attemptId: string, sectionId: string) {
      const { attempt, sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const section = await prisma.examSection.findUniqueOrThrow({ where: { id: sectionId }, select: sectionForStudent });
      const [responses, writing, speaking] = await Promise.all([
        prisma.questionResponse.findMany({ where: { sectionAttemptId: sectionAttempt.id }, select: { questionId: true, response: true, isFlagged: true } }),
        prisma.writingSubmission.findMany({ where: { sectionAttemptId: sectionAttempt.id }, select: { writingTaskId: true, text: true, wordCount: true, lastSavedAt: true, timeSpentSeconds: true } }),
        prisma.speakingSubmission.findMany({ where: { sectionAttemptId: sectionAttempt.id }, select: { speakingQuestionId: true, durationSeconds: true, audioStorageKey: true } }),
      ]);
      const settings = sectionSettingsOf(section.settings);
      const plays = (sectionAttempt.audioPlays ?? {}) as Record<string, number>;
      // Mock tests play audio once by default. Authors can change this for each section.
      const maxAudioPlays = settings.maxAudioPlays !== undefined ? settings.maxAudioPlays : attempt.mode === "PRACTICE" ? null : 1;
      return {
        attempt: attemptView(attempt),
        section: {
          ...section,
          settings: undefined,
          questionGroups: section.questionGroups.map(({ imageStorageKey, ...group }) => ({ ...group, hasImage: Boolean(imageStorageKey) })),
          writingTasks: section.writingTasks.map(({ imageStorageKey, ...task }) => ({ ...task, hasImage: Boolean(imageStorageKey) })),
          listeningAudios: section.listeningAudios.map((audio) => ({ ...audio, playsUsed: plays[audio.id] ?? 0 })),
          maxAudioPlays,
          allowAudioSeek: settings.allowAudioSeek ?? attempt.mode === "PRACTICE",
        },
        status: sectionAttempt.status,
        startedAt: sectionAttempt.startedAt,
        expiresAt: sectionAttempt.expiresAt,
        lastSavedAt: sectionAttempt.lastSavedAt,
        serverTime: new Date(),
        responses,
        writing,
        speaking: speaking.map(({ audioStorageKey, ...row }) => ({ ...row, hasRecording: Boolean(audioStorageKey) })),
      };
    },

    async saveAnswers(actor: Actor, attemptId: string, sectionId: string, answers: { questionId: string; response?: AnswerResponse | null | undefined; isFlagged?: boolean | undefined }[]) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const ids = answers.map((row) => row.questionId);
      const known = await prisma.question.findMany({ where: { id: { in: ids }, group: { sectionId } }, select: { id: true } });
      if (known.length !== new Set(ids).size) throw new AppError(400, "VALIDATION_ERROR", "One of these questions isn't in this section.");
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await assertOpen(tx, sectionAttempt.id, SAVE_GRACE_MS);
        for (const row of answers) {
          const response = row.response === undefined ? undefined : row.response === null ? Prisma.DbNull : (row.response as Prisma.InputJsonValue);
          const data = {
            ...(response === undefined ? {} : { response, answeredAt: now }),
            ...(row.isFlagged === undefined ? {} : { isFlagged: row.isFlagged }),
          };
          await tx.questionResponse.upsert({
            where: { sectionAttemptId_questionId: { sectionAttemptId: sectionAttempt.id, questionId: row.questionId } },
            create: { sectionAttemptId: sectionAttempt.id, questionId: row.questionId, ...data },
            update: data,
          });
        }
        await tx.sectionAttempt.update({ where: { id: sectionAttempt.id }, data: { lastSavedAt: now } });
      });
      return { savedAt: now, serverTime: new Date() };
    },

    async submitSection(actor: Actor, attemptId: string, sectionId: string) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await lockAttempt(tx, attemptId);
        await finalizeSection(tx, sectionAttempt.id, "SUBMITTED", now);
        await closeAttemptIfDone(tx, attemptId, now);
      });
      return attemptView(await own(actor, attemptId));
    },

    /** Safe to repeat: a second submission, even at the same moment, returns the same result without marking twice. */
    async submit(actor: Actor, attemptId: string) {
      const attempt = await own(actor, attemptId);
      if (attempt.status === "ABANDONED") refuseIfClosed(attempt.status);
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await lockAttempt(tx, attemptId);
        const fresh = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { sections: true } });
        if (isFinal(fresh.status)) return;
        for (const row of fresh.sections) await finalizeSection(tx, row.id, "SUBMITTED", now);
        await closeAttemptIfDone(tx, attemptId, now);
      });
      return attemptView(await own(actor, attemptId));
    },

    /** Raw scores only. There's no verified conversion table, so no band is calculated. Keys appear only once the attempt is closed. */
    async result(actor: Actor, attemptId: string) {
      const attempt = await own(actor, attemptId);
      if (attempt.status === "IN_PROGRESS") throw new AppError(409, "CONFLICT", "Results appear after you submit.");
      if (attempt.status === "ABANDONED") throw new AppError(409, "CONFLICT", "This attempt was cancelled, so it has no results.");
      const reviewAllowed = (settingsOf(attempt.examVersion.settings).reviewPolicy ?? "AFTER_SUBMISSION") === "AFTER_SUBMISSION";
      const sections = await Promise.all(
        attempt.sections.map(async (row) => {
          const summary = { id: row.sectionId, title: row.section.title, skill: row.section.skill, status: row.status, rawScore: row.rawScore, maxScore: row.maxScore, timeSpentSeconds: row.timeSpentSeconds };
          if (row.section.skill === "WRITING") {
            const writing = await prisma.writingSubmission.findMany({ where: { sectionAttemptId: row.id }, select: { id: true, text: true, wordCount: true, submittedAt: true, writingTask: { select: { taskType: true, prompt: true, minWords: true } } } });
            return { ...summary, writing };
          }
          if (row.section.skill === "SPEAKING") {
            const speaking = await prisma.speakingSubmission.findMany({ where: { sectionAttemptId: row.id }, select: { id: true, durationSeconds: true, submittedAt: true, audioStorageKey: true, speakingQuestion: { select: { id: true, part: true, prompt: true } } } });
            return { ...summary, speaking: speaking.map(({ audioStorageKey, ...item }) => ({ ...item, hasRecording: Boolean(audioStorageKey) })) };
          }
          if (!reviewAllowed) return summary;
          const groups = await prisma.questionGroup.findMany({
            where: { sectionId: row.sectionId },
            orderBy: { position: "asc" },
            select: {
              id: true,
              type: true,
              instructions: true,
              questions: {
                orderBy: { number: "asc" },
                select: {
                  id: true,
                  number: true,
                  prompt: true,
                  marks: true,
                  explanation: true,
                  options: { orderBy: { position: "asc" }, select: { label: true, body: true } },
                  answers: { select: { acceptedValue: true } },
                  responses: { where: { sectionAttemptId: row.id }, select: { response: true, isCorrect: true, marksAwarded: true } },
                },
              },
            },
          });
          const transcripts = row.section.skill === "LISTENING" ? await prisma.listeningAudio.findMany({ where: { sectionId: row.sectionId }, orderBy: { position: "asc" }, select: { transcript: true } }) : [];
          return {
            ...summary,
            transcripts: transcripts.map((item) => item.transcript).filter(Boolean),
            review: groups.flatMap((group) =>
              group.questions.map(({ responses, answers, ...question }) => ({
                ...question,
                type: group.type,
                acceptedAnswers: answers.map((answer) => answer.acceptedValue),
                response: responses[0]?.response ?? null,
                isCorrect: responses[0]?.isCorrect ?? false,
                marksAwarded: responses[0]?.marksAwarded ?? 0,
              })),
            ),
          };
        }),
      );
      return {
        attempt: attemptView(attempt),
        rawScore: attempt.rawScore,
        maxScore: attempt.maxScore,
        reviewAllowed,
        sections,
      };
    },

    /** Counts a play before any audio is sent, so the limit holds across reloads and repeat requests. */
    async playAudio(actor: Actor, attemptId: string, sectionId: string, audioId: string) {
      const { sectionAttempt, attempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const section = await prisma.examSection.findUniqueOrThrow({ where: { id: sectionId }, select: { settings: true, listeningAudios: { where: { id: audioId }, select: { id: true } } } });
      if (!section.listeningAudios.length) throw new AppError(404, "NOT_FOUND", "This recording wasn't found.");
      const settings = sectionSettingsOf(section.settings);
      const limit = settings.maxAudioPlays !== undefined ? settings.maxAudioPlays : attempt.mode === "PRACTICE" ? null : 1;
      return prisma.$transaction(async (tx) => {
        const fresh = await assertOpen(tx, sectionAttempt.id, 0);
        const plays = { ...((fresh.audioPlays ?? {}) as Record<string, number>) };
        const used = plays[audioId] ?? 0;
        if (limit !== null && used >= limit) throw new AppError(409, "CONFLICT", "You've used all the plays allowed for this recording.");
        plays[audioId] = used + 1;
        await tx.sectionAttempt.update({ where: { id: sectionAttempt.id }, data: { audioPlays: plays } });
        return { playsUsed: used + 1, maxAudioPlays: limit };
      });
    },

    /** Streams through the API after an access check, so no storage address ever reaches the browser. */
    async readAudio(actor: Actor, attemptId: string, sectionId: string, audioId: string) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const plays = (sectionAttempt.audioPlays ?? {}) as Record<string, number>;
      if (!plays[audioId]) throw new AppError(403, "FORBIDDEN", "Start playback first.");
      const audio = await prisma.listeningAudio.findFirst({ where: { id: audioId, sectionId } });
      const data = audio && (await storage.get(audio.storageKey));
      if (!audio || !data) throw new AppError(404, "NOT_FOUND", "This recording isn't available.");
      return { data, contentType: audioContentType(audio.storageKey) };
    },

    async readImage(actor: Actor, attemptId: string, sectionId: string, kind: "group" | "task", itemId: string) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      if (sectionAttempt.status === "NOT_STARTED") refuseIfClosed(sectionAttempt.status);
      const item = kind === "group"
        ? await prisma.questionGroup.findFirst({ where: { id: itemId, sectionId }, select: { imageStorageKey: true } })
        : await prisma.writingTask.findFirst({ where: { id: itemId, sectionId }, select: { imageStorageKey: true } });
      const data = item?.imageStorageKey ? await storage.get(item.imageStorageKey) : null;
      if (!item?.imageStorageKey || !data) throw new AppError(404, "NOT_FOUND", "This image isn't available.");
      return { data, contentType: contentTypeForKey(item.imageStorageKey) };
    },

    async saveWriting(actor: Actor, attemptId: string, sectionId: string, taskId: string, body: { text: string; timeSpentSeconds?: number | undefined }) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const task = await prisma.writingTask.findFirst({ where: { id: taskId, sectionId }, select: { id: true } });
      if (!task) throw new AppError(404, "NOT_FOUND", "This task isn't part of the section.");
      const now = new Date();
      const wordCount = countWords(body.text);
      await prisma.$transaction(async (tx) => {
        await assertOpen(tx, sectionAttempt.id, SAVE_GRACE_MS);
        const data = { text: body.text, wordCount, lastSavedAt: now, ...(body.timeSpentSeconds === undefined ? {} : { timeSpentSeconds: body.timeSpentSeconds }) };
        await tx.writingSubmission.upsert({
          where: { sectionAttemptId_writingTaskId: { sectionAttemptId: sectionAttempt.id, writingTaskId: taskId } },
          create: { sectionAttemptId: sectionAttempt.id, writingTaskId: taskId, ...data },
          update: data,
        });
        await tx.sectionAttempt.update({ where: { id: sectionAttempt.id }, data: { lastSavedAt: now } });
      });
      return { savedAt: now, wordCount, serverTime: new Date() };
    },

    async listWriting(actor: Actor, query: { page: number; pageSize: number; status?: "draft" | "submitted" | undefined }) {
      const where: Prisma.WritingSubmissionWhereInput = {
        sectionAttempt: { examAttempt: { userId: actor.userId, status: { not: "ABANDONED" } } },
        ...(query.status === "draft" ? { submittedAt: null } : query.status === "submitted" ? { submittedAt: { not: null } } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.writingSubmission.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            text: true,
            wordCount: true,
            lastSavedAt: true,
            submittedAt: true,
            writingTask: { select: { taskType: true, prompt: true, minWords: true } },
            sectionAttempt: { select: { sectionId: true, examAttemptId: true, examAttempt: { select: { examVersion: { select: { exam: { select: { title: true } } } } } } } },
          },
        }),
        prisma.writingSubmission.count({ where }),
      ]);
      return {
        items: rows.map(({ sectionAttempt, ...row }) => ({ ...row, attemptId: sectionAttempt.examAttemptId, sectionId: sectionAttempt.sectionId, examTitle: sectionAttempt.examAttempt.examVersion.exam.title, assessment: "NOT_AVAILABLE" as const })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async discardWritingDraft(actor: Actor, submissionId: string) {
      const draft = await prisma.writingSubmission.findFirst({ where: { id: submissionId, sectionAttempt: { examAttempt: { userId: actor.userId } } } });
      if (!draft) throw new AppError(404, "NOT_FOUND", "This draft wasn't found.");
      if (draft.submittedAt) throw new AppError(409, "ATTEMPT_ALREADY_SUBMITTED", "Submitted work can't be removed here.");
      await prisma.writingSubmission.delete({ where: { id: draft.id } });
    },

    /** Replaces any earlier recording for this question until the section is submitted. */
    async saveRecording(actor: Actor, attemptId: string, sectionId: string, questionId: string, data: Buffer, durationSeconds: number) {
      if (data.length === 0) throw new AppError(400, "VALIDATION_ERROR", "This recording is empty.");
      if (data.length > MAX_RECORDING_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "This recording is too large.");
      const type = detectAudioType(data);
      if (!type) throw new AppError(400, "VALIDATION_ERROR", "This file isn't a supported audio recording.");
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const question = await prisma.speakingQuestion.findFirst({ where: { id: questionId, sectionId }, select: { id: true } });
      if (!question) throw new AppError(404, "NOT_FOUND", "This question isn't part of the section.");

      const key = `recordings/${actor.userId}/${attemptId}/${questionId}-${Date.now()}.${type.extension}`;
      await storage.put(key, data);
      let previous: string | null = null;
      let savedId = "";
      try {
        await prisma.$transaction(async (tx) => {
          await assertOpen(tx, sectionAttempt.id, UPLOAD_GRACE_MS);
          const where = { sectionAttemptId_speakingQuestionId: { sectionAttemptId: sectionAttempt.id, speakingQuestionId: questionId } };
          previous = (await tx.speakingSubmission.findUnique({ where }))?.audioStorageKey ?? null;
          const saved = await tx.speakingSubmission.upsert({
            where,
            create: { sectionAttemptId: sectionAttempt.id, speakingQuestionId: questionId, audioStorageKey: key, durationSeconds },
            update: { audioStorageKey: key, durationSeconds, status: "PENDING" },
          });
          savedId = saved.id;
          await tx.sectionAttempt.update({ where: { id: sectionAttempt.id }, data: { lastSavedAt: new Date() } });
        });
      } catch (error) {
        // The upload wasn't accepted, so its file mustn't stay behind.
        await storage.delete(key);
        throw error;
      }
      if (previous) await storage.delete(previous);
      // A deeper check runs in the background. A problem queuing it mustn't lose the student's recording.
      if (onRecordingSaved) await onRecordingSaved(savedId).catch(() => undefined);
      return { durationSeconds, hasRecording: true };
    },

    async readRecording(actor: Actor, attemptId: string, sectionId: string, questionId: string) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      const row = await prisma.speakingSubmission.findUnique({ where: { sectionAttemptId_speakingQuestionId: { sectionAttemptId: sectionAttempt.id, speakingQuestionId: questionId } } });
      const data = row?.audioStorageKey ? await storage.get(row.audioStorageKey) : null;
      if (!row?.audioStorageKey || !data) throw new AppError(404, "NOT_FOUND", "This recording isn't available.");
      return { data, contentType: audioContentType(row.audioStorageKey) };
    },

    async deleteRecording(actor: Actor, attemptId: string, sectionId: string, questionId: string) {
      const { sectionAttempt } = await ownSection(actor, attemptId, sectionId);
      refuseIfClosed(sectionAttempt.status);
      const key = await prisma.$transaction(async (tx) => {
        await assertOpen(tx, sectionAttempt.id, UPLOAD_GRACE_MS);
        const where = { sectionAttemptId_speakingQuestionId: { sectionAttemptId: sectionAttempt.id, speakingQuestionId: questionId } };
        const row = await tx.speakingSubmission.findUnique({ where });
        if (row) await tx.speakingSubmission.delete({ where });
        return row?.audioStorageKey ?? null;
      });
      if (key) await storage.delete(key);
    },

    async listSpeaking(actor: Actor, query: { page: number; pageSize: number; status?: "draft" | "submitted" | undefined }) {
      const where: Prisma.SpeakingSubmissionWhereInput = {
        sectionAttempt: { examAttempt: { userId: actor.userId, status: { not: "ABANDONED" } } },
        ...(query.status === "draft" ? { submittedAt: null } : query.status === "submitted" ? { submittedAt: { not: null } } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.speakingSubmission.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            durationSeconds: true,
            status: true,
            submittedAt: true,
            createdAt: true,
            speakingQuestionId: true,
            speakingQuestion: { select: { part: true, prompt: true } },
            sectionAttempt: { select: { sectionId: true, examAttemptId: true, examAttempt: { select: { examVersion: { select: { exam: { select: { title: true } } } } } } } },
          },
        }),
        prisma.speakingSubmission.count({ where }),
      ]);
      return {
        items: rows.map(({ sectionAttempt, ...row }) => ({ ...row, attemptId: sectionAttempt.examAttemptId, sectionId: sectionAttempt.sectionId, examTitle: sectionAttempt.examAttempt.examVersion.exam.title, assessment: "NOT_AVAILABLE" as const })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async listExams(actor: Actor, query: { page: number; pageSize: number; search?: string | undefined; examType?: "ACADEMIC" | "GENERAL_TRAINING" | undefined; skill?: "LISTENING" | "READING" | "WRITING" | "SPEAKING" | undefined; isMock?: "true" | "false" | undefined }) {
      const where: Prisma.ExamWhereInput = {
        deletedAt: null,
        versions: { some: { status: "PUBLISHED", ...(query.skill ? { sections: { some: { skill: query.skill } } } : {}) } },
        ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
        ...(query.examType ? { OR: [{ examType: query.examType }, { examType: null }] } : {}),
        ...(query.isMock ? { isMock: query.isMock === "true" } : {}),
      };
      // The list of published exams is the same for everyone, so it can be shared. Each student's open attempts are read separately and never cached.
      const load = () =>
        prisma.$transaction([
          prisma.exam.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select: {
              id: true,
              title: true,
              examType: true,
              isMock: true,
              isPremium: true,
              versions: {
                where: { status: "PUBLISHED" },
                orderBy: { versionNumber: "desc" },
                take: 1,
                select: {
                  id: true,
                  sections: { orderBy: { position: "asc" }, select: { skill: true, durationSeconds: true, questionGroups: { select: { _count: { select: { questions: true } } } } } },
                },
              },
            },
          }),
          prisma.exam.count({ where }),
        ]);
      const [rows, total] = cache ? await cache.getOrSet("public", `exams:${JSON.stringify(query)}`, 60, load) : await load();
      const versionIds = rows.flatMap((row) => row.versions.map((version) => version.id));
      const openAttempts = await prisma.examAttempt.findMany({ where: { userId: actor.userId, status: "IN_PROGRESS", examVersionId: { in: versionIds } }, select: { id: true, examVersionId: true } });
      const openByVersion = new Map(openAttempts.map((row) => [row.examVersionId, row.id]));
      return {
        items: rows.map(({ versions, ...exam }) => {
          const version = versions[0];
          const sections = version?.sections ?? [];
          return {
            ...exam,
            skills: [...new Set(sections.map((section) => section.skill))],
            durationSeconds: sections.reduce((sum, section) => sum + section.durationSeconds, 0),
            questionCount: sections.reduce((sum, section) => sum + section.questionGroups.reduce((count, group) => count + group._count.questions, 0), 0),
            activeAttemptId: version ? (openByVersion.get(version.id) ?? null) : null,
          };
        }),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    /** A summary only, with no questions, so nothing can be read before starting. */
    async getExam(actor: Actor, examId: string) {
      const exam = await prisma.exam.findFirst({
        where: { id: examId, deletedAt: null },
        select: {
          id: true,
          title: true,
          examType: true,
          isMock: true,
          isPremium: true,
          versions: {
            where: { status: "PUBLISHED" },
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: {
              id: true,
              settings: true,
              provenance: true,
              sections: { orderBy: { position: "asc" }, select: { id: true, position: true, skill: true, title: true, instructions: true, durationSeconds: true, questionGroups: { select: { _count: { select: { questions: true } } } } } },
              attempts: { where: { userId: actor.userId, status: "IN_PROGRESS" }, select: { id: true }, take: 1 },
            },
          },
        },
      });
      const version = exam?.versions[0];
      if (!exam || !version) throw new AppError(404, "NOT_FOUND", "This exam isn't available.");
      return {
        id: exam.id,
        title: exam.title,
        examType: exam.examType,
        isMock: exam.isMock,
        isPremium: exam.isPremium,
        activeAttemptId: version.attempts[0]?.id ?? null,
        navigation: settingsOf(version.settings).navigation ?? (exam.isMock ? "SEQUENTIAL" : "FREE"),
        sections: version.sections.map(({ questionGroups, ...section }) => ({ ...section, questionCount: questionGroups.reduce((count, group) => count + group._count.questions, 0) })),
      };
    },
  };
}

export type AttemptService = ReturnType<typeof createAttemptService>;
