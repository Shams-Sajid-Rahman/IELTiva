import { z } from "zod";
import { Prisma, type AssessmentCriterion, type PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import type { PrivateStorage } from "../storage/private-storage.js";
import { AiError } from "./provider.js";
import type { AiService, TaskKey } from "./ai.service.js";
import { escapeForPrompt } from "./prompts.js";
import type { AiQueue } from "./queue.js";
import { fluencyMetrics, type SpeechProvider, type Transcription } from "./speech.provider.js";

/** Change this whenever the consent wording or the provider changes. Everyone is then asked again. */
export const CONSENT_VERSION = "2026-11-2";
export const MIN_WORDS_TO_ASSESS = 20;
const DAILY_ASSESSMENT_LIMIT = 10;

const evidence = z.object({ quote: z.string(), comment: z.string() });
const criterion = (names: readonly [string, ...string[]]) =>
  z.object({ criterion: z.enum(names), feedback: z.string(), evidence: z.array(evidence), estimatedBand: z.number() });
const common = {
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  corrections: z.array(z.object({ original: z.string(), corrected: z.string(), explanation: z.string() })),
  vocabulary: z.array(z.object({ used: z.string(), suggestion: z.string(), reason: z.string() })),
  improvements: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  injectionDetected: z.boolean(),
};
export const writingOutput = z.object({ criteria: z.array(criterion(["TASK_ACHIEVEMENT", "TASK_RESPONSE", "COHERENCE_COHESION", "LEXICAL_RESOURCE", "GRAMMATICAL_RANGE_ACCURACY"])), ...common });
export const speakingOutput = z.object({ criteria: z.array(criterion(["FLUENCY_COHERENCE", "LEXICAL_RESOURCE", "GRAMMATICAL_RANGE_ACCURACY"])), ...common });
type Output = z.infer<typeof writingOutput>;

const isHalfBand = (value: number) => value >= 0 && value <= 9 && value * 2 === Math.round(value * 2);
/** The nearest half band. This is our own working estimate for internal comparison, because the exact Writing method isn't published. */
export const nearestHalf = (value: number) => Math.round(value * 2) / 2;

/** Keeps only quotations that really appear in the submission, so invented evidence never reaches a student. */
export function keepRealEvidence(items: { quote: string; comment: string }[], source: string) {
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const haystack = flat(source);
  return items.filter((item) => item.quote.trim() && haystack.includes(flat(item.quote)));
}

export type FailureInfo = { code: string; message: string };

/** Paid feedback. When credits are switched on, each new request uses one, and a request that fails gives it back. */
export type AssessmentCredits = {
  enforced: () => Promise<boolean>;
  consume: (userId: string, featureKey: string, ref: { type: string; id: string }) => Promise<unknown>;
  release: (userId: string, ref: { type: string; id: string }) => Promise<void>;
};

export function createAssessmentService({ prisma, ai, queue, speech, storage, credits }: { prisma: PrismaClient; ai: AiService; queue: AiQueue | null; speech: SpeechProvider | null; storage: PrivateStorage; credits?: AssessmentCredits }) {
  async function requireConsent(userId: string, types: ("AI_PROCESSING" | "SPEECH_PROCESSING")[]) {
    const rows = await prisma.userConsent.findMany({ where: { userId, type: { in: types }, revokedAt: null, version: CONSENT_VERSION } });
    if (rows.length !== types.length) throw new AppError(403, "FORBIDDEN", "Please give your consent first.", [{ path: "consent", message: types.join(",") }]);
  }

  async function checkDailyLimit(userId: string) {
    const since = new Date(Date.now() - 86_400_000);
    const used = await prisma.aIAssessmentJob.count({ where: { userId, queuedAt: { gte: since } } });
    if (used >= DAILY_ASSESSMENT_LIMIT) throw new AppError(429, "RATE_LIMITED", "You've reached today's limit for AI feedback. Please try again tomorrow.");
  }

  /** One job for each subject and prompt version: repeating the request returns it instead of paying twice. */
  async function createJob(userId: string, taskKey: "writing.assess" | "speaking.assess", subjectType: string, subjectId: string) {
    if (!ai.isConfigured()) throw new AppError(503, "SERVICE_UNAVAILABLE", "AI feedback isn't available yet.");
    if (!queue) throw new AppError(503, "SERVICE_UNAVAILABLE", "AI feedback isn't available yet.");
    const prompt = await ai.resolvePrompt(taskKey);
    const idempotencyKey = `${taskKey}:${subjectId}:v${prompt.version}`;
    const existing = await prisma.aIAssessmentJob.findUnique({ where: { idempotencyKey } });
    if (existing && existing.status !== "FAILED") return existing;
    if (!existing) await checkDailyLimit(userId);
    // Each request has its own reference, so asking again for the same item never charges twice, and a retry after a failure is charged afresh.
    const creditRef = existing ? `${idempotencyKey}:${existing.queuedAt.getTime()}` : `${idempotencyKey}:first`;
    const charged = credits ? await credits.enforced() : false;
    if (charged) await credits!.consume(userId, taskKey === "writing.assess" ? "writing_assessments" : "speaking_assessments", { type: "ai_job", id: creditRef });
    const job = existing
      ? await prisma.aIAssessmentJob.update({ where: { id: existing.id }, data: { status: "PENDING", errorCode: null, errorMessage: null, queuedAt: new Date(), attempts: 0, creditRef: charged ? creditRef : null } })
      : await prisma.aIAssessmentJob.upsert({
          where: { idempotencyKey },
          create: { userId, taskKey, subjectType, subjectId, idempotencyKey, promptVersionId: prompt.id, creditRef: charged ? creditRef : null },
          update: {},
        });
    try {
      // A retry needs a new queue ID, because the queue keeps finished jobs for a while.
      await queue.add(taskKey, { jobId: job.id }, existing ? `${job.id}-${Date.now()}` : job.id);
    } catch {
      await prisma.aIAssessmentJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "The AI queue couldn't be reached." } });
      if (charged) await credits!.release(userId, { type: "ai_job", id: creditRef });
      throw new AppError(503, "SERVICE_UNAVAILABLE", "AI feedback isn't available right now. Please try again later.");
    }
    return job;
  }

  /** Replaces the job's result in one transaction, so a retry can't leave partial or duplicate feedback. */
  async function saveResult(args: {
    jobId: string;
    subject: { writingSubmissionId: string } | { speakingSubmissionId: string };
    output: Output;
    source: string;
    configuration: { id: string; provider: string };
    prompt: { id: string };
    modelId: string;
    overallBand: number | null;
    extraFeedback?: { type: "PRONUNCIATION"; body: string; evidence: Prisma.InputJsonValue }[];
  }) {
    const { output, source } = args;
    const criteria = output.criteria.map((row) => ({ ...row, evidence: keepRealEvidence(row.evidence, source) }));
    const corrections = output.corrections.filter((row) => source.toLowerCase().includes(row.original.toLowerCase().trim()));
    const summary = { confidence: output.confidence, injectionDetected: output.injectionDetected };
    await prisma.$transaction(async (tx) => {
      await tx.assessmentResult.updateMany({ where: args.subject, data: { isCurrent: false } });
      const result = await tx.assessmentResult.create({
        data: {
          ...args.subject,
          aiJobId: args.jobId,
          modelConfigurationId: args.configuration.id,
          promptVersionId: args.prompt.id,
          providerSnapshot: args.configuration.provider,
          modelSnapshot: args.modelId,
          overallBand: args.overallBand,
          // Stored for calibration only. The API applies the release gate on every read.
          bandVisibility: "HIDDEN",
          isCurrent: true,
          criterionScores: {
            create: criteria.filter((row) => isHalfBand(row.estimatedBand)).map((row) => ({ criterion: row.criterion as AssessmentCriterion, band: row.estimatedBand, rationale: row.feedback })),
          },
        },
      });
      const rows: { resultId: string; type: "SUMMARY" | "STRENGTH" | "IMPROVEMENT" | "CORRECTION" | "PRONUNCIATION"; position: number; body: string; evidence?: Prisma.InputJsonValue }[] = [
        { resultId: result.id, type: "SUMMARY", position: 1, body: output.summary, evidence: summary },
        ...output.strengths.map((body, index) => ({ resultId: result.id, type: "STRENGTH" as const, position: index + 1, body })),
        ...output.weaknesses.map((body, index) => ({ resultId: result.id, type: "IMPROVEMENT" as const, position: index + 1, body, evidence: { kind: "weakness" } })),
        ...output.improvements.map((body, index) => ({ resultId: result.id, type: "IMPROVEMENT" as const, position: output.weaknesses.length + index + 1, body, evidence: { kind: "next_step" } })),
        ...corrections.map((row, index) => ({ resultId: result.id, type: "CORRECTION" as const, position: index + 1, body: row.explanation, evidence: { kind: "grammar", original: row.original, corrected: row.corrected } })),
        ...output.vocabulary.map((row, index) => ({ resultId: result.id, type: "CORRECTION" as const, position: corrections.length + index + 1, body: row.reason, evidence: { kind: "vocabulary", original: row.used, corrected: row.suggestion } })),
        ...criteria.map((row, index) => ({ resultId: result.id, type: "SUMMARY" as const, position: index + 2, body: row.feedback, evidence: { kind: "criterion", criterion: row.criterion, quotes: row.evidence } })),
        ...(args.extraFeedback ?? []).map((row, index) => ({ resultId: result.id, ...row, position: index + 1 })),
      ];
      await tx.assessmentFeedback.createMany({ data: rows.map((row) => ({ ...row, ...(row.evidence === undefined ? {} : { evidence: row.evidence }) })) });
      await tx.aIAssessmentJob.update({ where: { id: args.jobId }, data: { status: "COMPLETED", finishedAt: new Date(), modelConfigurationId: args.configuration.id, promptVersionId: args.prompt.id, errorCode: null, errorMessage: null } });
    });
  }

  /** Is this result's band released for this exact model, prompt and task? */
  async function bandVisibleTo(actor: Actor | null, result: { overallBand: unknown; modelConfigurationId: string | null; promptVersionId: string | null }, scope: { examType: "ACADEMIC" | "GENERAL_TRAINING" | null; taskType: "ACADEMIC_TASK_1" | "GENERAL_TASK_1" | "TASK_2" }) {
    if (result.overallBand === null || !result.modelConfigurationId || !result.promptVersionId || !scope.examType) return "HIDDEN" as const;
    const release = await prisma.bandRelease.findFirst({ where: { modelConfigurationId: result.modelConfigurationId, promptVersionId: result.promptVersionId, examType: scope.examType, taskType: scope.taskType } });
    if (!release) return "HIDDEN" as const;
    if (release.visibility === "PUBLIC") return "PUBLIC" as const;
    if (release.visibility === "INTERNAL" && actor?.permissions.includes("ai.band_release")) return "INTERNAL" as const;
    return "HIDDEN" as const;
  }

  type ResultRow = Prisma.AssessmentResultGetPayload<{ include: { feedback: true; criterionScores: true } }>;

  /** The one place results leave the API. Bands are left out unless the gate is open, and Speaking bands are never included. */
  function present(result: ResultRow, visibility: "HIDDEN" | "INTERNAL" | "PUBLIC") {
    const sorted = [...result.feedback].sort((a, b) => a.position - b.position);
    const evidenceOf = (row: { evidence: unknown }) => (row.evidence ?? {}) as { kind?: string; criterion?: string; quotes?: { quote: string; comment: string }[]; original?: string; corrected?: string; confidence?: string };
    const summary = sorted.find((row) => row.type === "SUMMARY" && !evidenceOf(row).kind);
    const showBands = visibility !== "HIDDEN";
    return {
      id: result.id,
      createdAt: result.createdAt,
      bandVisibility: visibility,
      overallBand: showBands && result.overallBand !== null ? Number(result.overallBand) : null,
      summary: summary?.body ?? "",
      confidence: summary ? (evidenceOf(summary).confidence ?? null) : null,
      criteria: sorted
        .filter((row) => evidenceOf(row).kind === "criterion")
        .map((row) => {
          const score = result.criterionScores.find((item) => item.criterion === evidenceOf(row).criterion);
          return { criterion: evidenceOf(row).criterion, feedback: row.body, evidence: evidenceOf(row).quotes ?? [], band: showBands && score ? Number(score.band) : null };
        }),
      strengths: sorted.filter((row) => row.type === "STRENGTH").map((row) => row.body),
      weaknesses: sorted.filter((row) => row.type === "IMPROVEMENT" && evidenceOf(row).kind === "weakness").map((row) => row.body),
      improvements: sorted.filter((row) => row.type === "IMPROVEMENT" && evidenceOf(row).kind === "next_step").map((row) => row.body),
      corrections: sorted.filter((row) => row.type === "CORRECTION" && evidenceOf(row).kind === "grammar").map((row) => ({ original: evidenceOf(row).original, corrected: evidenceOf(row).corrected, explanation: row.body })),
      vocabulary: sorted.filter((row) => row.type === "CORRECTION" && evidenceOf(row).kind === "vocabulary").map((row) => ({ used: evidenceOf(row).original, suggestion: evidenceOf(row).corrected, reason: row.body })),
      pronunciation: sorted.filter((row) => row.type === "PRONUNCIATION").map((row) => ({ note: row.body, measures: row.evidence })),
    };
  }

  const jobView = (job: { id: string; status: string; errorCode: string | null; errorMessage: string | null; queuedAt: Date; finishedAt: Date | null } | null) =>
    job ? { id: job.id, status: job.status, errorCode: job.errorCode, errorMessage: job.errorMessage, queuedAt: job.queuedAt, finishedAt: job.finishedAt } : null;

  return {
    async requestWriting(actor: Actor, submissionId: string) {
      await requireConsent(actor.userId, ["AI_PROCESSING"]);
      const submission = await prisma.writingSubmission.findFirst({ where: { id: submissionId, sectionAttempt: { examAttempt: { userId: actor.userId } } } });
      if (!submission) throw new AppError(404, "NOT_FOUND", "This submission wasn't found.");
      if (!submission.submittedAt) throw new AppError(409, "CONFLICT", "Submit your writing first.");
      if (submission.wordCount < MIN_WORDS_TO_ASSESS) throw new AppError(400, "VALIDATION_ERROR", `Write at least ${MIN_WORDS_TO_ASSESS} words to get feedback.`);
      return jobView(await createJob(actor.userId, "writing.assess", "writing_submission", submission.id));
    },

    async getWriting(actor: Actor, submissionId: string) {
      const submission = await prisma.writingSubmission.findFirst({
        where: { id: submissionId, sectionAttempt: { examAttempt: { userId: actor.userId } } },
        include: { writingTask: { select: { taskType: true } }, sectionAttempt: { select: { examAttempt: { select: { examVersion: { select: { exam: { select: { examType: true } } } } } } } } },
      });
      if (!submission) throw new AppError(404, "NOT_FOUND", "This submission wasn't found.");
      const [job, result] = await Promise.all([
        prisma.aIAssessmentJob.findFirst({ where: { subjectType: "writing_submission", subjectId: submissionId }, orderBy: { queuedAt: "desc" } }),
        prisma.assessmentResult.findFirst({ where: { writingSubmissionId: submissionId, isCurrent: true, aiJobId: { not: null } }, include: { feedback: true, criterionScores: true } }),
      ]);
      if (!result) return { job: jobView(job), result: null };
      const visibility = await bandVisibleTo(actor, result, { examType: submission.sectionAttempt.examAttempt.examVersion.exam.examType, taskType: submission.writingTask.taskType });
      return { job: jobView(job), result: present(result, visibility) };
    },

    async requestSpeaking(actor: Actor, submissionId: string) {
      await requireConsent(actor.userId, ["AI_PROCESSING", "SPEECH_PROCESSING"]);
      const submission = await prisma.speakingSubmission.findFirst({ where: { id: submissionId, sectionAttempt: { examAttempt: { userId: actor.userId } } } });
      if (!submission) throw new AppError(404, "NOT_FOUND", "This recording wasn't found.");
      if (!submission.submittedAt) throw new AppError(409, "CONFLICT", "Submit your speaking section first.");
      if (!submission.audioStorageKey) throw new AppError(409, "CONFLICT", "This recording has been deleted.");
      if (!speech) throw new AppError(503, "SERVICE_UNAVAILABLE", "Speaking feedback isn't available yet.");
      return jobView(await createJob(actor.userId, "speaking.assess", "speaking_submission", submission.id));
    },

    async getSpeaking(actor: Actor, submissionId: string) {
      const submission = await prisma.speakingSubmission.findFirst({ where: { id: submissionId, sectionAttempt: { examAttempt: { userId: actor.userId } } }, select: { id: true, transcript: true, fluencyMetrics: true, status: true } });
      if (!submission) throw new AppError(404, "NOT_FOUND", "This recording wasn't found.");
      const [job, result] = await Promise.all([
        prisma.aIAssessmentJob.findFirst({ where: { subjectType: "speaking_submission", subjectId: submissionId }, orderBy: { queuedAt: "desc" } }),
        prisma.assessmentResult.findFirst({ where: { speakingSubmissionId: submissionId, isCurrent: true }, include: { feedback: true, criterionScores: true } }),
      ]);
      // Always hidden: a complete Speaking band needs all four criteria evaluated and validated, and that hasn't happened.
      return { job: jobView(job), transcript: submission.transcript, fluency: submission.fluencyMetrics, result: result ? present(result, "HIDDEN") : null };
    },

    async getJob(actor: Actor, jobId: string) {
      const job = await prisma.aIAssessmentJob.findFirst({ where: { id: jobId, userId: actor.userId } });
      if (!job) throw new AppError(404, "NOT_FOUND", "This job wasn't found.");
      return jobView(job);
    },

    // ---------- Worker steps ----------

    async markRunning(jobId: string) {
      const job = await prisma.aIAssessmentJob.findUnique({ where: { id: jobId } });
      if (!job || job.status === "COMPLETED") return null;
      return prisma.aIAssessmentJob.update({ where: { id: jobId }, data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 } } });
    },

    async markFailed(jobId: string, failure: FailureInfo) {
      const job = await prisma.aIAssessmentJob.update({ where: { id: jobId }, data: { status: "FAILED", finishedAt: new Date(), errorCode: failure.code, errorMessage: failure.message } });
      if (credits && job.creditRef && job.userId) await credits.release(job.userId, { type: "ai_job", id: job.creditRef });
    },

    async runWriting(jobId: string, subjectId: string, userId: string | null) {
      const submission = await prisma.writingSubmission.findUniqueOrThrow({
        where: { id: subjectId },
        include: { writingTask: true, sectionAttempt: { select: { examAttempt: { select: { examVersion: { select: { exam: { select: { examType: true } } } } } } } } },
      });
      const examType = submission.sectionAttempt.examAttempt.examVersion.exam.examType;
      const user = buildWritingInput({ taskType: submission.writingTask.taskType, examType, prompt: submission.writingTask.prompt, minWords: submission.writingTask.minWords, wordCount: submission.wordCount, text: submission.text });
      const run = (task: TaskKey) => ai.structured(task, user, writingOutput, { userId, jobId });
      let result = await run("writing.assess");
      // A hard-to-judge essay gets a second look from the stronger model.
      if (result.data.confidence === "low") {
        try {
          result = await run("writing.assess_complex");
        } catch (error) {
          if (error instanceof AiError && !error.retryable) throw error;
          // The first assessment still stands if the second look isn't possible.
        }
      }
      await saveResult({ jobId, subject: { writingSubmissionId: submission.id }, output: result.data, source: submission.text, configuration: result.configuration, prompt: result.prompt, modelId: result.modelId, overallBand: overallFromCriteria(result.data) });
    },

    async runSpeaking(jobId: string, subjectId: string, userId: string | null) {
      if (!speech) throw new AiError("NOT_CONFIGURED", "The speech service isn't configured.", false);
      const submission = await prisma.speakingSubmission.findUniqueOrThrow({ where: { id: subjectId }, include: { speakingQuestion: true } });
      if (!submission.audioStorageKey) throw new AiError("BAD_REQUEST", "This recording has been deleted.", false);
      let transcription: Transcription;
      let metrics: ReturnType<typeof fluencyMetrics>;
      // A retry reuses a saved transcript, so a failure after this step doesn't pay for transcription again.
      if (submission.transcript) {
        transcription = { transcript: submission.transcript, words: [], pronunciation: submission.pronunciationFeedback as Transcription["pronunciation"], durationMs: 0 };
        metrics = submission.fluencyMetrics as ReturnType<typeof fluencyMetrics>;
      } else {
        const audio = await storage.get(submission.audioStorageKey);
        if (!audio) throw new AiError("BAD_REQUEST", "This recording isn't available.", false);
        await prisma.speakingSubmission.update({ where: { id: subjectId }, data: { status: "PROCESSING" } });
        transcription = await speech.transcribe(audio);
        if (!transcription.transcript) throw new AiError("INVALID_OUTPUT", "No speech could be recognised in this recording.", false);
        metrics = fluencyMetrics(transcription.words);
        await prisma.speakingSubmission.update({
          where: { id: subjectId },
          data: { transcript: transcription.transcript, wordTimings: transcription.words as unknown as Prisma.InputJsonValue, fluencyMetrics: metrics as unknown as Prisma.InputJsonValue, ...(transcription.pronunciation ? { pronunciationFeedback: transcription.pronunciation as unknown as Prisma.InputJsonValue } : {}) },
        });
      }
      const user = `Speaking ${submission.speakingQuestion.part.replace("_", " ")} question: ${escapeForPrompt(submission.speakingQuestion.prompt)}
Delivery measures from the audio: ${JSON.stringify(metrics)}
<student_submission>
${escapeForPrompt(transcription.transcript)}
</student_submission>`;
      const result = await ai.structured("speaking.assess", user, speakingOutput, { userId, jobId });
      await prisma.speakingSubmission.update({ where: { id: subjectId }, data: { status: "COMPLETED" } });
      await saveResult({
        jobId,
        subject: { speakingSubmissionId: submission.id },
        output: result.data as Output,
        source: transcription.transcript,
        configuration: result.configuration,
        prompt: result.prompt,
        modelId: result.modelId,
        // Never an overall band: only three of the four criteria are assessed here.
        overallBand: null,
        // Pronunciation comes only from the speech service's audio measures, never from the transcript.
        ...(transcription.pronunciation ? { extraFeedback: [{ type: "PRONUNCIATION" as const, body: "Experimental measures from the speech service, from your audio. They aren't an IELTS result.", evidence: transcription.pronunciation as unknown as Prisma.InputJsonValue }] } : {}),
      });
    },

    /** Removes recordings past the retention period. Text feedback stays, without the voice data. */
    async deleteExpiredRecordings() {
      const due = await prisma.speakingSubmission.findMany({ where: { audioStorageKey: { not: null }, audioDeleteAfter: { lte: new Date() } }, select: { id: true }, take: 500 });
      let deleted = 0;
      for (const row of due) if (await removeRecordingFile(row.id)) deleted += 1;
      return deleted;
    },

    /** A student can remove their own recording at any time after submission. */
    async deleteRecording(actor: Actor, submissionId: string) {
      const submission = await prisma.speakingSubmission.findFirst({ where: { id: submissionId, sectionAttempt: { examAttempt: { userId: actor.userId } } } });
      if (!submission) throw new AppError(404, "NOT_FOUND", "This recording wasn't found.");
      await removeRecordingFile(submission.id);
      await recordAudit(prisma, actor, { action: "recording.delete", entityType: "speaking_submission", entityId: submission.id });
    },

    /** Withdrawing speech consent removes that student's stored recordings too. */
    async deleteAllRecordings(actor: Actor) {
      const rows = await prisma.speakingSubmission.findMany({ where: { audioStorageKey: { not: null }, sectionAttempt: { examAttempt: { userId: actor.userId } } }, select: { id: true } });
      for (const row of rows) await removeRecordingFile(row.id);
      await recordAudit(prisma, actor, { action: "recording.delete_all", entityType: "user", entityId: actor.userId, after: { count: rows.length } });
      return rows.length;
    },
  };

  /** Deletes the file first, and only then forgets its address. If deletion fails, the next run tries again. */
  async function removeRecordingFile(id: string) {
    const row = await prisma.speakingSubmission.findUnique({ where: { id }, select: { audioStorageKey: true } });
    if (!row?.audioStorageKey) return false;
    await storage.delete(row.audioStorageKey);
    await prisma.speakingSubmission.update({ where: { id }, data: { audioStorageKey: null, audioDeletedAt: new Date(), wordTimings: Prisma.DbNull } });
    return true;
  }
}

export function buildWritingInput(task: { taskType: string; examType: string | null; prompt: string; minWords: number; wordCount: number; text: string }) {
  return `Exam type: ${task.examType ?? "not specified"}
Task type: ${task.taskType}
Minimum words: ${task.minWords}
Word count: ${task.wordCount}
Use the criterion name ${task.taskType === "TASK_2" ? "TASK_RESPONSE" : "TASK_ACHIEVEMENT"} for the first criterion.
Task set for the student:
${escapeForPrompt(task.prompt)}

<student_submission>
${escapeForPrompt(task.text)}
</student_submission>`;
}

/** Code, not the model, works out the total. Null unless all four criteria came back valid. */
export function overallFromCriteria(output: { criteria: { estimatedBand: number }[] }) {
  const bands = output.criteria.map((row) => row.estimatedBand);
  if (bands.length !== 4 || !bands.every(isHalfBand)) return null;
  return nearestHalf(bands.reduce((sum, band) => sum + band, 0) / 4);
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
