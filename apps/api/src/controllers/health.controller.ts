import type { RequestHandler } from "express";
import { getHealth } from "../services/health.service.js";
import type { DatabaseCheck } from "../types/app.js";
import { sendSuccess } from "../utils/api-response.js";

export function createHealthController(checkDatabase: DatabaseCheck, environment: string): RequestHandler {
  return async (req, res) => {
    const data = await getHealth(checkDatabase, environment);
    if (data.status === "healthy") {
      sendSuccess(res, "IELTiva API is running", data);
      return;
    }
    req.log.error("Health check failed: database unavailable");
    res.status(503).json({ success: false, message: "IELTiva API is unhealthy", data });
  };
}
