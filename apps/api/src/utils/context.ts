import { AsyncLocalStorage } from "node:async_hooks";

/** Follows one request or background job through every call it makes, so all of its log lines share one ID. */
type Context = { correlationId: string };

const storage = new AsyncLocalStorage<Context>();

export function withCorrelationId<T>(correlationId: string, work: () => T): T {
  return storage.run({ correlationId }, work);
}

export function currentCorrelationId() {
  return storage.getStore()?.correlationId;
}
