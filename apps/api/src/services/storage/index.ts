import type { Env } from "../../config/env.js";
import { LocalPrivateStorage, UnavailableStorage, type PrivateStorage } from "./private-storage.js";
import { R2PrivateStorage } from "./r2-storage.js";

export type StorageEnv = Pick<Env, "NODE_ENV" | "STORAGE_LOCAL_DIR" | "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET_USER" | "R2_BUCKET_CONTENT">;

/** R2 when it's configured. Otherwise a local folder, for development only, so production can't silently write to a server's disk. */
export function createStorage(env: StorageEnv): PrivateStorage {
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return new R2PrivateStorage({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, buckets: { user: env.R2_BUCKET_USER, content: env.R2_BUCKET_CONTENT } });
  }
  return env.NODE_ENV !== "production" && env.STORAGE_LOCAL_DIR ? new LocalPrivateStorage(env.STORAGE_LOCAL_DIR) : new UnavailableStorage();
}

type ErrorReporter = (code: string, message: string) => void;

/** Adds error tracking around any storage. It reports the failure and rethrows it, so callers behave as they did before. */
export function withErrorTracking(storage: PrivateStorage, report: ErrorReporter): PrivateStorage {
  const track = async <T>(code: string, work: () => Promise<T>) => {
    try {
      return await work();
    } catch (error) {
      report(code, (error as { name?: string }).name ?? "StorageError");
      throw error;
    }
  };
  return {
    kind: storage.kind,
    put: (key, data, options) => track("put_failed", () => storage.put(key, data, options)),
    get: (key) => track("get_failed", () => storage.get(key)),
    delete: (key) => track("delete_failed", () => storage.delete(key)),
    ...(storage.signedDownloadUrl ? { signedDownloadUrl: (key: string, options: Parameters<NonNullable<PrivateStorage["signedDownloadUrl"]>>[1]) => track("sign_failed", () => storage.signedDownloadUrl!(key, options)) } : {}),
    ...(storage.check ? { check: () => track("check_failed", () => storage.check!()) } : {}),
  };
}
