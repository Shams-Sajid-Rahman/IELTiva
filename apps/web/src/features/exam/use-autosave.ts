"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@/lib/api-client";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "offline" | "closed";

const DEBOUNCE_MS = 1500;
const MAX_RETRY_MS = 30_000;

const readBackup = <T>(key: string): Record<string, T> => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, T>;
  } catch {
    return {};
  }
};

/**
 * Queues changes and saves them one batch at a time, waiting after each change so typing isn't sent keystroke by keystroke.
 * Unsaved work is also kept in this tab's session storage, so a reload or dropped connection doesn't lose it.
 * The server decides what's accepted. A refusal because time ran out or work was submitted stops further saving.
 */
export function useAutosave<T>({ storageKey, save, onClosed, debounceMs = DEBOUNCE_MS }: { storageKey: string; save: (changes: Record<string, T>) => Promise<unknown>; onClosed: (error: ApiRequestError) => void; debounceMs?: number }) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const pending = useRef<Record<string, T>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const retryDelay = useRef(2000);
  const closed = useRef(false);
  const saveRef = useRef(save);
  const closedRef = useRef(onClosed);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    saveRef.current = save;
    closedRef.current = onClosed;
  });

  const backup = useCallback(() => {
    try {
      if (Object.keys(pending.current).length) sessionStorage.setItem(storageKey, JSON.stringify(pending.current));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Without session storage, unsaved work simply isn't kept across a reload.
    }
  }, [storageKey]);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (closed.current) return Promise.resolve();
    if (inFlight.current) return inFlight.current.then(() => (Object.keys(pending.current).length ? flushRef.current() : undefined));
    const batch = pending.current;
    if (!Object.keys(batch).length) return Promise.resolve();
    pending.current = {};
    setStatus("saving");
    inFlight.current = saveRef.current(batch)
      .then(() => {
        retryDelay.current = 2000;
        setSavedAt(new Date());
        setStatus(Object.keys(pending.current).length ? "pending" : "saved");
        backup();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && [409, 410].includes(error.status)) {
          closed.current = true;
          setStatus("closed");
          closedRef.current(error);
          return;
        }
        // Newer changes win over the failed batch. The rest is retried with a growing delay.
        pending.current = { ...batch, ...pending.current };
        backup();
        setStatus("offline");
        timer.current = setTimeout(() => void flushRef.current(), retryDelay.current);
        retryDelay.current = Math.min(retryDelay.current * 2, MAX_RETRY_MS);
      })
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  }, [backup]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const queue = useCallback(
    (key: string, value: T) => {
      if (closed.current) return;
      pending.current = { ...pending.current, [key]: value };
      backup();
      setStatus("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), debounceMs);
    },
    [backup, debounceMs, flush],
  );

  // Picks up anything left behind by a reload, then retries as soon as the connection returns.
  useEffect(() => {
    const left = readBackup<T>(storageKey);
    if (Object.keys(left).length) {
      pending.current = { ...left, ...pending.current };
      queueMicrotask(() => setStatus("pending"));
      timer.current = setTimeout(() => void flush(), 200);
    }
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush, storageKey]);

  /** Unsaved values to show on screen after a reload, on top of what the server returned. */
  const restored = useCallback(() => readBackup<T>(storageKey), [storageKey]);

  return { status, savedAt, queue, flush, restored };
}
