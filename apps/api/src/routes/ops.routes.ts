import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/authenticate.js";
import { userRateLimit } from "../middleware/rate-limit.js";
import type { ResourceFileService } from "../services/files/resource-files.service.js";
import type { OperationsService } from "../services/ops/operations.service.js";
import type { ReportService } from "../services/reports/report.service.js";
import type { Actor } from "../types/platform.js";
import { sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const uuid = z.uuid("Invalid identifier.");
const param = (req: Request, name: string) => uuid.parse(req.params[name]);

/** A short-lived link is returned as data. Without one, the file comes from here, as a download so a browser never runs it. */
function sendDownload(res: Response, result: { url: string } | { data: Buffer; contentType: string; fileName: string }) {
  if ("url" in result) {
    sendSuccess(res, "Download ready", { url: result.url });
    return;
  }
  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.send(result.data);
}

/** Status for load balancers. It says only whether the service can work, and nothing about what's inside it. */
export function createProbeRouter(operations: Pick<OperationsService, "live" | "ready">) {
  const r = Router();
  r.get("/live", (_req, res) => void res.json(operations.live()));
  r.get("/ready", async (_req, res) => {
    const state = await operations.ready();
    res.status(state.ready ? 200 : 503).json(state);
  });
  return r;
}

export function createOpsRouter({ operations, reports, resourceFiles }: { operations: OperationsService; reports: ReportService; resourceFiles: ResourceFileService }) {
  const r = Router();

  r.get("/admin/operations", requirePermission("operations.read"), async (_req, res) => sendSuccess(res, "Operations", await operations.overview()));

  r.get("/reports", async (req, res) => sendSuccess(res, "Your files", await reports.list(actorOf(req))));
  r.post("/reports", userRateLimit("reports", 60_000, 5), async (req, res) => {
    const { kind } = z.strictObject({ kind: z.literal("PROGRESS_REPORT") }).parse(req.body);
    sendSuccess(res, "File requested", await reports.request(actorOf(req), kind), 202);
  });
  r.get("/reports/:id/download", async (req, res) => sendDownload(res, await reports.download(actorOf(req), param(req, "id"))));

  r.get("/resources/:id/file", async (req, res) => sendDownload(res, await resourceFiles.open(actorOf(req), param(req, "id"))));
  r.put("/resources/:id/file", express.raw({ type: () => true, limit: "26mb" }), async (req, res) => {
    const name = z.string().trim().min(1).max(200).catch("resource").parse(req.query.name);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    sendSuccess(res, "File uploaded", await resourceFiles.upload(actorOf(req), param(req, "id"), data, name), 201);
  });
  r.delete("/resources/:id/file", async (req, res) => {
    await resourceFiles.remove(actorOf(req), param(req, "id"));
    sendSuccess(res, "File removed", null);
  });

  return r;
}
