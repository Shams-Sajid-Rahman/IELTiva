import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

/**
 * Every switch an administrator can use. `defaultOn` applies until someone stores a choice, and existing
 * features default to on so that adding a switch changes nothing by itself.
 */
export const featureFlagDefinitions = [
  { key: "registration.open", defaultOn: true },
  { key: "ai.writing_feedback", defaultOn: true },
  { key: "ai.speaking_feedback", defaultOn: true },
  { key: "ai.tutor", defaultOn: true },
  { key: "ai.recommendation_explanations", defaultOn: true },
  { key: "payments.checkout", defaultOn: true },
  { key: "reviews.instructor", defaultOn: true },
  { key: "reports.downloads", defaultOn: true },
  { key: "feedback.collection", defaultOn: true },
  { key: "beta.access_required", defaultOn: false },
  { key: "content.publication_approval", defaultOn: false },
] as const;
export type FeatureFlagKey = (typeof featureFlagDefinitions)[number]["key"];
export const featureFlagKeys = featureFlagDefinitions.map((flag) => flag.key) as [FeatureFlagKey, ...FeatureFlagKey[]];

export const releaseChannels = ["development", "beta", "production"] as const;
export type ReleaseChannel = (typeof releaseChannels)[number];

export const flagUpdateSchema = z.strictObject({ enabled: z.boolean() });
export const maintenanceMessageSchema = z.strictObject({ message: text(300).nullable() });

export const betaAccessSchema = z.strictObject({
  email: z.email("Enter a valid email.").max(254).transform((value) => value.toLowerCase()),
  note: text(300).nullable().optional(),
});

export const feedbackCategories = ["BUG", "CONTENT", "AI_FEEDBACK", "PAYMENT", "IDEA", "OTHER"] as const;
export const feedbackSchema = z.strictObject({
  category: z.enum(feedbackCategories),
  message: text(4_000).min(5, "Please tell us a little more."),
  page: text(200).nullable().optional(),
});
export const feedbackUpdateSchema = z.strictObject({
  status: z.enum(["NEW", "TRIAGED", "RESOLVED"]),
  staffNote: text(2_000).nullable().optional(),
});
export const feedbackQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["NEW", "TRIAGED", "RESOLVED"]).optional(),
});

export const incidentSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const incidentStatuses = ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"] as const;
export const incidentSchema = z.strictObject({
  title: text(160).min(3, "Enter a title."),
  severity: z.enum(incidentSeverities),
  summary: text(4_000).min(3, "Say what happened."),
  personalDataAffected: z.boolean().default(false),
  paymentsAffected: z.boolean().default(false),
});
export const incidentUpdateSchema = z.strictObject({
  body: text(4_000).min(3, "Say what changed."),
  status: z.enum(incidentStatuses).optional(),
});
export const incidentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(incidentStatuses).optional(),
});

export const examVersionReviewSchema = z.strictObject({
  decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
  note: text(2_000).nullable().optional(),
});

const band = z.number().min(0).max(9).refine((value) => value * 2 === Math.round(value * 2), "Use half bands.");
export const instructorReviewSchema = z.strictObject({
  overallBand: band.nullable(),
  criterionBands: z.record(z.string().max(40), band),
  note: text(5_000).nullable().optional(),
});
export const instructorReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["REQUESTED", "COMPLETED"]).default("REQUESTED"),
});

export const pronunciationCheckSchema = z.strictObject({ split: z.enum(["TUNING", "VALIDATION", "TEST"]) });
