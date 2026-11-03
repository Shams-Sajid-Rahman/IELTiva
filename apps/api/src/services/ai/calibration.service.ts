import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import type { AiService } from "./ai.service.js";
import { buildWritingInput, nearestHalf, overallFromCriteria, writingOutput } from "./assessment.service.js";
import { countWords } from "../exam/marking.js";
import type { AiQueue } from "./queue.js";

type CriterionBands = Record<string, number>;

/**
 * Compares AI predictions with final human marks. MAE is mean absolute band error.
 * The targets are IELTiva's internal acceptance criteria, which the instructor must approve. They aren't official IELTS standards.
 */
export function compareBands(pairs: { human: number; ai: number }[], targets: { samples: number; mae: number; withinOne: number }) {
  const count = pairs.length;
  const differences = pairs.map((pair) => Math.abs(pair.human - pair.ai));
  const share = (limit: number) => (count ? differences.filter((value) => value <= limit).length / count : 0);
  const mae = count ? differences.reduce((sum, value) => sum + value, 0) / count : null;
  const withinOne = share(1);
  return {
    count,
    mae,
    exact: share(0),
    withinHalf: share(0.5),
    withinOne,
    targets,
    meetsTargets: count >= targets.samples && mae !== null && mae <= targets.mae && withinOne >= targets.withinOne,
  };
}

/** Means of whole marks fall on quarter bands, so this keeps to the half-band scale. */
const agreedBand = (a: number, b: number) => nearestHalf((a + b) / 2);

const isBand = (value: number) => value >= 0 && value <= 9 && value * 2 === Math.round(value * 2);

