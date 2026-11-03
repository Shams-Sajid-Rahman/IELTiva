import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
    FRONTEND_URL: z.url(),
    API_BASE_URL: z.url(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    for (const key of ["FRONTEND_URL", "API_BASE_URL"] as const) {
      if (!env[key].startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: [key], message: "must use https in production" });
      }
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
