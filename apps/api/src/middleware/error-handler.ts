import type { ApiError, ErrorCode } from "@ieltiva/shared";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error.js";

type Normalized = { status: number; code: ErrorCode; message: string; details?: unknown };

function normalize(error: unknown): Normalized {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return { status: 400, code: "VALIDATION_ERROR", message: "Some of the information sent isn't valid.", details };
  }
  // Errors raised by Express body parsing carry a client-error type.
  const type = (error as { type?: string } | null)?.type;
  if (type === "entity.parse.failed") {
    return { status: 400, code: "VALIDATION_ERROR", message: "The request body isn't valid JSON." };
  }
  if (type === "entity.too.large") {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The request is too large." };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." };
}

/** Stack traces and internal messages go to the logs only, in every environment. */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, code, message, details } = normalize(error);
  if (status >= 500) req.log.error({ err: error }, "Request failed");

  const body: ApiError = {
    success: false,
    message,
    error: { code, ...(details === undefined ? {} : { details }), requestId: String(req.id) },
  };
  res.status(status).json(body);
};
