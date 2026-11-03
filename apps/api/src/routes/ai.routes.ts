import {
  analyticsQuerySchema,
  bandReleaseSchema,
  calibrationDatasetSchema,
  calibrationMarkSchema,
  calibrationRunSchema,
  calibrationSampleSchema,
  consentUpdateSchema,
  explainSchema,
  modelSetSchema,
  pageQuerySchema,
  tutorMessageSchema,
} from "@ieltiva/shared";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/authenticate.js";
import { userRateLimit } from "../middleware/rate-limit.js";
import type { AiRuntime } from "../services/ai/runtime.js";
import { toAppError } from "../services/ai/tutor.service.js";
import type { Actor } from "../types/platform.js";
import { sendPage, sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const uuid = z.uuid("Invalid identifier.");
const param = (req: Request, name: string) => uuid.parse(req.params[name]);

/** Stops a stuck client from sending the same AI request over and over. */
const aiLimit = userRateLimit("ai", 60_000, 20);

export function createAiRouter({ assessment: a, tutor: t, calibration: c, consents, models, ai }: AiRuntime) {
  const r = Router();
  const own: RequestHandler = requirePermission("attempts.own");
  const mark: RequestHandler = requirePermission("calibration.mark");
  const manage: RequestHandler = requirePermission("calibration.manage");
  const release: RequestHandler = requirePermission("ai.band_release");

  // Consent and privacy
  r.get("/consents", async (req, res) => sendSuccess(res, "Consents", await consents.list(actorOf(req))));
  r.put("/consents", async (req, res) => {
    const { type, granted } = consentUpdateSchema.parse(req.body);
    sendSuccess(res, "Consent saved", await consents.set(actorOf(req), type, granted));
  });
  r.delete("/speaking/submissions/:id/audio", own, async (req, res) => {
    await a.deleteRecording(actorOf(req), param(req, "id"));
    sendSuccess(res, "Recording deleted", null);
  });

  // Assessment
  r.post("/writing/submissions/:id/assessment", own, aiLimit, async (req, res) => sendSuccess(res, "Feedback requested", await a.requestWriting(actorOf(req), param(req, "id")), 202));
  r.get("/writing/submissions/:id/assessment", own, async (req, res) => sendSuccess(res, "Writing feedback", await a.getWriting(actorOf(req), param(req, "id"))));
  r.post("/speaking/submissions/:id/assessment", own, aiLimit, async (req, res) => sendSuccess(res, "Feedback requested", await a.requestSpeaking(actorOf(req), param(req, "id")), 202));
  r.get("/speaking/submissions/:id/assessment", own, async (req, res) => sendSuccess(res, "Speaking feedback", await a.getSpeaking(actorOf(req), param(req, "id"))));
  r.get("/ai/jobs/:id", own, async (req, res) => sendSuccess(res, "Job status", await a.getJob(actorOf(req), param(req, "id"))));

  // Tutor
  r.get("/tutor/conversations", own, async (req, res) => sendPage(res, "Conversations", await t.list(actorOf(req), pageQuerySchema.parse(req.query))));
  r.post("/tutor/conversations", own, aiLimit, async (req, res) => sendSuccess(res, "Conversation started", await t.create(actorOf(req)), 201));
  r.get("/tutor/conversations/:id", own, async (req, res) => sendSuccess(res, "Conversation", await t.get(actorOf(req), param(req, "id"))));
  r.delete("/tutor/conversations/:id", own, async (req, res) => {
    await t.remove(actorOf(req), param(req, "id"));
    sendSuccess(res, "Conversation deleted", null);
  });
  r.post("/tutor/explain", own, aiLimit, async (req, res) => sendSuccess(res, "Explanation", await t.explain(actorOf(req), explainSchema.parse(req.body))));

  /** Streams the reply as server-sent events. Errors before the first byte use the normal format, and later ones an error event. */
  r.post("/tutor/conversations/:id/messages", own, aiLimit, async (req, res, next) => {
    const body = tutorMessageSchema.parse(req.body);
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const open = () => {
      if (res.headersSent) return;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    };
    const send = (event: string, data: unknown) => {
      open();
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const saved = await t.send(actorOf(req), param(req, "id"), body, { signal: controller.signal, onText: (text) => send("text", { text }) });
      send("done", saved);
      res.end();
    } catch (error) {
      const failure = toAppError(error);
      if (!res.headersSent) {
        next(failure);
        return;
      }
      send("error", { message: failure.message });
      res.end();
    }
  });

  // Human calibration
  r.get("/admin/calibration/datasets", (req, res, next) => (req.auth?.permissions.includes("calibration.mark") ? next() : manage(req, res, next)), async (req, res) => sendPage(res, "Datasets", await c.listDatasets(pageQuerySchema.parse(req.query))));
  r.post("/admin/calibration/datasets", manage, async (req, res) => sendSuccess(res, "Dataset created", await c.createDataset(actorOf(req), calibrationDatasetSchema.parse(req.body)), 201));
  r.get("/admin/calibration/datasets/:id", manage, async (req, res) => sendSuccess(res, "Dataset", await c.getDataset(param(req, "id"))));
  r.post("/admin/calibration/datasets/:id/approve-thresholds", requirePermission("assessments.review"), async (req, res) => sendSuccess(res, "Targets approved", await c.approveThresholds(actorOf(req), param(req, "id"))));
  r.post("/admin/calibration/datasets/:id/samples", manage, async (req, res) => sendSuccess(res, "Sample added", await c.addSample(actorOf(req), param(req, "id"), calibrationSampleSchema.parse(req.body)), 201));
  r.post("/admin/calibration/datasets/:id/freeze", manage, async (req, res) => sendSuccess(res, "Dataset frozen", await c.freeze(actorOf(req), param(req, "id"))));
  r.get("/admin/calibration/datasets/:id/marking", mark, async (req, res) => sendPage(res, "Samples to mark", await c.listForMarking(actorOf(req), param(req, "id"), pageQuerySchema.parse(req.query))));
  r.post("/admin/calibration/samples/:id/marks", mark, async (req, res) => sendSuccess(res, "Mark saved", await c.mark(actorOf(req), param(req, "id"), calibrationMarkSchema.parse(req.body)), 201));
  r.get("/admin/calibration/datasets/:id/adjudication", manage, async (req, res) => sendPage(res, "Samples to adjudicate", await c.listForAdjudication(param(req, "id"), pageQuerySchema.parse(req.query))));
  r.post("/admin/calibration/samples/:id/adjudication", manage, async (req, res) => sendSuccess(res, "Adjudication saved", await c.adjudicate(actorOf(req), param(req, "id"), calibrationMarkSchema.parse(req.body)), 201));
  r.post("/admin/calibration/datasets/:id/runs", manage, async (req, res) => sendSuccess(res, "Run started", await c.startRun(actorOf(req), param(req, "id"), calibrationRunSchema.parse(req.body)), 202));
  r.post("/admin/calibration/runs/:id/approve", requirePermission("assessments.review"), async (req, res) => sendSuccess(res, "Run approved", await c.approveRun(actorOf(req), param(req, "id"))));
  r.post("/admin/calibration/runs/:id/release", release, async (req, res) => sendSuccess(res, "Release updated", await c.setRelease(actorOf(req), param(req, "id"), bandReleaseSchema.parse(req.body).visibility)));
  r.get("/admin/calibration/releases", manage, async (_req, res) => sendSuccess(res, "Releases", await c.listReleases()));

  // AI administration
  r.get("/admin/ai/usage", requirePermission("ai.usage.read"), async (req, res) => {
    const { from, to } = analyticsQuerySchema.parse(req.query);
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - 29 * 86_400_000);
    sendSuccess(res, "AI usage", await ai.usageSummary({ from: start, to: end }));
  });
  r.get("/admin/ai/models", requirePermission("ai.usage.read"), async (_req, res) => sendSuccess(res, "AI models", await models.list()));
  r.put("/admin/ai/models", requirePermission("ai.configure"), async (req, res) => {
    const { taskKey, modelId } = modelSetSchema.parse(req.body);
    sendSuccess(res, "Model updated", await models.setForTask(actorOf(req), taskKey, modelId));
  });

  return r;
}
