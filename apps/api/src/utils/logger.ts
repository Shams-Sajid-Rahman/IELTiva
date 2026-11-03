import { pino } from "pino";

export function createLogger(level: string) {
  return pino({
    level,
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
  });
}

export type Logger = ReturnType<typeof createLogger>;
