import { z } from "zod";
import type { UserRole } from "./domain.js";

/** The only user shape the API sends to clients. It never includes password or token data. */
export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  roles: UserRole[];
  permissions: string[];
};

const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address."));

const name = z
  .string()
  .trim()
  .min(1, "This field is required.")
  .max(100)
  .regex(/^[^<>\u0000-\u001f\u007f]+$/, "Contains characters that aren't allowed.");

const COMMON_PASSWORDS = ["password", "qwerty", "123456", "letmein", "ielts", "ieltiva", "welcome", "admin"];

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use 128 characters or fewer.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.")
  .refine((value) => !COMMON_PASSWORDS.some((word) => value.toLowerCase().includes(word)), "This password is too easy to guess.");

const passwordsMatch = (data: { password: string; confirmPassword: string }) => data.password === data.confirmPassword;
const mismatch = { path: ["confirmPassword"], message: "Passwords don't match." };

export const registerSchema = z
  .strictObject({
    firstName: name,
    lastName: name,
    email,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
    termsAccepted: z.literal(true, "You must accept the terms."),
  })
  .refine(passwordsMatch, mismatch)
  .refine((data) => !data.password.toLowerCase().includes(data.email.split("@")[0] ?? "\0"), {
    path: ["password"],
    message: "Your password can't contain your email name.",
  });

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const emailSchema = z.strictObject({ email });

export const tokenSchema = z.strictObject({ token: z.string().min(20).max(200) });

export const resetPasswordSchema = z
  .strictObject({
    token: z.string().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine(passwordsMatch, mismatch);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
