import { adminAnalyticsQuerySchema, analyticsHistoryQuerySchema, analyticsRangeSchema, learningGoalsSchema, studyPlanApplySchema, studyPlanQuerySchema } from "@ieltiva/shared";
import { Router, type Request } from "express";
import { requirePermission } from "../middleware/authenticate.js";
import { userRateLimit } from "../middleware/rate-limit.js";
import type { AdminAnalyticsService } from "../services/analytics/admin.service.js";
import type { LearningService } from "../services/analytics/learning.service.js";
import type { StudentAnalyticsService } from "../services/analytics/student.service.js";
import type { ReleaseService } from "../services/release/release.service.js";
import { requireFlag } from "./release.routes.js";
import { toAppError } from "../services/ai/tutor.service.js";
import type { Actor } from "../types/platform.js";
import { sendPage, sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const explainLimit = userRateLimit("recommendations-explain", 60_000, 5, "Please wait a moment before asking again.");

export type AnalyticsServices = { student: StudentAnalyticsService; learning: LearningService; admin: AdminAnalyticsService };

/** Every student route reads the signed-in student's own data. No route takes a user ID, so one student can't ask for another's. */
export function createAnalyticsRouter({ student, learning, admin }: AnalyticsServices, release: Pick<ReleaseService, "isEnabled">) {
  const r = Router();
  const explainOn = requireFlag(release, "ai.recommendation_explanations", "AI explanations are paused right now.");
  const staff = requirePermission("dashboard.admin");

  r.get("/analytics/me", async (req, res) => sendSuccess(res, "Analytics", await student.overview(actorOf(req), analyticsRangeSchema.parse(req.query).days)));
  r.get("/analytics/me/history", async (req, res) => sendPage(res, "Test history", await student.history(actorOf(req), analyticsHistoryQuerySchema.parse(req.query))));
  r.get("/analytics/goals", async (req, res) => sendSuccess(res, "Goals", await learning.goals(actorOf(req))));
  r.put("/analytics/goals", async (req, res) => sendSuccess(res, "Goals saved", await learning.setGoals(actorOf(req), learningGoalsSchema.parse(req.body))));
  r.get("/analytics/recommendations", async (req, res) => sendSuccess(res, "Recommendations", await learning.recommendations(actorOf(req))));
  r.post("/analytics/recommendations/explain", explainOn, explainLimit, async (req, res) => {
    try {
      sendSuccess(res, "Explanation", await learning.explain(actorOf(req)));
    } catch (error) {
      throw toAppError(error);
    }
  });
  r.get("/analytics/study-plan", async (req, res) => sendSuccess(res, "Suggested plan", await learning.suggestPlan(actorOf(req), studyPlanQuerySchema.parse(req.query).days)));
  r.post("/analytics/study-plan/apply", async (req, res) => sendSuccess(res, "Plan added", await learning.applyPlan(actorOf(req), studyPlanApplySchema.parse(req.body ?? {}).days), 201));

  r.get("/admin/analytics", staff, async (req, res) => {
    const { days } = adminAnalyticsQuerySchema.parse(req.query);
    const overview = await admin.overview(days);
    // Revenue is only added for staff who are allowed to see payments.
    const revenue = req.auth?.permissions.includes("payments.read") ? await admin.revenue(days) : null;
    sendSuccess(res, "Platform analytics", { ...overview, revenue });
  });

  return r;
}
