import {
  adminExamListQuerySchema,
  attemptListQuerySchema,
  audioQuerySchema,
  examVersionReviewSchema,
  audioUpdateSchema,
  examBodySchema,
  examListQuerySchema,
  examSectionBodySchema,
  examSectionUpdateSchema,
  examUpdateSchema,
  examVersionUpdateSchema,
  passageBodySchema,
  passageUpdateSchema,
  questionBodySchema,
  questionGroupBodySchema,
  questionGroupUpdateSchema,
  questionUpdateSchema,
  recordingQuerySchema,
  saveAnswersSchema,
  saveWritingSchema,
  speakingQuestionBodySchema,
  speakingQuestionUpdateSchema,
  startAttemptSchema,
  submissionListQuerySchema,
  writingTaskBodySchema,
  writingTaskUpdateSchema,
} from "@ieltiva/shared";
import express, { Router, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requirePermission } from "../middleware/authenticate.js";
import type { AttemptService } from "../services/exam/attempt.service.js";
import type { ExamAdminService } from "../services/exam/exam-admin.service.js";
import type { Actor } from "../types/platform.js";
import { sendPage, sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

export type ExamServices = { attempts: AttemptService; examAdmin: ExamAdminService };

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const uuid = z.uuid("Invalid identifier.");
const param = (req: Request, name: string) => uuid.parse(req.params[name]);

const sendFile = (res: Response, file: { data: Buffer; contentType: string }) => {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Length", file.data.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.data);
};

const rawBody = (limit: string) => express.raw({ type: () => true, limit });
const bodyBuffer = (req: Request) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

/** Autosave limit per attempt, so a stuck client can't flood the database. */
const autosaveLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${req.auth?.userId ?? "anonymous"}:${String(req.params.attemptId)}`,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Saving too often. Please wait a moment.")),
});

/** Every route needs a signed-in user. Ownership is checked inside the attempt service, and it answers 404 for anyone else's attempt. */
export function createExamRouter({ attempts: a, examAdmin: x }: ExamServices) {
  const r = Router();
  const own: RequestHandler = requirePermission("attempts.own");
  const write: RequestHandler = requirePermission("content.write");
  const publish: RequestHandler = requirePermission("content.publish");

  // Student: exams and attempts

  r.get("/exams", own, async (req, res) => sendPage(res, "Exams", await a.listExams(actorOf(req), examListQuerySchema.parse(req.query))));
  r.get("/exams/:examId", own, async (req, res) => sendSuccess(res, "Exam", await a.getExam(actorOf(req), param(req, "examId"))));
  r.post("/exams/:examId/attempts", own, async (req, res) => sendSuccess(res, "Attempt ready", await a.start(actorOf(req), param(req, "examId"), startAttemptSchema.parse(req.body ?? {}).mode), 201));

  r.get("/attempts", own, async (req, res) => sendPage(res, "Attempts", await a.list(actorOf(req), attemptListQuerySchema.parse(req.query))));
  r.get("/attempts/:attemptId", own, async (req, res) => sendSuccess(res, "Attempt", await a.get(actorOf(req), param(req, "attemptId"))));
  r.post("/attempts/:attemptId/submit", own, async (req, res) => sendSuccess(res, "Attempt submitted", await a.submit(actorOf(req), param(req, "attemptId"))));
  r.post("/attempts/:attemptId/cancel", own, async (req, res) => sendSuccess(res, "Attempt cancelled", await a.cancel(actorOf(req), param(req, "attemptId"))));
  r.get("/attempts/:attemptId/result", own, async (req, res) => sendSuccess(res, "Result", await a.result(actorOf(req), param(req, "attemptId"))));

  const section = "/attempts/:attemptId/sections/:sectionId";
  const ids = (req: Request) => [actorOf(req), param(req, "attemptId"), param(req, "sectionId")] as const;

  r.post(`${section}/start`, own, async (req, res) => sendSuccess(res, "Section started", await a.startSection(...ids(req))));
  r.get(section, own, async (req, res) => sendSuccess(res, "Section", await a.getSection(...ids(req))));
  r.put(`${section}/answers`, own, autosaveLimit, async (req, res) => sendSuccess(res, "Answers saved", await a.saveAnswers(...ids(req), saveAnswersSchema.parse(req.body).answers)));
  r.post(`${section}/submit`, own, async (req, res) => sendSuccess(res, "Section submitted", await a.submitSection(...ids(req))));

  r.post(`${section}/audio/:audioId/play`, own, async (req, res) => sendSuccess(res, "Playback started", await a.playAudio(...ids(req), param(req, "audioId"))));
  r.get(`${section}/audio/:audioId`, own, async (req, res) => sendFile(res, await a.readAudio(...ids(req), param(req, "audioId"))));
  r.get(`${section}/groups/:itemId/image`, own, async (req, res) => sendFile(res, await a.readImage(...ids(req), "group", param(req, "itemId"))));
  r.get(`${section}/tasks/:itemId/image`, own, async (req, res) => sendFile(res, await a.readImage(...ids(req), "task", param(req, "itemId"))));

  r.put(`${section}/writing/:taskId`, own, autosaveLimit, async (req, res) => sendSuccess(res, "Draft saved", await a.saveWriting(...ids(req), param(req, "taskId"), saveWritingSchema.parse(req.body))));
  r.get("/writing/submissions", own, async (req, res) => sendPage(res, "Writing submissions", await a.listWriting(actorOf(req), submissionListQuerySchema.parse(req.query))));
  r.delete("/writing/submissions/:id", own, async (req, res) => {
    await a.discardWritingDraft(actorOf(req), param(req, "id"));
    sendSuccess(res, "Draft discarded", null);
  });

  r.put(`${section}/speaking/:questionId/recording`, own, rawBody("26mb"), async (req, res) => {
    const { durationSeconds } = recordingQuerySchema.parse(req.query);
    sendSuccess(res, "Recording saved", await a.saveRecording(...ids(req), param(req, "questionId"), bodyBuffer(req), durationSeconds));
  });
  r.get(`${section}/speaking/:questionId/recording`, own, async (req, res) => sendFile(res, await a.readRecording(...ids(req), param(req, "questionId"))));
  r.delete(`${section}/speaking/:questionId/recording`, own, async (req, res) => {
    await a.deleteRecording(...ids(req), param(req, "questionId"));
    sendSuccess(res, "Recording removed", null);
  });
  r.get("/speaking/submissions", own, async (req, res) => sendPage(res, "Speaking submissions", await a.listSpeaking(actorOf(req), submissionListQuerySchema.parse(req.query))));

  // Admin: content

  r.get("/admin/exams", write, async (req, res) => sendPage(res, "Exams", await x.list(adminExamListQuerySchema.parse(req.query))));
  r.post("/admin/exams", write, async (req, res) => sendSuccess(res, "Exam created", await x.create(actorOf(req), examBodySchema.parse(req.body)), 201));
  r.get("/admin/exams/:id", write, async (req, res) => sendSuccess(res, "Exam", await x.get(param(req, "id"))));
  r.patch("/admin/exams/:id", write, async (req, res) => sendSuccess(res, "Exam updated", await x.update(actorOf(req), param(req, "id"), examUpdateSchema.parse(req.body))));
  r.delete("/admin/exams/:id", publish, async (req, res) => {
    await x.remove(actorOf(req), param(req, "id"));
    sendSuccess(res, "Exam removed", null);
  });
  r.post("/admin/exams/:id/versions", write, async (req, res) => sendSuccess(res, "Version created", await x.createVersion(actorOf(req), param(req, "id")), 201));

  r.get("/admin/exam-versions/:id", write, async (req, res) => sendSuccess(res, "Exam version", await x.getVersion(param(req, "id"))));
  r.patch("/admin/exam-versions/:id", write, async (req, res) => sendSuccess(res, "Version updated", await x.updateVersion(actorOf(req), param(req, "id"), examVersionUpdateSchema.parse(req.body))));
  r.get("/admin/exam-versions/:id/validation", write, async (req, res) => sendSuccess(res, "Validation", await x.validate(param(req, "id"))));
  r.post("/admin/exam-versions/:id/submit-review", write, async (req, res) => sendSuccess(res, "Sent for review", await x.submitForReview(actorOf(req), param(req, "id"))));
  r.post("/admin/exam-versions/:id/withdraw-review", write, async (req, res) => sendSuccess(res, "Withdrawn from review", await x.withdrawFromReview(actorOf(req), param(req, "id"))));
  r.post("/admin/exam-versions/:id/review", requirePermission("content.review"), async (req, res) => sendSuccess(res, "Review saved", await x.reviewVersion(actorOf(req), param(req, "id"), examVersionReviewSchema.parse(req.body))));
  r.post("/admin/exam-versions/:id/publish", publish, async (req, res) => sendSuccess(res, "Version published", await x.publish(actorOf(req), param(req, "id"))));
  r.post("/admin/exam-versions/:id/archive", publish, async (req, res) => sendSuccess(res, "Version archived", await x.archive(actorOf(req), param(req, "id"))));

  r.post("/admin/exam-versions/:id/sections", write, async (req, res) => sendSuccess(res, "Section created", await x.createSection(param(req, "id"), examSectionBodySchema.parse(req.body)), 201));
  r.patch("/admin/exam-sections/:id", write, async (req, res) => sendSuccess(res, "Section updated", await x.updateSection(param(req, "id"), examSectionUpdateSchema.parse(req.body))));
  r.delete("/admin/exam-sections/:id", write, async (req, res) => {
    await x.removeSection(param(req, "id"));
    sendSuccess(res, "Section removed", null);
  });

  r.post("/admin/exam-sections/:id/passages", write, async (req, res) => sendSuccess(res, "Passage created", await x.createPassage(param(req, "id"), passageBodySchema.parse(req.body)), 201));
  r.patch("/admin/passages/:id", write, async (req, res) => sendSuccess(res, "Passage updated", await x.updatePassage(param(req, "id"), passageUpdateSchema.parse(req.body))));
  r.delete("/admin/passages/:id", write, async (req, res) => {
    await x.removePassage(param(req, "id"));
    sendSuccess(res, "Passage removed", null);
  });

  r.put("/admin/exam-sections/:id/audio", write, rawBody("101mb"), async (req, res) => sendSuccess(res, "Audio uploaded", await x.uploadAudio(param(req, "id"), bodyBuffer(req), audioQuerySchema.parse(req.query).durationSeconds), 201));
  r.get("/admin/audio/:id", write, async (req, res) => sendFile(res, await x.readAudio(param(req, "id"))));
  r.patch("/admin/audio/:id", write, async (req, res) => sendSuccess(res, "Audio updated", await x.updateAudio(param(req, "id"), audioUpdateSchema.parse(req.body))));
  r.delete("/admin/audio/:id", write, async (req, res) => {
    await x.removeAudio(param(req, "id"));
    sendSuccess(res, "Audio removed", null);
  });

  r.post("/admin/exam-sections/:id/groups", write, async (req, res) => sendSuccess(res, "Question group created", await x.createGroup(param(req, "id"), questionGroupBodySchema.parse(req.body)), 201));
  r.patch("/admin/question-groups/:id", write, async (req, res) => sendSuccess(res, "Question group updated", await x.updateGroup(param(req, "id"), questionGroupUpdateSchema.parse(req.body))));
  r.delete("/admin/question-groups/:id", write, async (req, res) => {
    await x.removeGroup(param(req, "id"));
    sendSuccess(res, "Question group removed", null);
  });
  r.put("/admin/question-groups/:id/image", write, rawBody("6mb"), async (req, res) => sendSuccess(res, "Image uploaded", await x.uploadGroupImage(param(req, "id"), bodyBuffer(req))));

  r.post("/admin/question-groups/:id/questions", write, async (req, res) => sendSuccess(res, "Question created", await x.createQuestion(param(req, "id"), questionBodySchema.parse(req.body)), 201));
  r.patch("/admin/questions/:id", write, async (req, res) => sendSuccess(res, "Question updated", await x.updateQuestion(param(req, "id"), questionUpdateSchema.parse(req.body) as never)));
  r.delete("/admin/questions/:id", write, async (req, res) => {
    await x.removeQuestion(param(req, "id"));
    sendSuccess(res, "Question removed", null);
  });

  r.post("/admin/exam-sections/:id/writing-tasks", write, async (req, res) => sendSuccess(res, "Task created", await x.createWritingTask(param(req, "id"), writingTaskBodySchema.parse(req.body)), 201));
  r.patch("/admin/writing-tasks/:id", write, async (req, res) => sendSuccess(res, "Task updated", await x.updateWritingTask(param(req, "id"), writingTaskUpdateSchema.parse(req.body))));
  r.delete("/admin/writing-tasks/:id", write, async (req, res) => {
    await x.removeWritingTask(param(req, "id"));
    sendSuccess(res, "Task removed", null);
  });

  r.post("/admin/exam-sections/:id/speaking-questions", write, async (req, res) => sendSuccess(res, "Question created", await x.createSpeakingQuestion(param(req, "id"), speakingQuestionBodySchema.parse(req.body)), 201));
  r.patch("/admin/speaking-questions/:id", write, async (req, res) => sendSuccess(res, "Question updated", await x.updateSpeakingQuestion(param(req, "id"), speakingQuestionUpdateSchema.parse(req.body))));
  r.delete("/admin/speaking-questions/:id", write, async (req, res) => {
    await x.removeSpeakingQuestion(param(req, "id"));
    sendSuccess(res, "Question removed", null);
  });

  return r;
}
