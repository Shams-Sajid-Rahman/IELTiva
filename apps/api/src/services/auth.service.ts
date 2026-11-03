import { randomUUID } from "node:crypto";
import type { AuthUser } from "@ieltiva/shared";
import {
  DEFAULT_ROLE_CODE,
  EMAIL_COOLDOWN_SECONDS,
  EMAIL_VERIFICATION_HOURS,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  PASSWORD_RESET_MINUTES,
} from "../config/auth.js";
import type { Env } from "../config/env.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import type { AuthContext, RequestMeta } from "../types/auth.js";
import { AppError } from "../utils/app-error.js";
import { hashToken, randomToken } from "../utils/crypto.js";
import type { Logger } from "../utils/logger.js";
import type { EmailProvider } from "./email/email.provider.js";
import type { GoogleIdentity } from "./google-oauth.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import type { TokenService } from "./token.service.js";

type Deps = {
  prisma: PrismaClient;
  env: Pick<Env, "FRONTEND_URL" | "REFRESH_TOKEN_DAYS">;
  tokens: TokenService;
  email: EmailProvider;
  logger: Pick<Logger, "warn" | "error">;
  /** In-app notices for account events. Optional, so a failure here never blocks authentication. */
  notifyUser?: (userId: string, message: { type: "SYSTEM" | "SECURITY"; title: string; body: string; link?: string }) => Promise<void>;
};

export type GoogleOutcome =
  | { kind: "signed_in"; userId: string }
  | { kind: "linked"; userId: string }
  | { kind: "rejected"; reason: "email_not_verified" | "account_exists" | "already_linked" | "account_unavailable" | "verify_email_first" };

const INVALID_CREDENTIALS = () => new AppError(401, "UNAUTHENTICATED", "Incorrect email or password.");
const INVALID_SESSION = () => new AppError(401, "UNAUTHENTICATED", "Your session has ended. Please sign in again.");
const INVALID_TOKEN = () => new AppError(400, "VALIDATION_ERROR", "This link is invalid or has expired.");

const userInclude = {
  profile: true,
  userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude;

type LoadedUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toAuthUser(user: LoadedUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.profile?.firstName ?? "",
    lastName: user.profile?.lastName ?? "",
    emailVerified: user.emailVerifiedAt !== null,
    roles: user.userRoles.map(({ role }) => role.code) as AuthUser["roles"],
    permissions: [...new Set(user.userRoles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))],
  };
}

