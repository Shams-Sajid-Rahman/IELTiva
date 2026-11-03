import { execSync } from "node:child_process";
import path from "node:path";
import { Writable } from "node:stream";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "../prisma/seed-lib.js";
import { createApp } from "../src/app.js";
import { DEFAULT_RATE_LIMITS, type AuthRateLimits } from "../src/config/auth.js";
import { createPrismaClient } from "../src/config/database.js";
import { createAuthMiddleware, requirePermission, requireRole } from "../src/middleware/authenticate.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createAuthService } from "../src/services/auth.service.js";
import type { EmailMessage, EmailProvider } from "../src/services/email/email.provider.js";
import { UnavailableEmailProvider } from "../src/services/email/index.js";
import type { GoogleIdentity, OAuthProvider } from "../src/services/google-oauth.service.js";
import { createTokenService } from "../src/services/token.service.js";
import { hashToken } from "../src/utils/crypto.js";
import { createLogger } from "../src/utils/logger.js";
import { testEnv } from "./helpers.js";
import express from "express";
import cookieParser from "cookie-parser";

const apiRoot = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.resolve(apiRoot, "../../.env"), quiet: true });

// Runs in a new database, created and dropped here. No other database is touched.
const dbName = `ieltiva_auth_disposable_${Date.now()}`;
const adminUrl = new URL(process.env.TEST_DATABASE_URL!);
adminUrl.pathname = "/postgres";
const url = new URL(process.env.TEST_DATABASE_URL!);
url.pathname = `/${dbName}`;

async function admin(sql: string) {
  const client = new Client({ connectionString: adminUrl.href });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

class MemoryEmail implements EmailProvider {
  readonly name = "memory";
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return { delivered: true };
  }
  tokenFor(to: string) {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    return message?.text.match(/token=([\w-]+)/)?.[1];
  }
}

const env = { ...testEnv, API_BASE_URL: "http://localhost:5000", JWT_ACCESS_SECRET: "test-jwt-secret-test-jwt-secret-00000", ACCESS_TOKEN_MINUTES: 15, REFRESH_TOKEN_DAYS: 30 };
const API = "/api/v1/auth";
const PASSWORD = "Str0ng-Pass-Word";
const OPEN_LIMITS: AuthRateLimits = { login: 10_000, register: 10_000, refresh: 10_000, emailAction: 10_000, tokenAction: 10_000 };

let prisma: ReturnType<typeof createPrismaClient>;
let mail: MemoryEmail;
let logs: string[];
let googleIdentity: GoogleIdentity | Error;
let lastFlowNonce: string | undefined;
const fakeGoogle: OAuthProvider = {
  buildAuthorizationUrl: ({ state, nonce }) => `https://google.example/auth?state=${state}&nonce=${nonce}`,
  exchangeCode: async (_code, flow) => {
    lastFlowNonce = flow.nonce;
    if (googleIdentity instanceof Error) throw googleIdentity;
    return googleIdentity;
  },
};

function makeApp(limits: AuthRateLimits = OPEN_LIMITS, google: OAuthProvider | null = fakeGoogle, email: EmailProvider = mail) {
  const logger = createLogger("info", new Writable({ write(chunk, _enc, done) { logs.push(String(chunk)); done(); } }));
  const tokens = createTokenService(env);
  const auth = createAuthService({ prisma, env, tokens, email, logger });
  return {
    app: createApp({ env, logger, checkDatabase: async () => {}, authRouter: createAuthRouter({ env, auth, tokens, google, limits }) }),
    auth,
    tokens,
  };
}

async function client(app: express.Express) {
  const agent = request.agent(app);
  const res = await agent.get(`${API}/csrf`).expect(200);
  const csrf = res.body.data.csrfToken as string;
  return { agent, post: (route: string, body: object = {}) => agent.post(`${API}${route}`).set("X-CSRF-Token", csrf).send(body) };
}

let counter = 0;
const newEmail = () => `user${++counter}-${Date.now()}@example.com`;
const registration = (email: string, extra: object = {}) => ({
  firstName: "Ayesha",
  lastName: "Rahman",
  email,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  termsAccepted: true,
  ...extra,
});

function cookieOf(res: request.Response, name: string) {
  const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
  return cookies?.find((cookie) => cookie.startsWith(`${name}=`));
}

