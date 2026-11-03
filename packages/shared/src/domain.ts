export const userRoles = ["STUDENT", "INSTRUCTOR", "MARKER", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const;
export type UserRole = (typeof userRoles)[number];

export const learningModules = ["LISTENING", "READING", "WRITING", "SPEAKING"] as const;
export type LearningModule = (typeof learningModules)[number];

export const ieltsExamTypes = ["ACADEMIC", "GENERAL_TRAINING"] as const;
export type IELTSExamType = (typeof ieltsExamTypes)[number];

export const publicationStatuses = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const;
export type PublicationStatus = (typeof publicationStatuses)[number];

export const questionTypes = [
  "MULTIPLE_CHOICE_SINGLE",
  "MULTIPLE_CHOICE_MULTI",
  "TRUE_FALSE_NOT_GIVEN",
  "YES_NO_NOT_GIVEN",
  "MATCHING_GENERAL",
  "MATCHING_HEADINGS",
  "MATCHING_INFORMATION",
  "MATCHING_FEATURES",
  "MATCHING_SENTENCE_ENDINGS",
  "SENTENCE_COMPLETION",
  "SUMMARY_COMPLETION",
  "NOTE_COMPLETION",
  "TABLE_COMPLETION",
  "FLOW_CHART_COMPLETION",
  "FORM_COMPLETION",
  "DIAGRAM_LABELLING",
  "PLAN_LABELLING",
  "MAP_LABELLING",
  "SHORT_ANSWER",
] as const;
export type QuestionType = (typeof questionTypes)[number];

export const writingTaskTypes = ["ACADEMIC_TASK_1", "GENERAL_TASK_1", "TASK_2"] as const;
export type WritingTaskType = (typeof writingTaskTypes)[number];

export const speakingParts = ["PART_1", "PART_2", "PART_3"] as const;
export type SpeakingPart = (typeof speakingParts)[number];

export const attemptModes = ["PRACTICE", "TIMED", "MOCK"] as const;
export type AttemptMode = (typeof attemptModes)[number];

export const attemptStatuses = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "EXPIRED", "ABANDONED"] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];

export const processingStatuses = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type ProcessingStatus = (typeof processingStatuses)[number];

export const assessmentCriteria = [
  "TASK_ACHIEVEMENT",
  "TASK_RESPONSE",
  "COHERENCE_COHESION",
  "LEXICAL_RESOURCE",
  "GRAMMATICAL_RANGE_ACCURACY",
  "FLUENCY_COHERENCE",
  "PRONUNCIATION",
] as const;
export type AssessmentCriterion = (typeof assessmentCriteria)[number];

export const bandVisibilities = ["HIDDEN", "INTERNAL", "PUBLIC"] as const;
export type BandVisibility = (typeof bandVisibilities)[number];

export const aiTiers = ["DEFAULT", "COMPLEX", "LIGHT"] as const;
export type AITier = (typeof aiTiers)[number];