export function createAuthService({ prisma, env, tokens, email, logger, notifyUser }: Deps) {
  async function notify(userId: string, message: Parameters<NonNullable<Deps["notifyUser"]>>[1]) {
    try {
      await notifyUser?.(userId, message);
    } catch (error) {
      logger.error({ err: error }, "Account notification failed");
    }
  }

  const WELCOME = { type: "SYSTEM" as const, title: "Welcome to IELTiva", body: "Choose your IELTS type in your profile, then browse the courses.", link: "/profile" };

  const cooldownStart = () => new Date(Date.now() - EMAIL_COOLDOWN_SECONDS * 1000);

  async function defaultRoleId() {
    const role = await prisma.role.findUnique({ where: { code: DEFAULT_ROLE_CODE } });
    if (!role) throw new Error("Default role is missing. Run the database seed.");
    return role.id;
  }

  async function sendSafely(to: string, subject: string, text: string) {
    try {
      return await email.send({ to, subject, text });
    } catch (error) {
      logger.error({ err: error }, "Email delivery failed");
      return { delivered: false };
    }
  }

  async function sendVerification(userId: string, address: string) {
    const token = randomToken();
    const now = new Date();
    await prisma.$transaction([
      prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null, newEmail: null }, data: { usedAt: now } }),
      prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_HOURS * 3_600_000),
        },
      }),
    ]);
    const link = `${env.FRONTEND_URL}/verify-email?token=${token}`;
    return sendSafely(address, "Verify your IELTiva email", `Confirm your email address using this link:\n\n${link}\n\nIt expires in ${EMAIL_VERIFICATION_HOURS} hours.`);
  }

  async function issueSession(userId: string, meta: RequestMeta) {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: { userId, userAgent: meta.userAgent, ipAddress: meta.ipAddress, expiresAt: refreshExpiresAt },
      });
      await tx.refreshToken.create({
        data: { userId, sessionId: created.id, familyId: randomUUID(), tokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt },
      });
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
      return created;
    });
    const access = await tokens.signAccessToken(userId, session.id);
    return { accessToken: access.token, accessExpiresAt: access.expiresAt, refreshToken, refreshExpiresAt };
  }

  async function revokeAllSessions(userId: string) {
    const now = new Date();
    await prisma.$transaction([
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
  }

  async function createUser(data: { email: string; firstName: string; lastName: string; passwordHash?: string; emailVerifiedAt?: Date; termsAcceptedAt?: Date; google?: string }) {
    const roleId = await defaultRoleId();
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        emailVerifiedAt: data.emailVerifiedAt,
        termsAcceptedAt: data.termsAcceptedAt,
        profile: { create: { firstName: data.firstName, lastName: data.lastName } },
        userRoles: { create: { roleId } },
        ...(data.google ? { oauthAccounts: { create: { provider: "google", providerAccountId: data.google } } } : {}),
      },
      include: userInclude,
    });
  }

  return {
    async register(input: { firstName: string; lastName: string; email: string; password: string }) {
      const passwordHash = await hashPassword(input.password);
      let user: LoadedUser;
      try {
        user = await createUser({ ...input, passwordHash, termsAcceptedAt: new Date() });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "CONFLICT", "An account with this email already exists.");
        }
        throw error;
      }
      const result = await sendVerification(user.id, user.email);
      await notify(user.id, WELCOME);
      return { user: toAuthUser(user), verificationEmailDelivered: result.delivered };
    },

    async login(input: { email: string; password: string }, meta: RequestMeta) {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
      const passwordOk = await verifyPassword(user?.passwordHash, input.password);

      if (!user || locked) throw INVALID_CREDENTIALS();
      if (!passwordOk) {
        // The database increments, so parallel guesses can't undercount.
        const { failedLoginAttempts } = await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: { increment: 1 } },
          select: { failedLoginAttempts: true },
        });
        if (failedLoginAttempts >= MAX_FAILED_LOGINS) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
          });
        }
        throw INVALID_CREDENTIALS();
      }
      if (user.status !== "ACTIVE") throw new AppError(403, "FORBIDDEN", "This account isn't available. Please contact support.");

      const session = await issueSession(user.id, meta);
      const loaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
      return { user: toAuthUser(loaded), session };
    },

    issueSession,

    async refresh(refreshToken: string, meta: RequestMeta) {
      const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) }, include: { session: true, user: true } });
      if (!record) throw INVALID_SESSION();

      const now = new Date();
      const next = randomToken();
      const sessionValid = !record.session.revokedAt && record.session.expiresAt > now && record.expiresAt > now && record.user.status === "ACTIVE";

      // Claiming the old token and creating its replacement succeed or fail together.
      const outcome = await prisma.$transaction(async (tx) => {
        const claimed =
          !record.usedAt && !record.revokedAt
            ? await tx.refreshToken.updateMany({ where: { id: record.id, usedAt: null, revokedAt: null }, data: { usedAt: now } })
            : { count: 0 };
        if (claimed.count === 0) return "reused" as const;
        if (!sessionValid) return "invalid" as const;
        const created = await tx.refreshToken.create({
          data: {
            userId: record.userId,
            sessionId: record.sessionId,
            familyId: record.familyId,
            tokenHash: hashToken(next),
            expiresAt: record.session.expiresAt,
          },
        });
        await tx.refreshToken.update({ where: { id: record.id }, data: { replacedById: created.id } });
        await tx.userSession.update({
          where: { id: record.sessionId },
          data: { lastSeenAt: now, userAgent: meta.userAgent, ipAddress: meta.ipAddress },
        });
        return "rotated" as const;
      });

      if (outcome === "reused") {
        // A used or revoked token came back, so it may have been stolen. End the whole session.
        logger.warn({ userId: record.userId, sessionId: record.sessionId }, "Refresh token reuse detected");
        await prisma.$transaction([
          prisma.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: now } }),
          prisma.userSession.updateMany({ where: { id: record.sessionId, revokedAt: null }, data: { revokedAt: now } }),
        ]);
        throw INVALID_SESSION();
      }

      if (outcome === "invalid") throw INVALID_SESSION();

      const access = await tokens.signAccessToken(record.userId, record.sessionId);
      return { accessToken: access.token, accessExpiresAt: access.expiresAt, refreshToken: next, refreshExpiresAt: record.session.expiresAt };
    },

    /** Ends the session named by the access token or, when that has expired, the refresh token. */
    async logout({ sessionId, refreshToken }: { sessionId?: string; refreshToken?: string }) {
      let id = sessionId;
      if (!id && refreshToken) {
        const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
        id = record?.sessionId;
      }
      if (!id) return;
      const now = new Date();
      await prisma.$transaction([
        prisma.refreshToken.updateMany({ where: { sessionId: id, revokedAt: null }, data: { revokedAt: now } }),
        prisma.userSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } }),
      ]);
    },

    revokeAllSessions,

    async loadAuthContext(userId: string, sessionId: string): Promise<AuthContext | null> {
      const session = await prisma.userSession.findFirst({
        where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
        select: {
          user: {
            select: {
              emailVerifiedAt: true,
              userRoles: { select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
            },
          },
        },
      });
      if (!session) return null;
      const roles = session.user.userRoles.map(({ role }) => role);
      return {
        userId,
        sessionId,
        emailVerified: session.user.emailVerifiedAt !== null,
        roles: roles.map((role) => role.code),
        permissions: [...new Set(roles.flatMap((role) => role.permissions.map(({ permission }) => permission.code)))],
      };
    },

    async getUser(userId: string) {
      return toAuthUser(await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude }));
    },

    async verifyEmail(token: string) {
      const now = new Date();
      const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!record) throw INVALID_TOKEN();
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.emailVerificationToken.updateMany({
          where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count === 0) throw INVALID_TOKEN();
        await tx.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt: now, ...(record.newEmail ? { email: record.newEmail } : {}) },
        });
      }).catch((error: unknown) => {
        // Someone registered the address after this link was sent.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw INVALID_TOKEN();
        throw error;
      });
      if (record.newEmail) await notify(record.userId, { type: "SECURITY", title: "Email address changed", body: "Your account's email address was changed." });
    },

    async resendVerification(address: string) {
      const user = await prisma.user.findUnique({ where: { email: address } });
      if (!user || user.emailVerifiedAt || user.status !== "ACTIVE") return;
      if (await prisma.emailVerificationToken.count({ where: { userId: user.id, newEmail: null, createdAt: { gt: cooldownStart() } } })) return;
      await sendVerification(user.id, user.email);
    },

    async forgotPassword(address: string) {
      const user = await prisma.user.findUnique({ where: { email: address } });
      if (!user || user.status !== "ACTIVE") return;
      if (await prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: cooldownStart() } } })) return;
      const token = randomToken();
      const now = new Date();
      await prisma.$transaction([
        prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
        prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + PASSWORD_RESET_MINUTES * 60_000) },
        }),
      ]);
      const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      await sendSafely(user.email, "Reset your IELTiva password", `Reset your password using this link:\n\n${link}\n\nIt expires in ${PASSWORD_RESET_MINUTES} minutes. If you didn't ask for this, you can ignore this email.`);
    },

    async resetPassword(token: string, password: string) {
      const now = new Date();
      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!record) throw INVALID_TOKEN();
      const passwordHash = await hashPassword(password);
      // A crash can't consume the token without changing the password or ending sessions.
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count === 0) throw INVALID_TOKEN();
        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
        });
        await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
        await tx.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
      });
      await notify(record.userId, { type: "SECURITY", title: "Password reset", body: "Your password was reset, and all devices were signed out." });
    },

    /**
     * Never links automatically by email. Otherwise someone could register a victim's address
     * first and share the account once the victim signs in with Google.
     */
    async resolveGoogleIdentity(identity: GoogleIdentity, linkUser?: AuthContext): Promise<GoogleOutcome> {
      const existingLink = await prisma.oAuthAccount.findUnique({
        where: { provider_providerAccountId: { provider: "google", providerAccountId: identity.subject } },
        include: { user: true },
      });

      if (linkUser) {
        if (existingLink) return existingLink.userId === linkUser.userId ? { kind: "linked", userId: linkUser.userId } : { kind: "rejected", reason: "already_linked" };
        if (!linkUser.emailVerified) return { kind: "rejected", reason: "verify_email_first" };
        if (!identity.emailVerified) return { kind: "rejected", reason: "email_not_verified" };
        try {
          await prisma.oAuthAccount.create({ data: { userId: linkUser.userId, provider: "google", providerAccountId: identity.subject } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "rejected", reason: "already_linked" };
          throw error;
        }
        return { kind: "linked", userId: linkUser.userId };
      }

      if (existingLink) {
        return existingLink.user.status === "ACTIVE" ? { kind: "signed_in", userId: existingLink.userId } : { kind: "rejected", reason: "account_unavailable" };
      }
      if (!identity.emailVerified) return { kind: "rejected", reason: "email_not_verified" };

      const sameEmail = await prisma.user.findUnique({ where: { email: identity.email } });
      if (sameEmail) return { kind: "rejected", reason: "account_exists" };

      const user = await createUser({
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        emailVerifiedAt: new Date(),
        google: identity.subject,
      });
      await notify(user.id, WELCOME);
      return { kind: "signed_in", userId: user.id };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
