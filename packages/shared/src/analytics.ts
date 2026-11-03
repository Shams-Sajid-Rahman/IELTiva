import { z } from "zod";

export const analyticsRangeSchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
});

export const analyticsHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const halfBand = z
  .number()
  .min(1)
  .max(9)
  .refine((value) => value * 2 === Math.round(value * 2), "Use a whole or half band.");

export const learningGoalsSchema = z.strictObject({
  targetBand: halfBand.nullable(),
  examDate: z.iso.date("Enter a valid date.").nullable(),
  dailyGoalMinutes: z.number().int().min(5).max(600).nullable(),
  weeklySessionGoal: z.number().int().min(1).max(50).nullable(),
  remindersEnabled: z.boolean(),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 18:30.")
    .nullable(),
  reminderDays: z.array(z.number().int().min(0).max(6)).max(7),
});

/** The server works the plan out again from real data, so the only thing a student chooses is how far ahead to plan. */
export const studyPlanApplySchema = z.strictObject({
  days: z.number().int().min(7).max(28).default(14),
});

export const studyPlanQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(28).default(14),
});

export const adminAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

/** How far a number can be relied on. Screens must always show which of these they're displaying. */
export const scoreKinds = ["RAW", "ESTIMATED", "REVIEWED"] as const;
export type ScoreKind = (typeof scoreKinds)[number];

export const accountDeletionSchema = z.strictObject({
  password: z.string().max(128).optional(),
  confirmation: z.string().max(20),
});
