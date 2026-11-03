"use client";

import type { PaginationMeta } from "@ieltiva/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { api, ApiRequestError } from "@/lib/api-client";

export function useApiQuery<T>(path: string, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: [path], queryFn: () => api.get<T>(path), ...options });
}

export function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function useApiPage<T>(path: string, params: Record<string, string | number | undefined>) {
  const url = `${path}${buildQuery(params)}`;
  return useQuery<{ items: T[]; meta: PaginationMeta }>({
    queryKey: [url],
    queryFn: () => api.getPage<T>(url),
    placeholderData: keepPreviousData,
  });
}

/** Runs a change, refreshes every view that might show it, and reports the result. */
export function useApiAction<TInput = void, TResult = unknown>(action: (input: TInput) => Promise<TResult>, success?: string) {
  const client = useQueryClient();
  const t = useTranslations("app");
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await client.invalidateQueries();
      if (success) toast.success(success);
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : t("something_went_wrong_please_try_again"));
    },
  });
}

/** Shows field errors from the API next to the matching fields. */
export function applyFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>) {
  if (error instanceof ApiRequestError) {
    for (const { path, message } of error.fieldErrors) setError(path as FieldPath<T>, { message });
  }
}

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}
