import type { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AITier } from "../../generated/prisma/enums.js";
import type { Logger } from "../../utils/logger.js";
import { PROMPTS, type PromptKey } from "./prompts.js";
import { AiError, costMicrousd, type AiProvider, type AiUsage, type ChatMessage } from "./provider.js";

export type AiSettings = {
  provider: string;
  models: { DEFAULT: string; COMPLEX: string; LIGHT: string };
  timeoutMs: number;
  dailySpendAlertUsd: number | null;
  dailySpendLimitUsd: number | null;
  /** One student's daily ceiling, so a single account can't use up the whole budget. */
  userDailyTokenLimit?: number | null;
};

/** Feature code asks for a task, and this table decides how it runs. No feature names a model. */
export const TASKS = {
  "writing.assess": { tier: AITier.DEFAULT, effort: "high", prompt: "writing.assess", maxTokens: 16_000 },
  "writing.assess_complex": { tier: AITier.COMPLEX, effort: "high", prompt: "writing.assess", maxTokens: 16_000 },
  "speaking.assess": { tier: AITier.DEFAULT, effort: "high", prompt: "speaking.assess", maxTokens: 16_000 },
  "speaking.assess_complex": { tier: AITier.COMPLEX, effort: "high", prompt: "speaking.assess", maxTokens: 16_000 },
  "calibration.compare": { tier: AITier.COMPLEX, effort: "high", prompt: "writing.assess", maxTokens: 16_000 },
  "tutor.chat": { tier: AITier.DEFAULT, effort: "low", prompt: "tutor.chat", maxTokens: 8_000 },
  "tutor.title": { tier: AITier.LIGHT, effort: "low", prompt: "tutor.title", maxTokens: 256 },
  "explain.light": { tier: AITier.LIGHT, effort: "low", prompt: "explain.light", maxTokens: 2_000 },
  "recommendations.explain": { tier: AITier.LIGHT, effort: "low", prompt: "recommendations.explain", maxTokens: 1_000 },
} as const satisfies Record<string, { tier: AITier; effort: string; prompt: PromptKey; maxTokens: number }>;

export type TaskKey = keyof typeof TASKS;

const DAY_MS = 86_400_000;

