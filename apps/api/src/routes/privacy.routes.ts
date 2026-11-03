import { accountDeletionSchema } from "@ieltiva/shared";
import { Router, type Request } from "express";
import { sensitiveActionLimit } from "../middleware/rate-limit.js";
import type { PrivacyService } from "../services/privacy/privacy.service.js";
import type { ReportService } from "../services/reports/report.service.js";
import type { Actor } from "../types/platform.js";
import { sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

/** Every route here works on the signed-in person only. */
export function createPrivacyRouter({ privacy, reports }: { privacy: PrivacyService; reports: ReportService }) {
  const r = Router();
  const limit = sensitiveActionLimit("privacy");

  r.get("/privacy", async (req, res) => sendSuccess(res, "Privacy", await privacy.summary(actorOf(req))));
  r.post("/privacy/export", limit, async (req, res) => sendSuccess(res, "Export requested", await reports.request(actorOf(req), "DATA_EXPORT"), 202));
  r.post("/privacy/deletion", limit, async (req, res) => sendSuccess(res, "Deletion scheduled", await privacy.requestDeletion(actorOf(req), accountDeletionSchema.parse(req.body))));
  r.delete("/privacy/deletion", async (req, res) => {
    await privacy.cancelDeletion(actorOf(req));
    sendSuccess(res, "Deletion cancelled", null);
  });
  return r;
}
