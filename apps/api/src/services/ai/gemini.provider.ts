import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AiError, type AiProvider, type AiUsage, type ChatMessage, type ChatRequest, type StructuredRequest } from "./provider.js";

type Usage = { total_input_tokens?: number | undefined; total_cached_tokens?: number | undefined; total_output_tokens?: number | undefined; total_thought_tokens?: number | undefined } | undefined;

const toUsage = (usage: Usage): AiUsage => {
  const cached = usage?.total_cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (usage?.total_input_tokens ?? 0) - cached),
    // Thinking counts as output, because it uses up the same allowance.
    outputTokens: (usage?.total_output_tokens ?? 0) + (usage?.total_thought_tokens ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
};

/** The lighter models may not take a thinking setting, so it's only sent to the full ones. */
const thinkingFor = (modelId: string, effort: string) => (modelId.includes("lite") ? {} : { thinking_level: (effort === "high" ? "high" : "low") as "high" | "low" });

/** IELTiva keeps its own history, so nothing needs storing on Google's side between turns. */
function toSteps(messages: ChatMessage[]) {
  return messages.map((message) => {
    // A student turn's saved form has personal details removed and any exam context added, so it's what gets sent.
    // An assistant turn may hold another provider's block format, and only its plain text carries across.
    const text = message.role === "user" && typeof message.content === "string" ? message.content : message.text;
    return { type: message.role === "user" ? ("user_input" as const) : ("model_output" as const), content: [{ type: "text" as const, text }] };
  });
}

/** The only file that knows Google's SDK and request shape. It uses the Interactions API, with storage switched off. */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private mapError(error: unknown): AiError {
    if (error instanceof AiError) return error;
    if (error instanceof z.ZodError || error instanceof SyntaxError) return new AiError("INVALID_OUTPUT", "The AI response wasn't in the expected format.", true);
    // The SDK uses different error classes for its older and newer APIs, and both carry the HTTP status.
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status === "number") {
      // 429 is the free plan's limit, and 503 is Google being overloaded. Both pass, so students are told it's busy.
      if (status === 429 || status === 503) return new AiError("RATE_LIMITED", "The AI service is busy.", true);
      if (status === 401 || status === 403) return new AiError("NOT_CONFIGURED", "The AI service rejected its credentials.", false);
      if (status === 400 || status === 404) return new AiError("BAD_REQUEST", "The AI service rejected the request.", false);
      return new AiError("PROVIDER_ERROR", "The AI service had a problem.", status >= 500);
    }
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || error.name === "APIConnectionTimeoutError")) return new AiError("TIMEOUT", "The AI service took too long to respond.", true);
    return new AiError("PROVIDER_ERROR", "The AI request failed.", true);
  }

  async structured<T extends z.ZodType>(request: StructuredRequest<T>) {
    try {
      const schema = z.toJSONSchema(request.schema) as Record<string, unknown>;
      delete schema.$schema;
      const interaction = await this.client.interactions.create(
        {
          model: request.modelId,
          input: request.user,
          system_instruction: request.system,
          store: false,
          generation_config: { max_output_tokens: request.maxTokens, ...thinkingFor(request.modelId, request.effort) },
          response_format: { type: "text", mime_type: "application/json", schema },
        },
        { timeout: request.timeoutMs },
      );
      const usage = toUsage(interaction.usage);
      if (interaction.status === "incomplete") throw new AiError("TRUNCATED", "The AI response was cut off.", true, usage);
      if (interaction.status !== "completed") throw new AiError("PROVIDER_ERROR", "The AI service didn't finish.", true, usage);
      // A blocked reply comes back with no text. Trying again won't change that.
      if (!interaction.output_text) throw new AiError("REFUSED", "The AI declined this request.", false, usage);
      // The API doesn't enforce every rule in a schema, so the reply is always checked here too.
      const data = request.schema.parse(JSON.parse(interaction.output_text)) as z.infer<T>;
      return { data, usage, modelId: request.modelId };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async chat(request: ChatRequest) {
    try {
      const stream = await this.client.interactions.create(
        {
          model: request.modelId,
          input: toSteps(request.messages),
          system_instruction: request.system,
          store: false,
          stream: true,
          generation_config: { max_output_tokens: request.maxTokens, ...thinkingFor(request.modelId, request.effort) },
        },
        { timeout: request.timeoutMs, ...(request.signal ? { signal: request.signal } : {}) },
      );
      let text = "";
      let usage = toUsage(undefined);
      let finished = false;
      for await (const event of stream) {
        if (event.event_type === "step.delta" && event.delta.type === "text") {
          text += event.delta.text;
          request.onText(event.delta.text);
        } else if (event.event_type === "interaction.completed") {
          usage = toUsage(event.interaction.usage);
          finished = event.interaction.status !== "requires_continuation";
        } else if (event.event_type === "error") {
          throw new AiError("PROVIDER_ERROR", "The AI service had a problem.", true, usage);
        }
      }
      if (!finished) throw new AiError("PROVIDER_ERROR", "The AI reply stopped early.", true, usage);
      if (!text) throw new AiError("REFUSED", "The AI declined this request.", false, usage);
      return { text, content: text, usage, modelId: request.modelId };
    } catch (error) {
      throw this.mapError(error);
    }
  }
}
