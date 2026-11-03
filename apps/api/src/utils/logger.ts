import { pino, type DestinationStream } from "pino";
import { currentCorrelationId } from "./context.js";

export function createLogger(level: string, destination?: DestinationStream) {
  return pino(
    {
      level,
      // Every line written during a request or job carries its ID, without each caller having to pass it.
      mixin: () => {
        const correlationId = currentCorrelationId();
        return correlationId ? { correlationId } : {};
      },
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
