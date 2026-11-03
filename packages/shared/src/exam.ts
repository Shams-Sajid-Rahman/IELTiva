import { z } from "zod";
import { attemptModes, ieltsExamTypes, learningModules, questionTypes, speakingParts, writingTaskTypes } from "./domain.js";

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const text = (max: number) => z.string().trim().max(max);

/** Question types answered by choosing from a list. Labelling types may also use typed answers, when they have no options. */
export const choiceQuestionTypes = [
  "MULTIPLE_CHOICE_SINGLE",
  "MULTIPLE_CHOICE_MULTI",
  "TRUE_FALSE_NOT_GIVEN",
  "YES_NO_NOT_GIVEN",
  "MATCHING_GENERAL",
  "MATCHING_HEADINGS",
  "MATCHING_INFORMATION",
  "MATCHING_FEATURES",
  "MATCHING_SENTENCE_ENDINGS",
] as const;

/** Options created automatically, because these question types always use the same ones. */
export const fixedOptions: Partial<Record<(typeof questionTypes)[number], string[]>> = {
  TRUE_FALSE_NOT_GIVEN: ["TRUE", "FALSE", "NOT GIVEN"],
  YES_NO_NOT_GIVEN: ["YES", "NO", "NOT GIVEN"],
};

/** Exam-wide rules. Authors set these from verified content specifications, so nothing here claims to be an official rule. */
export const examSettingsSchema = z.strictObject({
  navigation: z.enum(["FREE", "SEQUENTIAL"]).optional(),
  reviewPolicy: z.enum(["AFTER_SUBMISSION", "NEVER"]).optional(),
  resumeWindowHours: z.number().int().min(1).max(720).optional(),
  maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
});
export type ExamSettings = z.infer<typeof examSettingsSchema>;

export const sectionSettingsSchema = z.strictObject({
  /** Empty means no limit. */
  maxAudioPlays: z.number().int().min(1).max(20).nullable().optional(),
  allowAudioSeek: z.boolean().optional(),
});
export type SectionSettings = z.infer<typeof sectionSettingsSchema>;

// Student requests

export const examListQuerySchema = z.object({
  ...page,
  search: z.preprocess(emptyToUndefined, text(100).optional()),
  examType: z.preprocess(emptyToUndefined, z.enum(ieltsExamTypes).optional()),
  skill: z.preprocess(emptyToUndefined, z.enum(learningModules).optional()),
  isMock: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
});

export const startAttemptSchema = z.strictObject({ mode: z.enum(attemptModes).optional() });

export const attemptListQuerySchema = z.object({
  ...page,
  status: z.preprocess(emptyToUndefined, z.enum(["IN_PROGRESS", "SUBMITTED", "EXPIRED", "ABANDONED"]).optional()),
});

export const answerResponseSchema = z.union([
  z.strictObject({ text: z.string().max(500) }),
  z.strictObject({ selected: z.array(z.string().min(1).max(40)).max(20) }),
]);
export type AnswerResponse = z.infer<typeof answerResponseSchema>;

export const saveAnswersSchema = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        response: answerResponseSchema.nullable().optional(),
        isFlagged: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const saveWritingSchema = z.strictObject({
  text: z.string().max(50_000),
  timeSpentSeconds: z.number().int().min(0).max(86_400).optional(),
});

export const recordingQuerySchema = z.object({ durationSeconds: z.coerce.number().int().min(1).max(600) });

export const submissionListQuerySchema = z.object({
  ...page,
  status: z.preprocess(emptyToUndefined, z.enum(["draft", "submitted"]).optional()),
});

// Admin requests

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const examBodySchema = z.strictObject({
  title: text(160).min(3, "Enter a title."),
  slug: text(120).regex(slugPattern, "Use lowercase letters, numbers and hyphens.").optional(),
  examType: z.enum(ieltsExamTypes).nullable().optional(),
  isPremium: z.boolean().optional(),
  isMock: z.boolean().optional(),
});
export const examUpdateSchema = examBodySchema.partial();

export const adminExamListQuerySchema = z.object({ ...page, search: z.preprocess(emptyToUndefined, text(100).optional()) });

export const examVersionUpdateSchema = z.strictObject({
  provenance: z.enum(["ORIGINAL", "LICENSED", "AI_ASSISTED_REVIEWED"]).optional(),
  sourceNote: text(2000).nullable().optional(),
  settings: examSettingsSchema.optional(),
});

export const examSectionBodySchema = z.strictObject({
  skill: z.enum(learningModules),
  title: text(160).min(2, "Enter a title."),
  instructions: text(5000).nullable().optional(),
  durationSeconds: z.number().int().min(60).max(14_400),
  settings: sectionSettingsSchema.optional(),
});
export const examSectionUpdateSchema = examSectionBodySchema.partial();

export const passageBodySchema = z.strictObject({
  title: text(200).min(2, "Enter a title."),
  body: z.string().trim().min(1, "Enter the passage.").max(50_000),
});
export const passageUpdateSchema = passageBodySchema.partial();

export const audioQuerySchema = z.object({ durationSeconds: z.coerce.number().int().min(1).max(14_400) });
export const audioUpdateSchema = z.strictObject({
  transcript: z.string().trim().max(50_000).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(14_400).optional(),
});

export const questionGroupBodySchema = z.strictObject({
  type: z.enum(questionTypes),
  instructions: text(5000).nullable().optional(),
  stimulus: z.record(z.string(), z.unknown()).nullable().optional(),
});
export const questionGroupUpdateSchema = questionGroupBodySchema.partial();

const optionSchema = z.strictObject({ label: text(40).min(1, "Enter a label."), body: text(1000).min(1, "Enter the option text.") });
const answerKeySchema = z.strictObject({
  acceptedValue: text(300).min(1, "Enter an accepted answer."),
  caseSensitive: z.boolean().optional(),
  ignorePunctuation: z.boolean().optional(),
  maxWords: z.number().int().min(1).max(20).nullable().optional(),
});

export const questionBodySchema = z.strictObject({
  number: z.number().int().min(1).max(200),
  prompt: text(2000).nullable().optional(),
  explanation: text(5000).nullable().optional(),
  marks: z.number().int().min(1).max(20).optional(),
  scoringMode: z.enum(["ALL_OR_NOTHING", "PER_ITEM"]).optional(),
  options: z.array(optionSchema).max(26).optional(),
  answers: z.array(answerKeySchema).min(1, "Add at least one accepted answer.").max(30),
});
export const questionUpdateSchema = questionBodySchema.partial();

export const writingTaskBodySchema = z.strictObject({
  taskType: z.enum(writingTaskTypes),
  prompt: text(5000).min(10, "Enter the task."),
  minWords: z.number().int().min(1).max(1000),
  suggestedMinutes: z.number().int().min(1).max(240),
});
export const writingTaskUpdateSchema = writingTaskBodySchema.partial();

export const speakingQuestionBodySchema = z.strictObject({
  part: z.enum(speakingParts),
  prompt: text(2000).min(3, "Enter the question."),
  cueCard: z.array(text(300)).max(10).nullable().optional(),
  prepSeconds: z.number().int().min(0).max(600).nullable().optional(),
  maxAnswerSeconds: z.number().int().min(5).max(600),
});
export const speakingQuestionUpdateSchema = speakingQuestionBodySchema.partial();
