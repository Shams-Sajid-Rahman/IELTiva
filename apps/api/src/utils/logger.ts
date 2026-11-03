import { pino, type DestinationStream } from "pino";

export function createLogger(level: string, destination?: DestinationStream) {
  return pino(
    {
      level,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
      ],
    },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;
