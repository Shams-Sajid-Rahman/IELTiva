import {
  aiTiers,
  assessmentCriteria,
  attemptModes,
  attemptStatuses,
  bandVisibilities,
  ieltsExamTypes,
  learningModules,
  processingStatuses,
  publicationStatuses,
  questionTypes,
  speakingParts,
  writingTaskTypes,
} from "@ieltiva/shared";
import { describe, expect, it } from "vitest";
import * as db from "../src/generated/prisma/enums.js";

const pairs: [string, readonly string[], Record<string, string>][] = [
  ["ExamType", ieltsExamTypes, db.ExamType],
  ["Skill", learningModules, db.Skill],
  ["PublicationStatus", publicationStatuses, db.PublicationStatus],
  ["QuestionType", questionTypes, db.QuestionType],
  ["WritingTaskType", writingTaskTypes, db.WritingTaskType],
  ["SpeakingPart", speakingParts, db.SpeakingPart],
  ["AttemptMode", attemptModes, db.AttemptMode],
  ["AttemptStatus", attemptStatuses, db.AttemptStatus],
  ["ProcessingStatus", processingStatuses, db.ProcessingStatus],
  ["AssessmentCriterion", assessmentCriteria, db.AssessmentCriterion],
  ["BandVisibility", bandVisibilities, db.BandVisibility],
  ["AITier", aiTiers, db.AITier],
];

describe("shared types match the database", () => {
  it.each(pairs)("%s", (_name, shared, database) => {
    expect([...shared].sort()).toEqual(Object.values(database).sort());
  });
});
