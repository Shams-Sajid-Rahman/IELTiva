import { z } from "zod";
import { ieltsExamTypes, learningModules, writingTaskTypes } from "./domain.js";

const text = (max: number) => z.string().trim().max(max);

export const consentTypes = ["AI_PROCESSING", "SPEECH_PROCESSING", "CALIBRATION_USE"] as const;
export const consentUpdateSchema = z.strictObject({ type: z.enum(consentTypes), granted: z.boolean() });

export const tutorMessageSchema = z.strictObject({
  message: text(8_000).min(1, "Enter a message."),
  attemptId: z.uuid().optional(),
  questionId: z.uuid().optional(),
});

export const explainSchema = z.strictObject({
  kind: z.enum(["grammar", "vocabulary", "sentence"]),
  text: text(2_000).min(1, "Enter some text."),
});

export const calibrationDatasetSchema = z.strictObject({
  version: text(80).min(3, "Enter a version name."),
  skill: z.enum(learningModules),
  examType: z.enum(ieltsExamTypes).nullable().optional(),
  taskType: z.enum(writingTaskTypes).nullable().optional(),
  description: text(2_000).nullable().optional(),
  markTolerance: z.number().min(0).max(2).optional(),
  targetSamples: z.number().int().min(1).max(100_000).optional(),
  targetMae: z.number().min(0).max(9).optional(),
  targetWithinOne: z.number().min(0).max(1).optional(),
});

export const calibrationSampleSchema = z.strictObject({
  reference: text(120).min(1, "Enter a reference."),
  split: z.enum(["TUNING", "VALIDATION", "TEST"]),
  prompt: text(5_000).min(1, "Enter the task."),
  responseText: z.string().trim().min(1, "Enter the response.").max(50_000),
  consentVersion: text(40).min(1, "Record the consent version."),
});

export const calibrationMarkSchema = z.strictObject({
  overallBand: z.number(),
  criterionBands: z.record(z.string().max(40), z.number()),
  notes: text(5_000).nullable().optional(),
});

export const calibrationRunSchema = z.strictObject({
  split: z.enum(["TUNING", "VALIDATION", "TEST"]),
  taskKey: z.enum(["writing.assess", "calibration.compare"]).default("writing.assess"),
});

export const bandReleaseSchema = z.strictObject({ visibility: z.enum(["HIDDEN", "INTERNAL", "PUBLIC"]) });

export const modelSetSchema = z.strictObject({ taskKey: text(60).min(1), modelId: text(100).min(1) });
