import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const optionalText = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
const secret = z
  .string()
  .min(32, "must be at least 32 characters")
  .refine((value) => !value.includes("CHANGE_ME"), "must be replaced with a generated secret");

const envSchema = z
  .object({
    // Required, so a forgotten setting can't silently switch a server into development behaviour.
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
    FRONTEND_URL: z.url(),
    API_BASE_URL: z.url(),
    // Which kind of server this is. Beta and production always need publication approval, and beta always needs the allow list.
    RELEASE_CHANNEL: z.enum(["development", "beta", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    JWT_ACCESS_SECRET: secret,
    CSRF_SECRET: secret,
    ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_DOMAIN: optionalText,
    COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    RESEND_API_KEY: optionalText,
    EMAIL_FROM: optionalText,
    STORAGE_LOCAL_DIR: optionalText,
    // AI features stay switched off until their keys are set.
    AI_PROVIDER: z.enum(["anthropic", "gemini"]).default("anthropic"),
    ANTHROPIC_API_KEY: optionalText,
    AI_MODEL_DEFAULT: z.string().default("claude-sonnet-5-5"),
    AI_MODEL_COMPLEX: z.string().default("claude-opus-5-5"),
    AI_MODEL_LIGHT: z.string().default("claude-haiku-5-5"),
    GEMINI_API_KEY: optionalText,
    GEMINI_MODEL_DEFAULT: z.string().default("gemini-3.6-flash"),
    GEMINI_MODEL_COMPLEX: z.string().default("gemini-3.6-flash"),
    GEMINI_MODEL_LIGHT: z.string().default("gemini-3.5-flash-lite"),
    // Say true only with paid billing on the Google project. The free plan's content may be used and read by Google.
    GEMINI_PAID_TIER: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    AI_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(1800).default(300),
    AI_ALLOWED_MODELS: optionalText,
    AI_USER_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(0).default(500_000),
    AI_DAILY_SPEND_ALERT_USD: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().min(0).optional()),
    AI_DAILY_SPEND_LIMIT_USD: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().min(0).optional()),
    REDIS_URL: optionalText,
    AZURE_SPEECH_KEY: optionalText,
    AZURE_SPEECH_REGION: optionalText,
    AZURE_SPEECH_LANGUAGE: z.string().default("en-GB"),
    // Payments run against gateway sandboxes unless live mode is explicitly allowed. Keys are never stored in the database.
    PAYMENT_ALLOW_LIVE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    SSLCOMMERZ_STORE_ID: optionalText,
    SSLCOMMERZ_STORE_PASSWORD: optionalText,
    AAMARPAY_STORE_ID: optionalText,
    AAMARPAY_SIGNATURE_KEY: optionalText,
    STRIPE_SECRET_KEY: optionalText,
    STRIPE_WEBHOOK_SECRET: optionalText,
    // Private file storage. Without these, development uses STORAGE_LOCAL_DIR and production has no file storage.
    R2_ACCOUNT_ID: optionalText,
    R2_ACCESS_KEY_ID: optionalText,
    R2_SECRET_ACCESS_KEY: optionalText,
    R2_BUCKET_USER: z.string().default("ieltiva-user"),
    R2_BUCKET_CONTENT: z.string().default("ieltiva-content"),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.CSRF_SECRET) {
      ctx.addIssue({ code: "custom", path: ["CSRF_SECRET"], message: "must differ from JWT_ACCESS_SECRET" });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "set both Google values or neither" });
    }
    if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "is required when RESEND_API_KEY is set" });
    }
    // Real students' work must not go through a plan where the provider may use it.
    if (env.RELEASE_CHANNEL !== "development" && env.AI_PROVIDER === "gemini" && !env.GEMINI_PAID_TIER) {
      ctx.addIssue({ code: "custom", path: ["GEMINI_PAID_TIER"], message: "must be true on a beta or production server, because the free plan's content may be used by Google" });
    }
    if (env.RELEASE_CHANNEL === "beta" && env.PAYMENT_ALLOW_LIVE) {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_ALLOW_LIVE"], message: "must be false on a beta server" });
    }
    const r2 = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY].filter(Boolean).length;
    if (r2 !== 0 && r2 !== 3) {
      ctx.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "set all three R2 values or none" });
    }
    if (env.NODE_ENV !== "production") return;
    for (const key of ["FRONTEND_URL", "API_BASE_URL"] as const) {
      if (!env[key].startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: [key], message: "must use https in production" });
      }
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "must be true in production" });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Lists invalid variable names and reasons, and never their values, so secrets stay out of logs. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
}

/** Real environment variables win, then .env.<NODE_ENV>, then .env. Production should set real variables. */
export function loadConfig(): Env {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const mode = process.env.NODE_ENV ?? "development";
  loadEnv({ path: [path.join(root, `.env.${mode}`), path.join(root, ".env")], quiet: true });
  return parseEnv(process.env);
}
