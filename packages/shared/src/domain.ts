export const userRoles = ["STUDENT", "MARKER", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const;
export type UserRole = (typeof userRoles)[number];

export const learningModules = ["LISTENING", "READING", "WRITING", "SPEAKING"] as const;
export type LearningModule = (typeof learningModules)[number];

export const ieltsExamTypes = ["ACADEMIC", "GENERAL_TRAINING"] as const;
export type IELTSExamType = (typeof ieltsExamTypes)[number];
