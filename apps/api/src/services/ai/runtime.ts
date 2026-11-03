import type { Env } from "../../config/env.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import type { Logger } from "../../utils/logger.js";
import { recordAudit } from "../audit.service.js";
import type { PrivateStorage } from "../storage/private-storage.js";
import { createAiService, TASKS, type TaskKey } from "./ai.service.js";
import { AnthropicProvider } from "./anthropic.provider.js";
import { createEntitlementService } from "../billing/entitlement.service.js";
import { CONSENT_VERSION, createAssessmentService, type AssessmentCredits } from "./assessment.service.js";
import { createCalibrationService } from "./calibration.service.js";
import type { AiProvider } from "./provider.js";
import { createAiQueue, type AiQueue } from "./queue.js";
import { AzureSpeechProvider, type SpeechProvider } from "./speech.provider.js";
import { createTutorService } from "./tutor.service.js";

export type AiEnv = Pick<Env, "AI_PROVIDER" | "ANTHROPIC_API_KEY" | "AI_MODEL_DEFAULT" | "AI_MODEL_COMPLEX" | "AI_MODEL_LIGHT" | "AI_TIMEOUT_SECONDS" | "AI_DAILY_SPEND_ALERT_USD" | "AI_DAILY_SPEND_LIMIT_USD" | "REDIS_URL" | "AZURE_SPEECH_KEY" | "AZURE_SPEECH_REGION" | "AZURE_SPEECH_LANGUAGE" | "AI_ALLOWED_MODELS" | "AI_USER_DAILY_TOKEN_LIMIT">;

function chooseProvider(env: AiEnv): AiProvider | null {
  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY);
  return null;
}

const chooseSpeech = (env: AiEnv): SpeechProvider | null => (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION ? new AzureSpeechProvider(env.AZURE_SPEECH_KEY, env.AZURE_SPEECH_REGION, env.AZURE_SPEECH_LANGUAGE) : null);