async function registeredClient(app: express.Express, login = true) {
  const c = await client(app);
  const email = newEmail();
  await c.post("/register", registration(email)).expect(201);
  if (login) await c.post("/login", { email, password: PASSWORD }).expect(200);
  return { ...c, email };
}

beforeAll(async () => {
  await admin(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe" });
  prisma = createPrismaClient(url.href);
  await runSeed(prisma, {});
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
});

beforeEach(() => {
  mail = new MemoryEmail();
  logs = [];
});

describe("registration", () => {
  it("creates a student with a hashed password and a safe response", async () => {
    const { app } = makeApp();
    const c = await client(app);
    const email = newEmail();
    const res = await c.post("/register", registration(email.toUpperCase())).expect(201);

    expect(res.body.data.user).toMatchObject({ email, emailVerified: false, roles: ["STUDENT"], firstName: "Ayesha" });
    expect(res.body.data.verificationEmailDelivered).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|Str0ng/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.termsAcceptedAt).not.toBeNull();
  });

  it("rejects a duplicate email", async () => {
    const { app } = makeApp();
    const c = await client(app);
    const email = newEmail();
    await c.post("/register", registration(email)).expect(201);
    const res = await c.post("/register", registration(email)).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects an invalid email, a weak password, mismatched passwords and missing terms", async () => {
    const { app } = makeApp();
    const c = await client(app);
    await c.post("/register", registration("not-an-email")).expect(400);
    for (const weak of ["short1A", "alllowercase123", "NoNumbersHere", "Password12345"]) {
      await c.post("/register", registration(newEmail(), { password: weak, confirmPassword: weak })).expect(400);
    }
    await c.post("/register", registration(newEmail(), { confirmPassword: "Different-Pass1" })).expect(400);
    await c.post("/register", registration(newEmail(), { termsAccepted: false })).expect(400);
  });

  it("rejects client-supplied roles", async () => {
    const { app } = makeApp();
    const c = await client(app);
    const email = newEmail();
    await c.post("/register", registration(email, { role: "SUPER_ADMIN" })).expect(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("doesn't claim delivery when email is unavailable", async () => {
    const { app } = makeApp(OPEN_LIMITS, fakeGoogle, new UnavailableEmailProvider(createLogger("silent")));
    const c = await client(app);
    const res = await c.post("/register", registration(newEmail())).expect(201);
    expect(res.body.data.verificationEmailDelivered).toBe(false);
  });
});

describe("login and sessions", () => {
  it("sets secure-flagged HTTP-only cookies and returns no tokens in the body", async () => {
    const { app } = makeApp();
    const c = await client(app);
    const email = newEmail();
    await c.post("/register", registration(email));
    const res = await c.post("/login", { email, password: PASSWORD }).expect(200);
    const access = cookieOf(res, "ieltiva_access")!;
    const refresh = cookieOf(res, "ieltiva_refresh")!;
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);

    const session = await prisma.userSession.findFirstOrThrow({ where: { user: { email } } });
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives identical errors for a wrong password and an unknown email", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app, false);
    const wrong = await c.post("/login", { email: c.email, password: "Wrong-Pass-Word1" }).expect(401);
    const unknown = await c.post("/login", { email: "nobody@example.com", password: "Wrong-Pass-Word1" }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
  });

  it("blocks suspended accounts, including existing sessions", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app);
    await c.agent.get(`${API}/me`).expect(200);
    await prisma.user.update({ where: { email: c.email }, data: { status: "SUSPENDED" } });
    await c.agent.get(`${API}/me`).expect(401);
    await c.post("/login", { email: c.email, password: PASSWORD }).expect(403);
  });

  it("locks an account after repeated failures, with the same error", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app, false);
    for (let i = 0; i < 10; i++) await c.post("/login", { email: c.email, password: "Wrong-Pass-Word1" }).expect(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: c.email } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const res = await c.post("/login", { email: c.email, password: PASSWORD }).expect(401);
    expect(res.body.message).toBe("Incorrect email or password.");
  });

  it("validates access tokens and rejects tampered or missing ones", async () => {
    const { app, tokens } = makeApp();
    const c = await registeredClient(app);
    const me = await c.agent.get(`${API}/me`).expect(200);
    expect(me.body.data.user.email).toBe(c.email);

    await request(app).get(`${API}/me`).expect(401);
    await request(app).get(`${API}/me`).set("Cookie", "ieltiva_access=not-a-token").expect(401);
    const session = await prisma.userSession.findFirstOrThrow({ where: { user: { email: c.email } } });
    const good = await tokens.signAccessToken(session.userId, session.id);
    await request(app).get(`${API}/me`).set("Cookie", `ieltiva_access=${good.token}`).expect(200);
    await request(app).get(`${API}/me`).set("Cookie", `ieltiva_access=${good.token.slice(0, -2)}xx`).expect(401);
    const foreign = await createTokenService({ ...env, JWT_ACCESS_SECRET: "another-secret-another-secret-000000" }).signAccessToken(session.userId, session.id);
    await request(app).get(`${API}/me`).set("Cookie", `ieltiva_access=${foreign.token}`).expect(401);
  });

  it("rotates refresh tokens and stores only hashes", async () => {
    const { app } = makeApp();
    const c = await client(app);
    const email = newEmail();
    await c.post("/register", registration(email));
    const login = await c.post("/login", { email, password: PASSWORD });
    const first = cookieOf(login, "ieltiva_refresh")!.split(";")[0]!.split("=")[1]!;
    expect(await prisma.refreshToken.count({ where: { tokenHash: first } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { tokenHash: hashToken(first) } })).toBe(1);

    const refreshed = await c.post("/refresh").expect(200);
    const second = cookieOf(refreshed, "ieltiva_refresh")!.split(";")[0]!.split("=")[1]!;
    expect(second).not.toBe(first);
    const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(first) } });
    expect(old.usedAt).not.toBeNull();
    expect(old.replacedById).not.toBeNull();
    await c.agent.get(`${API}/me`).expect(200);
  });

  it("detects refresh token reuse and ends the session", async () => {
    const { app } = makeApp();
    const c = await client(app);
    const email = newEmail();
    await c.post("/register", registration(email));
    const login = await c.post("/login", { email, password: PASSWORD });
    const stolen = cookieOf(login, "ieltiva_refresh")!.split(";")[0]!;
    await c.post("/refresh").expect(200);

    const csrfRes = await request(app).get(`${API}/csrf`);
    const reuse = await request(app)
      .post(`${API}/refresh`)
      .set("X-CSRF-Token", csrfRes.body.data.csrfToken)
      .set("Cookie", `${stolen}; ieltiva_csrf=${csrfRes.body.data.csrfToken}`);
    expect(reuse.status).toBe(401);

    await c.post("/refresh").expect(401);
    await c.agent.get(`${API}/me`).expect(401);
    const session = await prisma.userSession.findFirstOrThrow({ where: { user: { email } } });
    expect(session.revokedAt).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { sessionId: session.id, revokedAt: null } })).toBe(0);
  });

  it("rejects an expired session", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app);
    await prisma.userSession.updateMany({ where: { user: { email: c.email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await c.agent.get(`${API}/me`).expect(401);
    await c.post("/refresh").expect(401);
  });

  it("logs out the current session only", async () => {
    const { app } = makeApp();
    const one = await registeredClient(app);
    const two = await client(app);
    await two.post("/login", { email: one.email, password: PASSWORD }).expect(200);
    const res = await one.post("/logout").expect(200);
    expect(cookieOf(res, "ieltiva_access")).toMatch(/Expires=Thu, 01 Jan 1970/);
    await one.agent.get(`${API}/me`).expect(401);
    await two.agent.get(`${API}/me`).expect(200);
  });

  it("logs out of all sessions", async () => {
    const { app } = makeApp();
    const one = await registeredClient(app);
    const two = await client(app);
    await two.post("/login", { email: one.email, password: PASSWORD }).expect(200);
    await one.post("/logout-all").expect(200);
    await two.agent.get(`${API}/me`).expect(401);
    await two.post("/refresh").expect(401);
  });
});

