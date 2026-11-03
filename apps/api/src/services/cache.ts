/**
 * A small cache for expensive reads.
 *
 * Keys start with a scope, and the scope decides who may share an entry:
 *   public:   the same for everyone, so a shared store is fine
 *   admin:    platform totals with no student's details, and only served behind a permission check
 *   private:  one student's data. The user ID must be in the key, and it only ever lives in this process's memory
 */
export type CacheScope = "public" | "admin" | "private";

export type Cache = {
  getOrSet: <T>(scope: CacheScope, key: string, ttlSeconds: number, load: () => Promise<T>) => Promise<T>;
  /** Removes entries starting with this key, for example after someone changes their goals. */
  invalidate: (scope: CacheScope, prefix: string) => Promise<void>;
  stats: () => { entries: number; hits: number; misses: number; sharedAvailable: boolean };
};

/** The optional shared store (Redis). It's only ever given public and admin entries. */
export type SharedStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  deletePrefix: (prefix: string) => Promise<void>;
};

const DEFAULT_MAX_ENTRIES = 2_000;

export function createCache({ shared, maxEntries = DEFAULT_MAX_ENTRIES }: { shared?: SharedStore | null; maxEntries?: number } = {}): Cache {
  const memory = new Map<string, { value: unknown; expires: number }>();
  const loading = new Map<string, Promise<unknown>>();
  let hits = 0;
  let misses = 0;

  const usesShared = (scope: CacheScope) => scope !== "private" && Boolean(shared);

  function remember(fullKey: string, value: unknown, ttlSeconds: number) {
    if (maxEntries <= 0) return;
    // The oldest entry goes first, so a burst of keys can't grow memory without limit.
    if (memory.size >= maxEntries) {
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(fullKey, { value, expires: Date.now() + ttlSeconds * 1000 });
  }

  return {
    async getOrSet<T>(scope: CacheScope, key: string, ttlSeconds: number, load: () => Promise<T>) {
      const fullKey = `${scope}:${key}`;
      const entry = memory.get(fullKey);
      if (entry && entry.expires > Date.now()) {
        hits += 1;
        return entry.value as T;
      }
      if (entry) memory.delete(fullKey);

      // Requests arriving together share one database read rather than each running it.
      const running = loading.get(fullKey);
      if (running) return running as Promise<T>;

      const work = (async () => {
        if (usesShared(scope)) {
          // A cache outage must never break the page, so any failure here just falls through to the database.
          const stored = await shared!.get(fullKey).catch(() => null);
          if (stored !== null) {
            hits += 1;
            const value = JSON.parse(stored) as T;
            remember(fullKey, value, Math.min(ttlSeconds, 30));
            return value;
          }
        }
        misses += 1;
        const value = await load();
        remember(fullKey, value, ttlSeconds);
        if (usesShared(scope)) await shared!.set(fullKey, JSON.stringify(value), ttlSeconds).catch(() => undefined);
        return value;
      })();
      loading.set(fullKey, work);
      try {
        return await work;
      } finally {
        loading.delete(fullKey);
      }
    },

    async invalidate(scope, prefix) {
      const fullPrefix = `${scope}:${prefix}`;
      for (const key of memory.keys()) if (key.startsWith(fullPrefix)) memory.delete(key);
      if (usesShared(scope)) await shared!.deletePrefix(fullPrefix).catch(() => undefined);
    },

    stats: () => ({ entries: memory.size, hits, misses, sharedAvailable: Boolean(shared) }),
  };
}