export function createAiService({ prisma, provider, settings, logger }: { prisma: PrismaClient; provider: AiProvider | null; settings: AiSettings; logger: Pick<Logger, "warn" | "error"> }) {
  let lastAlertDay = "";

  const requireProvider = () => {
    if (!provider) throw new AiError("NOT_CONFIGURED", "The AI service isn't configured.", false);
    return provider;
  };

  /** An active row chooses the model for a task. Otherwise the tier's configured model applies, recorded so results can point to it. */
  async function resolveModel(taskKey: TaskKey) {
    const active = await prisma.aIModelConfiguration.findFirst({ where: { taskKey, isActive: true }, orderBy: { updatedAt: "desc" } });
    if (active) return active;
    const task = TASKS[taskKey];
    const modelId = settings.models[task.tier];
    return prisma.aIModelConfiguration.upsert({
      where: { taskKey_provider_modelId: { taskKey, provider: settings.provider, modelId } },
      create: { taskKey, provider: settings.provider, modelId, tier: task.tier, effort: task.effort },
      update: {},
    });
  }

  /** Stores each prompt version once, so every result can point to the exact text that produced it. */
  async function resolvePrompt(key: PromptKey) {
    const prompt = PROMPTS[key];
    const row = await prisma.aIPromptVersion.upsert({
      where: { taskKey_version: { taskKey: key, version: prompt.version } },
      create: { taskKey: key, version: prompt.version, rubricVersion: prompt.rubricVersion, content: prompt.content, isActive: true },
      update: {},
    });
    return row;
  }

  async function spentToday() {
    const since = new Date(Date.now() - (Date.now() % DAY_MS));
    const sum = await prisma.aIUsageLog.aggregate({ where: { createdAt: { gte: since } }, _sum: { costMicrousd: true } });
    return Number(sum._sum.costMicrousd ?? 0n) / 1_000_000;
  }

  /** Stops new work past the hard limit, so a fault can't run up an unbounded bill. */
  async function checkBudget() {
    const spent = await spentToday();
    if (settings.dailySpendLimitUsd !== null && spent >= settings.dailySpendLimitUsd) throw new AiError("RATE_LIMITED", "The daily AI budget has been reached.", false);
    const day = new Date().toISOString().slice(0, 10);
    if (settings.dailySpendAlertUsd !== null && spent >= settings.dailySpendAlertUsd && lastAlertDay !== day) {
      lastAlertDay = day;
      logger.warn({ spentUsd: spent, alertUsd: settings.dailySpendAlertUsd }, "Daily AI spend alert");
    }
  }

  async function checkUserBudget(userId: string | null | undefined) {
    if (!userId || !settings.userDailyTokenLimit) return;
    const used = await prisma.aIUsageLog.aggregate({ where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } }, _sum: { inputTokens: true, outputTokens: true } });
    if ((used._sum.inputTokens ?? 0) + (used._sum.outputTokens ?? 0) >= settings.userDailyTokenLimit) throw new AiError("RATE_LIMITED", "You've reached today's AI limit. Please try again tomorrow.", false);
  }

  async function logUsage(data: { userId?: string | null | undefined; jobId?: string | null | undefined; taskKey: string; modelId: string; configuration: { id: string; inputMicrousdPerMtok: bigint | null; outputMicrousdPerMtok: bigint | null }; usage: AiUsage | undefined; latencyMs: number; outcome: string }) {
    const usage = data.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    try {
      await prisma.aIUsageLog.create({
        data: {
          userId: data.userId ?? null,
          jobId: data.jobId ?? null,
          modelConfigurationId: data.configuration.id,
          taskKey: data.taskKey,
          provider: requireProvider().name,
          modelId: data.modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costMicrousd: costMicrousd(usage, data.modelId, { input: data.configuration.inputMicrousdPerMtok, output: data.configuration.outputMicrousdPerMtok }),
          latencyMs: data.latencyMs,
          outcome: data.outcome,
        },
      });
    } catch (error) {
      // A logging failure mustn't lose work that's already paid for.
      logger.error({ err: error }, "Could not record AI usage");
    }
  }

  return {
    isConfigured: () => provider !== null,
    resolveModel,
    resolvePrompt,

    /** Runs a task that returns validated JSON, and records tokens, cost and outcome even when it fails. */
    async structured<T extends z.ZodType>(taskKey: TaskKey, user: string, schema: T, context: { userId?: string | null | undefined; jobId?: string | null | undefined }) {
      const active = requireProvider();
      await checkBudget();
      await checkUserBudget(context.userId);
      const task = TASKS[taskKey];
      const [configuration, prompt] = await Promise.all([resolveModel(taskKey), resolvePrompt(task.prompt)]);
      const started = Date.now();
      try {
        const result = await active.structured({ modelId: configuration.modelId, effort: configuration.effort ?? task.effort, system: prompt.content, user, schema, maxTokens: task.maxTokens, timeoutMs: settings.timeoutMs });
        await logUsage({ ...context, taskKey, modelId: result.modelId, configuration, usage: result.usage, latencyMs: Date.now() - started, outcome: "success" });
        return { data: result.data, configuration, prompt, modelId: result.modelId };
      } catch (error) {
        const failure = error instanceof AiError ? error : new AiError("PROVIDER_ERROR", "The AI request failed.", true);
        await logUsage({ ...context, taskKey, modelId: configuration.modelId, configuration, usage: failure.usage, latencyMs: Date.now() - started, outcome: failure.code });
        throw failure;
      }
    },

    async chat(taskKey: TaskKey, messages: ChatMessage[], context: { userId: string; signal?: AbortSignal | undefined; onText: (text: string) => void }) {
      const active = requireProvider();
      await checkBudget();
      await checkUserBudget(context.userId);
      const task = TASKS[taskKey];
      const [configuration, prompt] = await Promise.all([resolveModel(taskKey), resolvePrompt(task.prompt)]);
      const started = Date.now();
      try {
        const result = await active.chat({ modelId: configuration.modelId, effort: configuration.effort ?? task.effort, system: prompt.content, messages, maxTokens: task.maxTokens, timeoutMs: settings.timeoutMs, signal: context.signal, onText: context.onText });
        await logUsage({ userId: context.userId, taskKey, modelId: result.modelId, configuration, usage: result.usage, latencyMs: Date.now() - started, outcome: "success" });
        return result;
      } catch (error) {
        const failure = error instanceof AiError ? error : new AiError("PROVIDER_ERROR", "The AI request failed.", true);
        await logUsage({ userId: context.userId, taskKey, modelId: configuration.modelId, configuration, usage: failure.usage, latencyMs: Date.now() - started, outcome: failure.code });
        throw failure;
      }
    },

    /** Figures for the usage dashboard, from recorded usage. */
    async usageSummary(query: { from: Date; to: Date }) {
      const where: Prisma.AIUsageLogWhereInput = { createdAt: { gte: query.from, lte: query.to } };
      const [byTask, byModel, totals, failures] = await Promise.all([
        prisma.aIUsageLog.groupBy({ by: ["taskKey"], where, _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costMicrousd: true }, _count: { _all: true } }),
        prisma.aIUsageLog.groupBy({ by: ["modelId"], where, _sum: { inputTokens: true, outputTokens: true, costMicrousd: true }, _count: { _all: true } }),
        prisma.aIUsageLog.aggregate({ where, _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costMicrousd: true }, _count: { _all: true } }),
        prisma.aIUsageLog.count({ where: { ...where, outcome: { not: "success" } } }),
      ]);
      const usd = (value: bigint | null | undefined) => Number(value ?? 0n) / 1_000_000;
      return {
        configured: provider !== null,
        requests: totals._count._all,
        failures,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        cacheReadTokens: totals._sum.cacheReadTokens ?? 0,
        costUsd: usd(totals._sum.costMicrousd),
        spentTodayUsd: await spentToday(),
        byTask: byTask.map((row) => ({ taskKey: row.taskKey, requests: row._count._all, inputTokens: row._sum.inputTokens ?? 0, outputTokens: row._sum.outputTokens ?? 0, costUsd: usd(row._sum.costMicrousd) })),
        byModel: byModel.map((row) => ({ modelId: row.modelId, requests: row._count._all, costUsd: usd(row._sum.costMicrousd) })),
      };
    },
  };
}

export type AiService = ReturnType<typeof createAiService>;