describe("email verification", () => {
  it("verifies once, and rejects reused and expired tokens", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app);
    const token = mail.tokenFor(c.email)!;
    expect(await prisma.emailVerificationToken.count({ where: { tokenHash: token } })).toBe(0);
    await c.post("/verify-email", { token }).expect(200);
    expect((await c.agent.get(`${API}/me`)).body.data.user.emailVerified).toBe(true);
    await c.post("/verify-email", { token }).expect(400);

    const other = await registeredClient(app);
    const expired = mail.tokenFor(other.email)!;
    await prisma.emailVerificationToken.updateMany({ where: { tokenHash: hashToken(expired) }, data: { expiresAt: new Date(0) } });
    await other.post("/verify-email", { token: expired }).expect(400);
  });

  it("resend replaces the old token and doesn't reveal accounts", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app, false);
    const first = mail.tokenFor(c.email)!;
    const known = await c.post("/resend-verification", { email: c.email }).expect(202);
    const unknown = await c.post("/resend-verification", { email: "nobody@example.com" }).expect(202);
    expect(known.body.message).toBe(unknown.body.message);
    await vi.waitFor(() => expect(mail.tokenFor(c.email)).not.toBe(first));
    await c.post("/verify-email", { token: first }).expect(400);
    await c.post("/verify-email", { token: mail.tokenFor(c.email)! }).expect(200);
  });
});

