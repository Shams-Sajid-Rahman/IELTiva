import type { ApiResponse, PaginationMeta } from "@ieltiva/shared";
import type { Response } from "express";

export function sendSuccess<T>(res: Response, message: string, data: T, status = 200) {
  const body: ApiResponse<T> = { success: true, message, data };
  res.status(status).json(body);
}

export function sendPage<T>(res: Response, message: string, page: { items: T[]; meta: PaginationMeta }) {
  const body: ApiResponse<T[]> = { success: true, message, data: page.items, meta: page.meta };
  res.json(body);
}

export function pageMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
