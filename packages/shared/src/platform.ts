import { z } from "zod";
import { passwordSchema } from "./auth.js";
import { ieltsExamTypes, learningModules, publicationStatuses, userRoles } from "./domain.js";

// Query helpers

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

const optionalSearch = z.string().trim().max(100).optional();
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const idParamSchema = z.object({ id: z.uuid("Invalid identifier.") });
export const pageQuerySchema = z.object(pageFields);

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Contains characters that aren't allowed.");

const httpsUrl = z
  .url("Enter a valid URL.")
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Use an https:// address.");

// Stable values

export const difficultyLevels = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export type DifficultyLevel = (typeof difficultyLevels)[number];

export const managedResourceTypes = ["ARTICLE", "DOCUMENT", "VIDEO", "EXTERNAL_LINK", "VOCABULARY", "GRAMMAR", "PRACTICE_GUIDANCE"] as const;
export type ManagedResourceType = (typeof managedResourceTypes)[number];

export const userStatuses = ["ACTIVE", "SUSPENDED", "DELETION_PENDING", "DELETED"] as const;
export type UserStatus = (typeof userStatuses)[number];

export const enrollmentStatuses = ["ACTIVE", "COMPLETED", "CANCELED"] as const;
export type EnrollmentStatus = (typeof enrollmentStatuses)[number];

export const notificationTypes = ["SYSTEM", "LEARNING", "ASSESSMENT", "PAYMENT", "SECURITY", "ANNOUNCEMENT"] as const;
export type NotificationType = (typeof notificationTypes)[number];

// Users

export const userListQuerySchema = z.object({
  ...pageFields,
  search: optionalSearch,
  role: z.preprocess(emptyToUndefined, z.enum(userRoles).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(userStatuses).optional()),
  sort: z.enum(["createdAt", "-createdAt", "email", "-email", "lastLoginAt", "-lastLoginAt"]).default("-createdAt"),
});

export const updateUserSchema = z
  .strictObject({ firstName: cleanText(100).min(1).optional(), lastName: cleanText(100).min(1).optional() })
  .refine((data) => Object.keys(data).length > 0, "Nothing to update.");

export const updateUserStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: cleanText(500).optional(),
});

export const updateUserRolesSchema = z.strictObject({ roles: z.array(z.enum(userRoles)).min(1).max(userRoles.length) });

export const updateRolePermissionsSchema = z.strictObject({ permissions: z.array(z.string().min(1).max(100)).max(100) });

// Modules