describe("password recovery", () => {
  it("resets once, revokes sessions and doesn't reveal accounts", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app);
    const known = await c.post("/forgot-password", { email: c.email }).expect(202);
    const unknown = await c.post("/forgot-password", { email: "nobody@example.com" }).expect(202);
    expect(known.body.message).toBe(unknown.body.message);
    await vi.waitFor(() => expect(mail.sent.some((m) => m.subject.includes("Reset"))).toBe(true));
    const token = mail.sent.find((m) => m.subject.includes("Reset"))!.text.match(/token=([\w-]+)/)![1]!;

    const other = await client(app);
    await other.post("/login", { email: c.email, password: PASSWORD }).expect(200);
    const next = "N3w-Strong-Secret";
    await c.post("/reset-password", { token, password: "weak", confirmPassword: "weak" }).expect(400);
    await c.post("/reset-password", { token, password: next, confirmPassword: next }).expect(200);

    await other.agent.get(`${API}/me`).expect(401);
    await other.post("/refresh").expect(401);
    await c.post("/login", { email: c.email, password: PASSWORD }).expect(401);
    await c.post("/login", { email: c.email, password: next }).expect(200);
    await c.post("/reset-password", { token, password: "An0ther-Secret-X", confirmPassword: "An0ther-Secret-X" }).expect(400);
  });

  it("rejects an expired reset token", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app, false);
    await c.post("/forgot-password", { email: c.email });
    await vi.waitFor(() => expect(mail.sent.some((m) => m.subject.includes("Reset"))).toBe(true));
    const token = mail.sent.find((m) => m.subject.includes("Reset"))!.text.match(/token=([\w-]+)/)![1]!;
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(0) } });
    await c.post("/reset-password", { token, password: "N3w-Strong-Secret", confirmPassword: "N3w-Strong-Secret" }).expect(400);
  });
});

describe("role and permission middleware", () => {
  function protectedApp() {
    const { auth, tokens } = makeApp();
    const { authenticateUser, optionalAuthentication } = createAuthMiddleware({ tokens, auth });
    const app = express();
    app.use((req, _res, next) => {
      req.log = createLogger("silent") as never;
      req.id = "t";
      next();
    });
    app.use(cookieParser());
    app.get("/admin", authenticateUser, requireRole("ADMIN"), (_req, res) => void res.json({ ok: true }));
    app.get("/perm", authenticateUser, requirePermission("users.manage"), (_req, res) => void res.json({ ok: true }));
    app.get("/own", authenticateUser, requirePermission("attempts.own"), (_req, res) => void res.json({ ok: true }));
    app.get("/optional", optionalAuthentication, (req, res) => void res.json({ signedIn: Boolean(req.auth) }));
    app.use(errorHandler);
    return { app, tokens };
  }

  it("uses database roles and ignores client claims", async () => {
    const { app: main } = makeApp();
    const c = await registeredClient(main);
    const { app, tokens } = protectedApp();
    const session = await prisma.userSession.findFirstOrThrow({ where: { user: { email: c.email } } });
    const { token } = await tokens.signAccessToken(session.userId, session.id);
    const cookie = `ieltiva_access=${token}`;

    await request(app).get("/admin").expect(401);
    await request(app).get("/admin").set("Cookie", cookie).set("X-User-Role", "ADMIN").expect(403);
    await request(app).get("/perm").set("Cookie", cookie).expect(403);
    await request(app).get("/own").set("Cookie", cookie).expect(200);

    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    await prisma.userRole.create({ data: { userId: session.userId, roleId: adminRole.id } });
    await request(app).get("/admin").set("Cookie", cookie).expect(200);
    await request(app).get("/perm").set("Cookie", cookie).expect(200);

    expect((await request(app).get("/optional")).body.signedIn).toBe(false);
    expect((await request(app).get("/optional").set("Cookie", "ieltiva_access=bad")).body.signedIn).toBe(false);
    expect((await request(app).get("/optional").set("Cookie", cookie)).body.signedIn).toBe(true);
  });
});

