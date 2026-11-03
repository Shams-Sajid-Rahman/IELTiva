import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AiError, type AiProvider, type AiUsage, type ChatRequest, type StructuredRequest } from "./provider.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Server-side fallback isn't available on the Haiku tier, so a refusal there is handled in code. */
const supportsFallback = (modelId: string) => modelId.startsWith("claude-sonnet") || modelId.startsWith("claude-opus") || modelId.startsWith("claude-fable");

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

const toUsage = (usage: Usage): AiUsage => ({
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
});

/** The only file that knows the vendor's SDK and request shape. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // Queued jobs have their own retries, so the SDK retries only briefly.
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  private mapError(error: unknown): AiError {
    if (error instanceof AiError) return error;
    if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError("TIMEOUT", "The AI service took too long to respond.", true);
    if (error instanceof Anthropic.RateLimitError) return new AiError("RATE_LIMITED", "The AI service is busy.", true);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new AiError("NOT_CONFIGURED", "The AI service rejected its credentials.", false);
    if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return new AiError("BAD_REQUEST", "The AI service rejected the request.", false);
    if (error instanceof Anthropic.APIConnectionError) return new AiError("PROVIDER_ERROR", "The AI service couldn't be reached.", true);
    if (error instanceof Anthropic.APIError) return new AiError("PROVIDER_ERROR", "The AI service had a problem.", (error.status ?? 500) >= 500);
    return new AiError("PROVIDER_ERROR", "The AI request failed.", true);
  }

  async structured<T extends z.ZodType>(request: StructuredRequest<T>) {
    try {
      const fallback = supportsFallback(request.modelId);
      const response = await this.client.beta.messages.parse(
        {
          model: request.modelId,
          max_tokens: request.maxTokens,
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: request.user }],
          output_config: { effort: request.effort as "low" | "medium" | "high", format: betaZodOutputFormat(request.schema) },
          ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        } as never,
        { timeout: request.timeoutMs },
      ) as unknown as { stop_reason: string | null; usage: Usage; model: string; parsed_output: z.infer<T> | null };
      const usage = toUsage(response.usage);
      // The reason comes first, because refused or cut-off content can't be trusted.
      if (response.stop_reason === "refusal") throw new AiError("REFUSED", "The AI declined this request.", false, usage);
      if (response.stop_reason === "max_tokens") throw new AiError("TRUNCATED", "The AI response was cut off.", true, usage);
      if (response.parsed_output === null || response.parsed_output === undefined) throw new AiError("INVALID_OUTPUT", "The AI response wasn't in the expected format.", true, usage);
      return { data: response.parsed_output, usage, modelId: response.model };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async chat(request: ChatRequest) {
    try {
      const fallback = supportsFallback(request.modelId);
      const stream = this.client.beta.messages.stream(
        {
          model: request.modelId,
          max_tokens: request.maxTokens,
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          // Assistant turns are replayed exactly as received, because thinking blocks are bound to their conversation.
          messages: request.messages.map((message) => ({ role: message.role, content: (message.content ?? message.text) as string })),
          output_config: { effort: request.effort as "low" | "medium" | "high" },
          ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        } as never,
        { timeout: request.timeoutMs, ...(request.signal ? { signal: request.signal } : {}) },
      );
      for await (const event of stream as AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) request.onText(event.delta.text);
      }
      const message = (await stream.finalMessage()) as unknown as { stop_reason: string | null; usage: Usage; model: string; content: { type: string; text?: string }[] };
      const usage = toUsage(message.usage);
      if (message.stop_reason === "refusal") throw new AiError("REFUSED", "The AI declined this request.", false, usage);
      const text = message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
      return { text, content: message.content, usage, modelId: message.model };
    } catch (error) {
      throw this.mapError(error);
    }
  }
}