export const moduleBodySchema = z.strictObject({
  name: cleanText(120).min(2, "Enter a title."),
  description: cleanText(2000).optional(),
  skill: z.enum(learningModules).nullable().optional(),
  examType: z.enum(ieltsExamTypes).nullable().optional(),
  difficulty: z.enum(difficultyLevels).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(100_000).nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export const moduleUpdateSchema = moduleBodySchema.partial();

export const moduleListQuerySchema = z.object({
  ...pageFields,
  search: optionalSearch,
  status: z.preprocess(emptyToUndefined, z.enum(publicationStatuses).optional()),
});

// Courses

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.");

export const courseBodySchema = z.strictObject({
  title: cleanText(160).min(3, "Enter a title."),
  slug: slug.optional(),
  description: cleanText(5000).optional(),
  moduleId: z.uuid("Choose a learning module."),
  examType: z.enum(ieltsExamTypes).nullable().optional(),
  difficulty: z.enum(difficultyLevels).nullable().optional(),
  thumbnailUrl: httpsUrl.nullable().optional(),
  learningObjectives: z.array(cleanText(300).min(1)).max(20).optional(),
  estimatedMinutes: z.number().int().min(1).max(100_000).nullable().optional(),
  isPremium: z.boolean().optional(),
  instructorId: z.uuid().nullable().optional(),
});
export const courseUpdateSchema = courseBodySchema.partial();

export const courseListQuerySchema = z.object({
  ...pageFields,
  search: optionalSearch,
  status: z.preprocess(emptyToUndefined, z.enum(publicationStatuses).optional()),
  moduleId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  skill: z.preprocess(emptyToUndefined, z.enum(learningModules).optional()),
  examType: z.preprocess(emptyToUndefined, z.enum(ieltsExamTypes).optional()),
  difficulty: z.preprocess(emptyToUndefined, z.enum(difficultyLevels).optional()),
  sort: z.enum(["title", "-title", "createdAt", "-createdAt", "publishedAt", "-publishedAt"]).default("-createdAt"),
  scope: z.enum(["catalog", "manage"]).default("catalog"),
});

export const sectionBodySchema = z.strictObject({
  title: cleanText(160).min(2, "Enter a title."),
  description: cleanText(2000).optional(),
  isVisible: z.boolean().optional(),
});
export const sectionUpdateSchema = sectionBodySchema.partial().extend({ position: z.number().int().min(1).max(1000).optional() });

const resourceFields = {
  type: z.enum(managedResourceTypes),
  title: cleanText(200).min(2, "Enter a title."),
  // Lesson text is shown as plain text by the web app, so it may contain any printable characters.
  body: z.string().trim().max(50_000).nullable().optional(),
  externalUrl: httpsUrl.nullable().optional(),
  durationMinutes: z.number().int().min(1).max(10_000).nullable().optional(),
};

const LINK_TYPES: ManagedResourceType[] = ["DOCUMENT", "VIDEO", "EXTERNAL_LINK"];

export const resourceBodySchema = z.strictObject(resourceFields).superRefine((data, ctx) => {
  if (LINK_TYPES.includes(data.type) && !data.externalUrl) {
    ctx.addIssue({ code: "custom", path: ["externalUrl"], message: "This resource type needs an https:// link." });
  }
  if (!LINK_TYPES.includes(data.type) && !data.body) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Enter the lesson content." });
  }
});
export const resourceUpdateSchema = z
  .strictObject({ ...resourceFields, position: z.number().int().min(1).max(10_000) })
  .partial();

// Enrollments and progress

export const enrollSchema = z.strictObject({ courseId: z.uuid() });
export const enrollmentListQuerySchema = z.object({
  ...pageFields,
  search: optionalSearch,
  status: z.preprocess(emptyToUndefined, z.enum(enrollmentStatuses).optional()),
  courseId: z.preprocess(emptyToUndefined, z.uuid().optional()),
});
export const enrollmentUpdateSchema = z.strictObject({ status: z.enum(["ACTIVE", "CANCELED"]) });

export const progressSchema = z.strictObject({
  resourceId: z.uuid(),
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
  minutesSpent: z.number().int().min(0).max(240).optional(),
});

// Study planner

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
export const plannerTaskSchema = z.strictObject({
  title: cleanText(160).min(2, "Enter a task."),
  scheduledDate: dateOnly,
  skill: z.enum(learningModules).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
});
export const plannerTaskUpdateSchema = z.strictObject({ completed: z.boolean() });

// Profile

export const updateProfileSchema = z
  .strictObject({ firstName: cleanText(100).min(1, "This field is required."), lastName: cleanText(100).min(1, "This field is required.") })
  .partial();

export const notificationPrefsSchema = z.strictObject({
  learning: z.boolean(),
  announcements: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** Security notices can't be switched off, so they aren't a preference. */
export const defaultNotificationPrefs: NotificationPrefs = { learning: true, announcements: true };

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const supportedLocales = ["en"] as const;

const halfBand = z.number().min(0).max(9).refine((value) => value % 0.5 === 0, "Use half-band steps.");

export const updatePreferencesSchema = z
  .strictObject({
    examType: z.enum(ieltsExamTypes).nullable(),
    targetBand: halfBand.nullable(),
    examDate: dateOnly.nullable(),
    weeklyStudyHours: z.number().int().min(0).max(100).nullable(),
    dailyGoalMinutes: z.number().int().min(0).max(1440).nullable(),
    preferredSkills: z.array(z.enum(learningModules)).max(4),
    locale: z.enum(supportedLocales),
    timezone: z.string().max(64).refine(isTimeZone, "Choose a valid timezone."),
    notificationPrefs: notificationPrefsSchema,
  })
  .partial();

export const changePasswordSchema = z
  .strictObject({ currentPassword: z.string().min(1, "Enter your current password.").max(128), newPassword: passwordSchema, confirmPassword: z.string().min(1, "Confirm your password.") })
  .refine((data) => data.newPassword === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });

export const changeEmailSchema = z.strictObject({
  newEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  currentPassword: z.string().min(1, "Enter your current password.").max(128),
});

// Notifications

export const notificationListQuerySchema = z.object({
  ...pageFields,
  type: z.preprocess(emptyToUndefined, z.enum(notificationTypes).optional()),
  unread: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
});

export const announcementSchema = z
  .strictObject({
    title: cleanText(160).min(3, "Enter a title."),
    body: cleanText(2000).min(3, "Enter a message."),
    audience: z.enum(["ALL", "ROLE"]),
    audienceRole: z.enum(userRoles).optional(),
    publish: z.boolean().default(true),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((data) => data.audience !== "ROLE" || data.audienceRole, { path: ["audienceRole"], message: "Choose a role." });

// Administration

export const auditListQuerySchema = z.object({
  ...pageFields,
  action: optionalSearch,
  entityType: optionalSearch,
  actorId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  from: z.preprocess(emptyToUndefined, dateOnly.optional()),
  to: z.preprocess(emptyToUndefined, dateOnly.optional()),
});

export const analyticsQuerySchema = z.object({
  from: z.preprocess(emptyToUndefined, dateOnly.optional()),
  to: z.preprocess(emptyToUndefined, dateOnly.optional()),
});

export const settingUpdateSchema = z.strictObject({ value: z.unknown() });