describe("rate limiting", () => {
  it("limits login attempts", async () => {
    const { app } = makeApp({ ...DEFAULT_RATE_LIMITS, login: 3 });
    const c = await client(app);
    const body = { email: "nobody@example.com", password: "Wrong-Pass-Word1" };
    for (let i = 0; i < 3; i++) await c.post("/login", body).expect(401);
    const res = await c.post("/login", body).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("limits forgot-password requests", async () => {
    const { app } = makeApp({ ...DEFAULT_RATE_LIMITS, emailAction: 2 });
    const c = await client(app);
    for (let i = 0; i < 2; i++) await c.post("/forgot-password", { email: "nobody@example.com" }).expect(202);
    await c.post("/forgot-password", { email: "nobody@example.com" }).expect(429);
  });
});

describe("CSRF protection", () => {
  const body = { email: "nobody@example.com", password: "Wrong-Pass-Word1" };

  it("rejects requests without a matching signed token", async () => {
    const { app } = makeApp();
    const noToken = await request(app).post(`${API}/login`).send(body).expect(403);
    expect(noToken.body.error.code).toBe("CSRF_FAILED");

    const { agent } = await client(app);
    await agent.post(`${API}/login`).send(body).expect(403);
    await agent.post(`${API}/login`).set("X-CSRF-Token", "wrong").send(body).expect(403);
    const forged = "value.signature";
    await request(app).post(`${API}/login`).set("Cookie", `ieltiva_csrf=${forged}`).set("X-CSRF-Token", forged).send(body).expect(403);
  });

  it("rejects a foreign origin even with a valid token", async () => {
    const { app } = makeApp();
    const c = await client(app);
    await c.post("/login", body).set("Origin", "https://evil.example").expect(403);
    await c.post("/login", body).set("Origin", testEnv.FRONTEND_URL).expect(401);
  });

  it("protects logout too", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app);
    await c.agent.post(`${API}/logout`).expect(403);
    await c.agent.get(`${API}/me`).expect(200);
  });
});

