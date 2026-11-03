import { z } from "zod";

export { emailSchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema } from "@ieltiva/shared";

export const googleStartSchema = z.object({ intent: z.enum(["login", "link"]).default("login") });