/** Builds everything AI features use. Missing keys leave features switched off with a clear message, not a crash. */
export function createAiRuntime({ prisma, env, storage, logger, queue }: { prisma: PrismaClient; env: AiEnv; storage: PrivateStorage; logger: Pick<Logger, "warn" | "error">; queue?: AiQueue | null }) {
  const ai = createAiService({
    prisma,
    provider: chooseProvider(env),
    logger,
    settings: {
      provider: env.AI_PROVIDER,
      models: { DEFAULT: env.AI_MODEL_DEFAULT, COMPLEX: env.AI_MODEL_COMPLEX, LIGHT: env.AI_MODEL_LIGHT },
      timeoutMs: env.AI_TIMEOUT_SECONDS * 1000,
      dailySpendAlertUsd: env.AI_DAILY_SPEND_ALERT_USD ?? null,
      dailySpendLimitUsd: env.AI_DAILY_SPEND_LIMIT_USD ?? null,
      userDailyTokenLimit: env.AI_USER_DAILY_TOKEN_LIMIT,
    },
  });
  const activeQueue = queue === undefined ? createAiQueue(env.REDIS_URL, logger) : queue;
  const speech = chooseSpeech(env);
  const entitlements = createEntitlementService(prisma);
  let enforcedUntil = 0;
  let enforcedValue = false;
  const credits: AssessmentCredits = {
    // The switch is read from platform settings and remembered briefly, so a busy server doesn't ask on every request.
    enforced: async () => {
      if (Date.now() > enforcedUntil) {
        enforcedValue = (await prisma.platformSetting.findUnique({ where: { key: "billing.enforce_credits" } }))?.value === true;
        enforcedUntil = Date.now() + 30_000;
      }
      return enforcedValue;
    },
    consume: (userId, featureKey, ref) => entitlements.consume(prisma, userId, [featureKey], ref, "ai_assessment"),
    release: (userId, ref) => entitlements.release(prisma, userId, ref),
  };
  const assessment = createAssessmentService({ prisma, ai, queue: activeQueue, speech, storage, credits });
  const tutor = createTutorService(prisma, ai);
  const calibration = createCalibrationService({ prisma, ai, queue: activeQueue });

  const consents = {
    version: CONSENT_VERSION,
    async list(actor: Actor) {
      const rows = await prisma.userConsent.findMany({ where: { userId: actor.userId }, select: { type: true, version: true, grantedAt: true, revokedAt: true } });
      const retention = await prisma.platformSetting.findUnique({ where: { key: "retention.speaking_recordings_days" } });
      return { version: CONSENT_VERSION, consents: rows, recordingRetentionDays: Number(retention?.value ?? 90), aiAvailable: ai.isConfigured() && activeQueue !== null, tutorAvailable: ai.isConfigured(), speechAvailable: ai.isConfigured() && activeQueue !== null && speech !== null };
    },
    /** Recorded with its version, so a later change of wording needs a fresh choice. Withdrawing speech consent deletes recordings. */
    async set(actor: Actor, type: "AI_PROCESSING" | "SPEECH_PROCESSING" | "CALIBRATION_USE", granted: boolean) {
      const now = new Date();
      const row = await prisma.userConsent.upsert({
        where: { userId_type: { userId: actor.userId, type } },
        create: { userId: actor.userId, type, version: CONSENT_VERSION, grantedAt: now, revokedAt: granted ? null : now },
        update: granted ? { version: CONSENT_VERSION, grantedAt: now, revokedAt: null } : { revokedAt: now },
      });
      await recordAudit(prisma, actor, { action: granted ? "consent.grant" : "consent.withdraw", entityType: "user_consent", entityId: row.id, after: { type, version: CONSENT_VERSION } });
      const deleted = !granted && type === "SPEECH_PROCESSING" ? await assessment.deleteAllRecordings(actor) : 0;
      return { type, granted, version: CONSENT_VERSION, recordingsDeleted: deleted };
    },
  };

  /** Admin control of which model serves a task. Band releases are tied to a configuration, so a change closes the gate by itself. */
  const models = {
    async list() {
      const rows = await prisma.aIModelConfiguration.findMany({ orderBy: [{ taskKey: "asc" }, { modelId: "asc" }] });
      return {
        tasks: Object.entries(TASKS).map(([taskKey, task]) => ({ taskKey, tier: task.tier, defaultModel: { DEFAULT: env.AI_MODEL_DEFAULT, COMPLEX: env.AI_MODEL_COMPLEX, LIGHT: env.AI_MODEL_LIGHT }[task.tier] })),
        configurations: rows.map((row) => ({ id: row.id, taskKey: row.taskKey, provider: row.provider, modelId: row.modelId, tier: row.tier, effort: row.effort, isActive: row.isActive })),
      };
    },
    async setForTask(actor: Actor, taskKey: string, modelId: string) {
      if (!(taskKey in TASKS)) throw new AppError(404, "NOT_FOUND", "This task doesn't exist.");
      // Only approved models can be chosen, so a typed value can't move a task onto an unexpected or much more expensive model.
      const allowed = env.AI_ALLOWED_MODELS ? env.AI_ALLOWED_MODELS.split(",").map((value) => value.trim()) : [env.AI_MODEL_DEFAULT, env.AI_MODEL_COMPLEX, env.AI_MODEL_LIGHT];
      if (!allowed.includes(modelId)) throw new AppError(400, "VALIDATION_ERROR", "This model isn't on the approved list.");
      const task = TASKS[taskKey as TaskKey];
      const row = await prisma.$transaction(async (tx) => {
        await tx.aIModelConfiguration.updateMany({ where: { taskKey }, data: { isActive: false } });
        return tx.aIModelConfiguration.upsert({
          where: { taskKey_provider_modelId: { taskKey, provider: env.AI_PROVIDER, modelId } },
          create: { taskKey, provider: env.AI_PROVIDER, modelId, tier: task.tier, effort: task.effort, isActive: true },
          update: { isActive: true },
        });
      });
      await recordAudit(prisma, actor, { action: "ai.model_set", entityType: "ai_model_configuration", entityId: row.id, after: { taskKey, modelId } });
      return row;
    },
  };

  return { ai, assessment, tutor, calibration, consents, models, queue: activeQueue };
}

export type AiRuntime = ReturnType<typeof createAiRuntime>;
