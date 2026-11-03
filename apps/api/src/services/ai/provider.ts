import type { z } from "zod";

export type AiUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type StructuredRequest<T extends z.ZodType> = {
  modelId: string;
  effort: string;
  /** Frozen instructions, kept first so they can be cached. Never contains student text. */
  system: string;
  /** Delimited, untrusted content. */
  user: string;
  schema: T;
  maxTokens: number;
  timeoutMs: number;
};

export type ChatMessage = { role: "user" | "assistant"; text: string; content?: unknown };

export type ChatRequest = {
  modelId: string;
  effort: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  onText: (text: string) => void;
};

/** Every failure a feature needs to tell apart. `retryable` decides whether a queued job tries again. */
export class AiError extends Error {
  constructor(
    readonly code: "NOT_CONFIGURED" | "REFUSED" | "TRUNCATED" | "INVALID_OUTPUT" | "RATE_LIMITED" | "TIMEOUT" | "PROVIDER_ERROR" | "BAD_REQUEST",
    message: string,
    readonly retryable: boolean,
    readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Features depend on this and never on a vendor SDK, so another provider needs only a new implementation. */
export interface AiProvider {
  readonly name: string;
  structured<T extends z.ZodType>(request: StructuredRequest<T>): Promise<{ data: z.infer<T>; usage: AiUsage; modelId: string }>;
  chat(request: ChatRequest): Promise<{ text: string; content: unknown; usage: AiUsage; modelId: string }>;
}

/** Reference prices in microdollars per million tokens, dated 2026-10-06. A row in ai_model_configurations overrides them. */
const REFERENCE_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4_000_000, output: 20_000_000 },
  "claude-sonnet-5-5": { input: 2_000_000, output: 10_000_000 },
  "claude-haiku-5-5": { input: 100_000, output: 500_000 },
};

export function costMicrousd(usage: AiUsage, modelId: string, override?: { input: bigint | null; output: bigint | null }) {
  const reference = REFERENCE_PRICES[modelId];
  const input = override?.input != null ? Number(override.input) : reference?.input;
  const output = override?.output != null ? Number(override.output) : reference?.output;
  if (input === undefined || output === undefined) return null;
  // Cache reads cost about a tenth of normal input, and writes about a quarter more.
  const inputCost = usage.inputTokens * input + usage.cacheReadTokens * input * 0.1 + usage.cacheWriteTokens * input * 1.25;
  return BigInt(Math.round((inputCost + usage.outputTokens * output) / 1_000_000));
}