describe("Google sign-in", () => {
  async function begin(agent: ReturnType<typeof request.agent>, query = "") {
    const res = await agent.get(`${API}/google${query}`).expect(302);
    return { state: new URL(res.headers.location!).searchParams.get("state")!, nonce: new URL(res.headers.location!).searchParams.get("nonce")! };
  }
  const identity = (email: string, extra: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
    subject: `sub-${email}`,
    email,
    emailVerified: true,
    firstName: "Google",
    lastName: "User",
    ...extra,
  });
  const reason = (res: request.Response) => new URL(res.headers.location!).searchParams.get("reason");
  const status = (res: request.Response) => new URL(res.headers.location!).searchParams.get("status");

  it("returns 503 when Google isn't configured", async () => {
    const { app } = makeApp(OPEN_LIMITS, null);
    await request(app).get(`${API}/google`).expect(503);
    await request(app).get(`${API}/google/callback?state=a&code=b`).expect(503);
  });

  it("creates a verified student account and session after validation", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const { state, nonce } = await begin(agent);
    const email = newEmail();
    googleIdentity = identity(email);
    const res = await agent.get(`${API}/google/callback?state=${state}&code=abc`).expect(302);
    expect(status(res)).toBe("signed_in");
    expect(res.headers.location).toMatch(/^http:\/\/localhost:3000\//);
    expect(res.headers.location).not.toMatch(/token|eyJ/);
    expect(lastFlowNonce).toBe(nonce);
    const me = await agent.get(`${API}/me`).expect(200);
    expect(me.body.data.user).toMatchObject({ email, emailVerified: true, roles: ["STUDENT"] });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();

    const again = request.agent(app);
    const second = await begin(again);
    const repeat = await again.get(`${API}/google/callback?state=${second.state}&code=abc`).expect(302);
    expect(status(repeat)).toBe("signed_in");
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("rejects missing, wrong and replayed state", async () => {
    const { app } = makeApp();
    googleIdentity = identity(newEmail());
    expect(reason(await request(app).get(`${API}/google/callback?state=a&code=b`))).toBe("invalid_state");
    const agent = request.agent(app);
    const { state } = await begin(agent);
    expect(reason(await agent.get(`${API}/google/callback?state=wrong&code=b`))).toBe("invalid_state");
    const fresh = request.agent(app);
    const flow = await begin(fresh);
    await fresh.get(`${API}/google/callback?state=${flow.state}&code=b`).expect(302);
    expect(reason(await fresh.get(`${API}/google/callback?state=${flow.state}&code=b`))).toBe("invalid_state");
    expect(state).toBeTruthy();
  });

  it("handles denied consent and failed validation without a session", async () => {
    const { app } = makeApp();
    const denied = request.agent(app);
    const d = await begin(denied);
    expect(reason(await denied.get(`${API}/google/callback?state=${d.state}&error=access_denied`))).toBe("google_denied");
    const failed = request.agent(app);
    const f = await begin(failed);
    googleIdentity = new Error("bad nonce");
    const res = await failed.get(`${API}/google/callback?state=${f.state}&code=c`);
    expect(reason(res)).toBe("google_validation_failed");
    await failed.get(`${API}/me`).expect(401);
  });

  it("rejects an unverified Google email", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const { state } = await begin(agent);
    const email = newEmail();
    googleIdentity = identity(email, { emailVerified: false });
    expect(reason(await agent.get(`${API}/google/callback?state=${state}&code=c`))).toBe("email_not_verified");
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("never links automatically to an existing account with the same email", async () => {
    const { app } = makeApp();
    const owner = await registeredClient(app, false);
    const agent = request.agent(app);
    const { state } = await begin(agent);
    googleIdentity = identity(owner.email);
    const res = await agent.get(`${API}/google/callback?state=${state}&code=c`);
    expect(reason(res)).toBe("account_exists");
    expect(await prisma.oAuthAccount.count({ where: { user: { email: owner.email } } })).toBe(0);
    await agent.get(`${API}/me`).expect(401);
  });

  it("links only for a signed-in user with a verified email", async () => {
    const { app } = makeApp();
    await request(app).get(`${API}/google?intent=link`).expect(401);

    const c = await registeredClient(app);
    const unverified = await begin(c.agent, "?intent=link");
    googleIdentity = identity(newEmail());
    expect(reason(await c.agent.get(`${API}/google/callback?state=${unverified.state}&code=c`))).toBe("verify_email_first");

    await c.post("/verify-email", { token: mail.tokenFor(c.email)! }).expect(200);
    const verified = await begin(c.agent, "?intent=link");
    const res = await c.agent.get(`${API}/google/callback?state=${verified.state}&code=c`);
    expect(status(res)).toBe("linked");
    expect(await prisma.oAuthAccount.count({ where: { user: { email: c.email } } })).toBe(1);

    const other = await registeredClient(app);
    await other.post("/verify-email", { token: mail.tokenFor(other.email)! }).expect(200);
    const taken = await begin(other.agent, "?intent=link");
    expect(reason(await other.agent.get(`${API}/google/callback?state=${taken.state}&code=c`))).toBe("already_linked");
  });
});

describe("sensitive data", () => {
  it("keeps passwords and tokens out of logs", async () => {
    const { app } = makeApp();
    const c = await registeredClient(app);
    await c.post("/refresh").expect(200);
    const agent = request.agent(app);
    const res = await agent.get(`${API}/google`);
    const state = new URL(res.headers.location!).searchParams.get("state")!;
    googleIdentity = identity2();
    await agent.get(`${API}/google/callback?state=${state}&code=secret-oauth-code`);
    const text = logs.join("");
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("secret-oauth-code");
    expect(text).not.toContain(state);
    expect(text).not.toMatch(/ieltiva_(access|refresh)=/);
    expect(text).not.toContain(mail.tokenFor(c.email)!);
  });
});

function identity2(): GoogleIdentity {
  return { subject: `sub-${Date.now()}`, email: newEmail(), emailVerified: true, firstName: "G", lastName: "U" };
}
