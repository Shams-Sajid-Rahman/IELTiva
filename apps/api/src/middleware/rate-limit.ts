import { MemoryStore, rateLimit, type ClientRateLimitInfo, type Options, type Store } from "express-rate-limit";
import type { Redis } from "ioredis";
import { FIFTEEN_MINUTES_MS } from "../config/auth.js";
import { AppError } from "../utils/app-error.js";

let sharedRedis: Redis | null = null;

/** Called once at startup. Limits then hold across every server, so running more servers doesn't multiply them. */
export function useRedisForRateLimits(client: Redis | null) {
  sharedRedis = client;
}

const INCREMENT = `local hits = redis.call('INCR', KEYS[1]); if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return { hits, redis.call('PTTL', KEYS[1]) }`;

/**
 * Counts in Redis when it's available, and in this process's memory when it isn't,
 * so a Redis outage weakens limits to per-server without removing them or stopping sign-in.
 */
class SharedStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = FIFTEEN_MINUTES_MS;
  private readonly memory = new MemoryStore();

  constructor(prefix: string) {
    this.prefix = `ieltiva:rl:${prefix}:`;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (sharedRedis?.status === "ready") {
      try {
        const [hits, ttl] = (await sharedRedis.eval(INCREMENT, 1, this.prefix + key, String(this.windowMs))) as [number, number];
        return { totalHits: hits, resetTime: new Date(Date.now() + Math.max(ttl, 0)) };
      } catch {
        // Falls through to the local count below.
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string) {
    if (sharedRedis?.status === "ready") {
      await sharedRedis.decr(this.prefix + key).catch(() => undefined);
      return;
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string) {
    if (sharedRedis?.status === "ready") {
      await sharedRedis.del(this.prefix + key).catch(() => undefined);
      return;
    }
    await this.memory.resetKey(key);
  }
}

/** The name keeps each route's count separate, and is the same on every server, so they all share one count. */
export function authRateLimit(limit: number, name: string) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new SharedStore(`auth-${name}`),
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.")),
  });
}

/** For a signed-in person's expensive or sensitive actions, counted per account, so changing network doesn't reset it. */
export function userRateLimit(name: string, windowMs: number, limit: number, message = "Too many requests. Please wait a moment.") {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new SharedStore(name),
    keyGenerator: (req) => req.auth?.userId ?? "anonymous",
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", message)),
  });
}

/** Password, email and account-level changes. */
export const sensitiveActionLimit = (name: string) => userRateLimit(`sensitive-${name}`, FIFTEEN_MINUTES_MS, 10, "Too many attempts. Please wait and try again.");

/** A broad ceiling per network address, to slow scraping and floods. It's well above what a real person or a shared campus network needs. */
export function globalRateLimit() {
  return rateLimit({
    windowMs: 60_000,
    limit: 1_200,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new SharedStore("global"),
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests. Please wait a moment.")),
  });
}
