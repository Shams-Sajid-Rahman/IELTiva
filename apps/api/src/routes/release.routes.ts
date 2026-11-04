import {
  betaAccessSchema,
  feedbackQuerySchema,
  feedbackSchema,
  feedbackUpdateSchema,
  featureFlagKeys,
  flagUpdateSchema,
  incidentQuerySchema,
  incidentSchema,
  incidentUpdateSchema,
  instructorReviewQuerySchema,
  instructorReviewSchema,
  maintenanceMessageSchema,
  pageQuerySchema,
  type FeatureFlagKey,
} from "@ieltiva/shared";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/authenticate.js";
import { userRateLimit } from "../middleware/rate-limit.js";
import type { ReleaseService } from "../services/release/release.service.js";
import type { InstructorReviewService } from "../services/review/instructor-review.service.js";
import type { Actor } from "../types/platform.js";
import { sendPage, sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const uuid = z.uuid("Invalid identifier.");
const param = (req: Request, name: string) => uuid.parse(req.params[name]);

/** Stops a feature on the server when its switch is off, whatever the browser shows. */
export function requireFlag(release: Pick<ReleaseService, "isEnabled">, key: FeatureFlagKey, message: string): RequestHandler {
  return async (_req, _res, next) => {
    next((await release.isEnabled(key)) ? undefined : new AppError(503, "SERVICE_UNAVAILABLE", message));
  };
}

/** Readable without signing in, because the sign-in and registration pages need it too. It holds no personal data. */
export function createReleasePublicRouter(release: Pick<ReleaseService, "publicState">) {
  const r = Router();
  r.get("/release/state", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=30");
    sendSuccess(res, "Release state", await release.publicState());
  });
  return r;
}

export function createReleaseRouter({ release, reviews }: { release: ReleaseService; reviews: InstructorReviewService }) {
  const r = Router();
  const manage = requirePermission("release.manage");
  const support = requirePermission("support.manage");
  const review = requirePermission("assessments.review");
  const reviewsOn = requireFlag(release, "reviews.instructor", "Instructor reviews aren't available right now.");

  // Release controls
  r.get("/admin/release", manage, async (_req, res) => sendSuccess(res, "Release controls", await release.adminOverview()));
  r.put("/admin/release/flags/:key", manage, async (req, res) => {
    const key = z.enum(featureFlagKeys).parse(req.params.key);
    sendSuccess(res, "Switch saved", await release.setFlag(actorOf(req), key, flagUpdateSchema.parse(req.body).enabled));
  });
  r.put("/admin/release/maintenance", manage, async (req, res) => sendSuccess(res, "Message saved", await release.setMaintenanceMessage(actorOf(req), maintenanceMessageSchema.parse(req.body).message)));
  r.get("/admin/release/beta", manage, async (req, res) => sendPage(res, "Beta access", await release.listBeta(pageQuerySchema.parse(req.query))));
  r.post("/admin/release/beta", manage, async (req, res) => sendSuccess(res, "Address allowed", await release.addBeta(actorOf(req), betaAccessSchema.parse(req.body)), 201));
  r.delete("/admin/release/beta/:id", manage, async (req, res) => {
    await release.revokeBeta(actorOf(req), param(req, "id"));
    sendSuccess(res, "Access removed", null);
  });

  // Feedback
  r.post("/feedback", userRateLimit("feedback", 60_000, 5), async (req, res) => sendSuccess(res, "Thank you", await release.submitFeedback(actorOf(req), feedbackSchema.parse(req.body)), 201));
  r.get("/admin/feedback", support, async (req, res) => sendPage(res, "Feedback", await release.listFeedback(feedbackQuerySchema.parse(req.query))));
  r.patch("/admin/feedback/:id", support, async (req, res) => {
    await release.updateFeedback(actorOf(req), param(req, "id"), feedbackUpdateSchema.parse(req.body));
    sendSuccess(res, "Feedback updated", null);
  });

  // Incidents
  r.get("/admin/incidents", support, async (req, res) => sendPage(res, "Incidents", await release.listIncidents(incidentQuerySchema.parse(req.query))));
  r.post("/admin/incidents", support, async (req, res) => sendSuccess(res, "Incident recorded", await release.openIncident(actorOf(req), incidentSchema.parse(req.body)), 201));
  r.post("/admin/incidents/:id/updates", support, async (req, res) => {
    await release.updateIncident(actorOf(req), param(req, "id"), incidentUpdateSchema.parse(req.body));
    sendSuccess(res, "Incident updated", null);
  });

  // Instructor review: students ask for it on their own work, and instructors see the work without the student's name.
  for (const kind of ["writing", "speaking"] as const) {
    r.get(`/${kind}/submissions/:id/review`, async (req, res) => sendSuccess(res, "Review", await reviews.mine(actorOf(req), kind, param(req, "id"))));
    r.post(`/${kind}/submissions/:id/review`, reviewsOn, userRateLimit(`review-request-${kind}`, 60_000, 5), async (req, res) => sendSuccess(res, "Review requested", await reviews.request(actorOf(req), kind, param(req, "id")), 201));
    r.delete(`/${kind}/submissions/:id/review`, async (req, res) => {
      await reviews.cancel(actorOf(req), kind, param(req, "id"));
      sendSuccess(res, "Request cancelled", null);
    });
  }
  r.get("/admin/reviews", review, async (req, res) => sendPage(res, "Reviews", await reviews.queue(instructorReviewQuerySchema.parse(req.query))));
  r.get("/admin/reviews/:id", review, async (req, res) => sendSuccess(res, "Review", await reviews.get(actorOf(req), param(req, "id"))));
  r.get("/admin/reviews/:id/audio", review, async (req, res) => {
    const file = await reviews.audio(actorOf(req), param(req, "id"));
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.data);
  });
  r.post("/admin/reviews/:id", review, async (req, res) => sendSuccess(res, "Review saved", await reviews.complete(actorOf(req), param(req, "id"), instructorReviewSchema.parse(req.body))));

  return r;
}
