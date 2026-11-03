import type { ApiResponse } from "@ieltiva/shared";
import type { Response } from "express";

export function sendSuccess<T>(res: Response, message: string, data: T, status = 200) {
  const body: ApiResponse<T> = { success: true, message, data };
  res.status(status).json(body);
}
