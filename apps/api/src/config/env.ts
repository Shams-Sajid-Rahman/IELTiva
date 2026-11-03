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