export function createCalibrationService({ prisma, ai, queue }: { prisma: PrismaClient; ai: AiService; queue: AiQueue | null }) {
  const dataset = async (id: string) => {
    const row = await prisma.calibrationDataset.findUnique({ where: { id } });
    if (!row) throw new AppError(404, "NOT_FOUND", "This dataset wasn't found.");
    return row;
  };
  const unfrozen = async (id: string) => {
    const row = await dataset(id);
    if (row.frozenAt) throw new AppError(409, "CONFLICT", "This dataset is frozen and can't change.");
    return row;
  };

  const sampleWithDataset = async (sampleId: string) => {
    const sample = await prisma.calibrationSample.findUnique({ where: { id: sampleId }, include: { dataset: true } });
    if (!sample) throw new AppError(404, "NOT_FOUND", "This sample wasn't found.");
    return sample;
  };

  const checkMark = (body: { overallBand: number; criterionBands: CriterionBands }) => {
    if (!isBand(body.overallBand) || !Object.values(body.criterionBands).every(isBand)) throw new AppError(400, "VALIDATION_ERROR", "Use bands from 0 to 9, in half-band steps.");
  };

  return {
    async listDatasets(query: { page: number; pageSize: number }) {
      const [items, total] = await prisma.$transaction([
        prisma.calibrationDataset.findMany({ orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { _count: { select: { samples: true, runs: true } } } }),
        prisma.calibrationDataset.count(),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async createDataset(actor: Actor, body: { version: string; skill: "LISTENING" | "READING" | "WRITING" | "SPEAKING"; examType?: "ACADEMIC" | "GENERAL_TRAINING" | null | undefined; taskType?: "ACADEMIC_TASK_1" | "GENERAL_TASK_1" | "TASK_2" | null | undefined; description?: string | null | undefined; markTolerance?: number | undefined; targetSamples?: number | undefined; targetMae?: number | undefined; targetWithinOne?: number | undefined }) {
      if (body.skill !== "WRITING" && body.skill !== "SPEAKING") throw new AppError(400, "VALIDATION_ERROR", "Calibration covers Writing and Speaking.");
      // Academic, General Training, Task 1 and Task 2 are never pooled.
      if (body.skill === "WRITING" && (!body.examType || !body.taskType)) throw new AppError(400, "VALIDATION_ERROR", "A Writing dataset needs one IELTS type and one task.");
      if (body.taskType === "ACADEMIC_TASK_1" && body.examType !== "ACADEMIC") throw new AppError(400, "VALIDATION_ERROR", "Academic Task 1 belongs in an Academic dataset.");
      if (body.taskType === "GENERAL_TASK_1" && body.examType !== "GENERAL_TRAINING") throw new AppError(400, "VALIDATION_ERROR", "General Training Task 1 belongs in a General Training dataset.");
      const row = await prisma.calibrationDataset.create({
        data: {
          version: body.version,
          skill: body.skill,
          examType: body.examType ?? null,
          taskType: body.taskType ?? null,
          description: body.description ?? null,
          ...(body.markTolerance === undefined ? {} : { markTolerance: body.markTolerance }),
          ...(body.targetSamples === undefined ? {} : { targetSamples: body.targetSamples }),
          ...(body.targetMae === undefined ? {} : { targetMae: body.targetMae }),
          ...(body.targetWithinOne === undefined ? {} : { targetWithinOne: body.targetWithinOne }),
        },
      });
      await recordAudit(prisma, actor, { action: "calibration.dataset_create", entityType: "calibration_dataset", entityId: row.id, after: { version: row.version } });
      return row;
    },

    /** The instructor's sign-off on the targets. These are IELTiva's own criteria and need this approval before any release. */
    async approveThresholds(actor: Actor, id: string) {
      await unfrozen(id);
      const row = await prisma.calibrationDataset.update({ where: { id }, data: { thresholdsApprovedById: actor.userId, thresholdsApprovedAt: new Date() } });
      await recordAudit(prisma, actor, { action: "calibration.thresholds_approve", entityType: "calibration_dataset", entityId: id, after: { mae: row.targetMae, withinOne: row.targetWithinOne, samples: row.targetSamples } });
      return row;
    },

    async addSample(actor: Actor, datasetId: string, body: { reference: string; split: "TUNING" | "VALIDATION" | "TEST"; prompt: string; responseText: string; consentVersion: string }) {
      await unfrozen(datasetId);
      const sample = await prisma.calibrationSample.create({ data: { datasetId, ...body, deidentifiedAt: new Date() } });
      await recordAudit(prisma, actor, { action: "calibration.sample_add", entityType: "calibration_sample", entityId: sample.id });
      return sample;
    },

    /** What a marker works from: never who wrote it, and never anyone else's mark. */
    async listForMarking(actor: Actor, datasetId: string, query: { page: number; pageSize: number }) {
      const where: Prisma.CalibrationSampleWhereInput = { datasetId, status: "NEEDS_MARKS", records: { none: { markerId: actor.userId, recordType: "HUMAN_MARK" } } };
      const [items, total] = await prisma.$transaction([
        prisma.calibrationSample.findMany({ where, orderBy: { createdAt: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, reference: true, prompt: true, responseText: true } }),
        prisma.calibrationSample.count({ where }),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    /** Records one independent mark. The second one decides whether the sample is approved or goes to adjudication. */
    async mark(actor: Actor, sampleId: string, body: { overallBand: number; criterionBands: CriterionBands; notes?: string | null | undefined }) {
      checkMark(body);
      const sample = await sampleWithDataset(sampleId);
      if (sample.dataset.frozenAt) throw new AppError(409, "CONFLICT", "This dataset is frozen and can't change.");
      if (sample.status !== "NEEDS_MARKS") throw new AppError(409, "CONFLICT", "This sample has all its marks.");
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM calibration_samples WHERE id = ${sampleId}::uuid FOR UPDATE`;
        const existing = await tx.assessmentCalibrationRecord.findMany({ where: { sampleId, recordType: "HUMAN_MARK" } });
        if (existing.some((row) => row.markerId === actor.userId)) throw new AppError(409, "CONFLICT", "You've already marked this sample.");
        if (existing.length >= 2) throw new AppError(409, "CONFLICT", "This sample has all its marks.");
        await tx.assessmentCalibrationRecord.create({
          data: {
            sampleId,
            sampleReference: sample.reference,
            datasetVersion: sample.dataset.version,
            skill: sample.dataset.skill,
            taskKey: sample.dataset.taskType ?? "speaking",
            split: sample.split,
            recordType: "HUMAN_MARK",
            markerId: actor.userId,
            overallBand: body.overallBand,
            criterionBands: body.criterionBands,
            notes: body.notes ?? null,
            consentVersion: sample.consentVersion,
            deidentifiedAt: sample.deidentifiedAt,
          },
        });
        if (existing.length === 0) return { status: "NEEDS_MARKS" as const };
        const first = Number(existing[0]!.overallBand);
        if (Math.abs(first - body.overallBand) <= Number(sample.dataset.markTolerance)) {
          const criteria = existing[0]!.criterionBands as CriterionBands;
          const finalCriteria = Object.fromEntries(Object.keys(body.criterionBands).map((key) => [key, agreedBand(criteria[key] ?? body.criterionBands[key]!, body.criterionBands[key]!)]));
          await tx.calibrationSample.update({ where: { id: sampleId }, data: { status: "APPROVED", finalBand: agreedBand(first, body.overallBand), finalCriterionBands: finalCriteria } });
          return { status: "APPROVED" as const };
        }
        await tx.calibrationSample.update({ where: { id: sampleId }, data: { status: "NEEDS_ADJUDICATION" } });
        return { status: "NEEDS_ADJUDICATION" as const };
      });
    },

    async listForAdjudication(datasetId: string, query: { page: number; pageSize: number }) {
      const where: Prisma.CalibrationSampleWhereInput = { datasetId, status: "NEEDS_ADJUDICATION" };
      const [items, total] = await prisma.$transaction([
        prisma.calibrationSample.findMany({ where, orderBy: { createdAt: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, reference: true, prompt: true, responseText: true, records: { where: { recordType: "HUMAN_MARK" }, select: { overallBand: true, criterionBands: true, notes: true } } } }),
        prisma.calibrationSample.count({ where }),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    /** A separate senior decision, so neither original marker can settle their own disagreement. */
    async adjudicate(actor: Actor, sampleId: string, body: { overallBand: number; criterionBands: CriterionBands; notes?: string | null | undefined }) {
      checkMark(body);
      const sample = await sampleWithDataset(sampleId);
      if (sample.dataset.frozenAt) throw new AppError(409, "CONFLICT", "This dataset is frozen and can't change.");
      if (sample.status !== "NEEDS_ADJUDICATION") throw new AppError(409, "CONFLICT", "This sample doesn't need adjudication.");
      const marked = await prisma.assessmentCalibrationRecord.findFirst({ where: { sampleId, recordType: "HUMAN_MARK", markerId: actor.userId } });
      if (marked) throw new AppError(403, "FORBIDDEN", "You marked this sample, so someone else must adjudicate it.");
      await prisma.$transaction([
        prisma.assessmentCalibrationRecord.create({
          data: { sampleId, sampleReference: sample.reference, datasetVersion: sample.dataset.version, skill: sample.dataset.skill, taskKey: sample.dataset.taskType ?? "speaking", split: sample.split, recordType: "ADJUDICATION", markerId: actor.userId, overallBand: body.overallBand, criterionBands: body.criterionBands, notes: body.notes ?? null, consentVersion: sample.consentVersion, deidentifiedAt: sample.deidentifiedAt },
        }),
        prisma.calibrationSample.update({ where: { id: sampleId }, data: { status: "APPROVED", finalBand: body.overallBand, finalCriterionBands: body.criterionBands } }),
      ]);
      await recordAudit(prisma, actor, { action: "calibration.adjudicate", entityType: "calibration_sample", entityId: sampleId });
      return { status: "APPROVED" as const };
    },

    async getDataset(id: string) {
      const row = await dataset(id);
      const counts = await prisma.calibrationSample.groupBy({ by: ["status"], where: { datasetId: id }, _count: { _all: true } });
      const runs = await prisma.calibrationRun.findMany({ where: { datasetId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { modelConfiguration: { select: { modelId: true } }, promptVersion: { select: { taskKey: true, version: true } } } });
      return { ...row, statusCounts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])), runs };
    },

    /** Locks the dataset, so evaluation can't drift. Every sample must have its final human mark. */
    async freeze(actor: Actor, id: string) {
      await unfrozen(id);
      const [total, approved] = await Promise.all([prisma.calibrationSample.count({ where: { datasetId: id } }), prisma.calibrationSample.count({ where: { datasetId: id, status: "APPROVED" } })]);
      if (total === 0) throw new AppError(409, "CONFLICT", "Add samples before freezing.");
      if (approved !== total) throw new AppError(409, "CONFLICT", "Every sample needs its final mark before freezing.");
      const row = await prisma.calibrationDataset.update({ where: { id }, data: { frozenAt: new Date(), frozenById: actor.userId } });
      await recordAudit(prisma, actor, { action: "calibration.freeze", entityType: "calibration_dataset", entityId: id, after: { samples: total } });
      return row;
    },

    async startRun(actor: Actor, datasetId: string, body: { split: "TUNING" | "VALIDATION" | "TEST"; taskKey: "writing.assess" | "calibration.compare" }) {
      if (!ai.isConfigured() || !queue) throw new AppError(503, "SERVICE_UNAVAILABLE", "AI processing isn't available yet.");
      const row = await dataset(datasetId);
      if (!row.frozenAt) throw new AppError(409, "CONFLICT", "Freeze the dataset first.");
      if (row.skill !== "WRITING") throw new AppError(409, "CONFLICT", "AI comparison covers Writing for now. Speaking can't be compared until all four criteria can be evaluated.");
      const [configuration, prompt] = await Promise.all([ai.resolveModel(body.taskKey), ai.resolvePrompt("writing.assess")]);
      const run = await prisma.calibrationRun.create({ data: { datasetId, split: body.split, taskKey: body.taskKey, modelConfigurationId: configuration.id, promptVersionId: prompt.id, createdById: actor.userId } });
      try {
        await queue.add("calibration.run", { jobId: run.id }, run.id);
      } catch {
        await prisma.calibrationRun.update({ where: { id: run.id }, data: { status: "FAILED", errorMessage: "The AI queue couldn't be reached." } });
        throw new AppError(503, "SERVICE_UNAVAILABLE", "AI processing isn't available right now.");
      }
      await recordAudit(prisma, actor, { action: "calibration.run_start", entityType: "calibration_run", entityId: run.id });
      return run;
    },

    /** Worker step. Predictions already made are kept, so a retry only pays for what's left. */
    async executeRun(runId: string) {
      const run = await prisma.calibrationRun.findUniqueOrThrow({ where: { id: runId }, include: { dataset: true } });
      if (run.status === "COMPLETED") return;
      await prisma.calibrationRun.update({ where: { id: runId }, data: { status: "PROCESSING", errorMessage: null } });
      const samples = await prisma.calibrationSample.findMany({ where: { datasetId: run.datasetId, split: run.split, status: "APPROVED" } });
      const pairs: { human: number; ai: number }[] = [];
      const criterionGaps: Record<string, number[]> = {};
      for (const sample of samples) {
        // The same model and prompt on a frozen sample needs no second paid call, so an earlier prediction is reused.
        let record = await prisma.assessmentCalibrationRecord.findFirst({ where: { datasetVersion: run.dataset.version, sampleReference: sample.reference, recordType: "AI_PREDICTION", modelConfigurationId: run.modelConfigurationId, promptVersionId: run.promptVersionId } });
        if (!record) {
          const input = buildWritingInput({ taskType: run.dataset.taskType ?? "TASK_2", examType: run.dataset.examType, prompt: sample.prompt, minWords: run.dataset.taskType === "TASK_2" ? 250 : 150, wordCount: countWords(sample.responseText), text: sample.responseText });
          const result = await ai.structured(run.taskKey as "writing.assess" | "calibration.compare", input, writingOutput, {});
          const overall = overallFromCriteria(result.data);
          record = await prisma.assessmentCalibrationRecord.create({
            data: {
              sampleId: sample.id,
              runId,
              sampleReference: sample.reference,
              datasetVersion: run.dataset.version,
              skill: run.dataset.skill,
              taskKey: run.taskKey,
              split: sample.split,
              recordType: "AI_PREDICTION",
              modelConfigurationId: result.configuration.id,
              promptVersionId: result.prompt.id,
              overallBand: overall,
              criterionBands: Object.fromEntries(result.data.criteria.map((row) => [row.criterion, row.estimatedBand])),
            },
          });
        }
        if (record.overallBand === null) continue;
        pairs.push({ human: Number(sample.finalBand), ai: Number(record.overallBand) });
        const human = (sample.finalCriterionBands ?? {}) as CriterionBands;
        for (const [key, value] of Object.entries((record.criterionBands ?? {}) as CriterionBands)) {
          if (human[key] !== undefined) (criterionGaps[key] ??= []).push(Math.abs(human[key]! - value));
        }
      }
      const metrics = compareBands(pairs, { samples: run.dataset.targetSamples, mae: Number(run.dataset.targetMae), withinOne: Number(run.dataset.targetWithinOne) });
      const byCriterion = Object.fromEntries(Object.entries(criterionGaps).map(([key, gaps]) => [key, gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length]));
      await prisma.calibrationRun.update({ where: { id: runId }, data: { status: "COMPLETED", metrics: { ...metrics, byCriterion, samplesInSplit: samples.length } } });
    },

    async failRun(runId: string, message: string) {
      await prisma.calibrationRun.update({ where: { id: runId }, data: { status: "FAILED", errorMessage: message } });
    },

    async approveRun(actor: Actor, runId: string) {
      const run = await prisma.calibrationRun.findUnique({ where: { id: runId } });
      if (!run) throw new AppError(404, "NOT_FOUND", "This run wasn't found.");
      if (run.status !== "COMPLETED") throw new AppError(409, "CONFLICT", "This run hasn't finished.");
      const updated = await prisma.calibrationRun.update({ where: { id: runId }, data: { instructorApprovedById: actor.userId, instructorApprovedAt: new Date() } });
      await recordAudit(prisma, actor, { action: "calibration.run_approve", entityType: "calibration_run", entityId: runId });
      return updated;
    },

    /**
     * Opens or closes the band gate for one exact model, prompt, IELTS type and task.
     * Public release needs every safeguard, and Speaking can't be released at all yet.
     */
    async setRelease(actor: Actor, runId: string, visibility: "HIDDEN" | "INTERNAL" | "PUBLIC") {
      const run = await prisma.calibrationRun.findUnique({ where: { id: runId }, include: { dataset: true } });
      if (!run) throw new AppError(404, "NOT_FOUND", "This run wasn't found.");
      const { dataset: set } = run;
      if (set.skill !== "WRITING" || !set.examType || !set.taskType) throw new AppError(409, "CONFLICT", "Only Writing bands can be released. A complete Speaking band needs all four criteria evaluated and validated.");
      if (!run.modelConfigurationId || !run.promptVersionId) throw new AppError(409, "CONFLICT", "This run has no fixed model and prompt.");
      if (visibility === "PUBLIC") {
        const metrics = run.metrics as { meetsTargets?: boolean } | null;
        const blockers = [
          !set.frozenAt && "The dataset isn't frozen.",
          !set.thresholdsApprovedAt && "The instructor hasn't approved the targets.",
          run.status !== "COMPLETED" && "The run hasn't finished.",
          run.split !== "TEST" && "Release needs a run on the test split, which is never used for tuning.",
          !metrics?.meetsTargets && "The run doesn't meet the targets.",
          !run.instructorApprovedAt && "The instructor hasn't approved this run.",
        ].filter(Boolean) as string[];
        if (blockers.length) throw new AppError(409, "CONFLICT", blockers.join(" "), blockers.map((message) => ({ path: "release", message })));
      }
      const scope = { modelConfigurationId: run.modelConfigurationId, promptVersionId: run.promptVersionId, examType: set.examType, taskType: set.taskType };
      const existing = await prisma.bandRelease.findFirst({ where: scope });
      const row = existing
        ? await prisma.bandRelease.update({ where: { id: existing.id }, data: { visibility, runId, approvedById: actor.userId } })
        : await prisma.bandRelease.create({ data: { ...scope, visibility, runId, approvedById: actor.userId } });
      await recordAudit(prisma, actor, { action: "calibration.band_release", entityType: "band_release", entityId: row.id, after: { visibility, runId } });
      return row;
    },

    listReleases: () => prisma.bandRelease.findMany({ orderBy: { updatedAt: "desc" }, include: { modelConfiguration: { select: { modelId: true, taskKey: true } }, promptVersion: { select: { version: true, taskKey: true } } } }),
  };
}

export type CalibrationService = ReturnType<typeof createCalibrationService>;
