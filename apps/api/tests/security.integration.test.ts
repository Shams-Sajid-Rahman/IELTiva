import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { SignJWT, UnsecuredJWT } from "jose";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "../prisma/seed-lib.js";
import { createApp } from "../src/app.js";
import { createPrismaClient } from "../src/config/database.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createAuthService } from "../src/services/auth.service.js";
import type { EmailMessage, EmailProvider } from "../src/services/email/email.provider.js";
import { createTokenService } from "../src/services/token.service.js";
import { hashToken } from "../src/utils/crypto.js";
import { createLogger } from "../src/utils/logger.js";
import { testEnv } from "./helpers.js";

const apiRoot = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.resolve(apiRoot, "../../.env"), quiet: true });

// Runs in a new database, created and dropped here. No other database is touched.
const dbName = `ieltiva_security_disposable_${Date.now()}`;
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

const API = "/api/v1/auth";
const PASSWORD = "Str0ng-Pass-Word";
const secret = "test-jwt-secret-test-jwt-secret-00000";
const env = { ...testEnv, API_BASE_URL: "http://localhost:5000", JWT_ACCESS_SECRET: secret, ACCESS_TOKEN_MINUTES: 15, REFRESH_TOKEN_DAYS: 30 };
const limits = { login: 10_000, register: 10_000, refresh: 10_000, emailAction: 10_000, tokenAction: 10_000 };
const key = new TextEncoder().encode(secret);

let prisma: ReturnType<typeof createPrismaClient>;
let sent: EmailMessage[];

function makeApp(overrides: Partial<typeof env> = {}) {
  const merged = { ...env, ...overrides };
  const logger = createLogger("silent");
  const tokens = createTokenService(merged);
  const email: EmailProvider = {
    name: "memory",
    send: async (message) => {
      sent.push(message);
      return { delivered: true };
    },
  };
  const auth = createAuthService({ prisma, env: merged, tokens, email, logger });
  return createApp({ env: merged, logger, checkDatabase: async () => {}, authRouter: createAuthRouter({ env: merged, auth, tokens, google: null, limits }) });
}

async function client(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const csrf = (await agent.get(`${API}/csrf`)).body.data.csrfToken as string;
  return { agent, csrf, post: (route: string, body: object = {}) => agent.post(`${API}${route}`).set("X-CSRF-Token", csrf).send(body) };
}

let counter = 0;
async function signedIn(app: ReturnType<typeof createApp>) {
  const c = await client(app);
  const email = `sec${++counter}-${Date.now()}@example.com`;
  await c.post("/register", { firstName: "A", lastName: "B", email, password: PASSWORD, confirmPassword: PASSWORD, termsAccepted: true }).expect(201);
  const login = await c.post("/login", { email, password: PASSWORD }).expect(200);
  const session = await prisma.userSession.findFirstOrThrow({ where: { user: { email } } });
  return { ...c, email, session, login };
}

function cookie(res: request.Response, name: string) {
  return (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith(`${name}=`))!;
}

const claims = (userId: string, sid: string) => new SignJWT({ sid }).setProtectedHeader({ alg: "HS256" }).setSubject(userId);

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
  sent = [];
});

describe("full student journey through the API", () => {
  it("runs from registration to a revoked session that can't be reused", async () => {
    const app = makeApp();
    const s = await signedIn(app);

    const verifyToken = sent.at(-1)!.text.match(/token=([\w-]+)/)![1]!;
    await s.post("/verify-email", { token: verifyToken }).expect(200);
    expect((await s.agent.get(`${API}/me`).expect(200)).body.data.user.emailVerified).toBe(true);

    const accessCookie = cookie(s.login, "ieltiva_access").split(";")[0]!;
    const firstRefresh = cookie(s.login, "ieltiva_refresh").split(";")[0]!;
    const refreshed = await s.post("/refresh").expect(200);
    const newAccess = cookie(refreshed, "ieltiva_access").split(";")[0]!;
    expect(cookie(refreshed, "ieltiva_refresh").split(";")[0]).not.toBe(firstRefresh);

    await s.post("/logout").expect(200);
    await request(app).get(`${API}/me`).set("Cookie", accessCookie).expect(401);
    await request(app).get(`${API}/me`).set("Cookie", newAccess).expect(401);
    await request(app)
      .post(`${API}/refresh`)
      .set("X-CSRF-Token", s.csrf)
      .set("Cookie", `${cookie(refreshed, "ieltiva_refresh").split(";")[0]}; ieltiva_csrf=${s.csrf}`)
      .expect(401);
  });
});

describe("password storage", () => {
  it("uses Argon2id with the configured cost, and verifies only the right password", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    await s.post("/login", { email: s.email, password: `${PASSWORD}x` }).expect(401);
  });
});

describe("forged access tokens", () => {
  it("rejects unsigned, expired, wrongly addressed and mismatched tokens", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    const { userId, id: sid } = s.session;
    const other = await signedIn(app);
    const get = (token: string) => request(app).get(`${API}/me`).set("Cookie", `ieltiva_access=${token}`);

    const good = await claims(userId, sid).setIssuer("ieltiva-api").setAudience("ieltiva-web").setExpirationTime("5m").sign(key);
    await get(good).expect(200);

    const none = new UnsecuredJWT({ sid }).setSubject(userId).setIssuer("ieltiva-api").setAudience("ieltiva-web").setExpirationTime("5m").encode();
    await get(none).expect(401);
    await get(await claims(userId, sid).setIssuer("ieltiva-api").setAudience("ieltiva-web").setExpirationTime("-1m").sign(key)).expect(401);
    await get(await claims(userId, sid).setIssuer("evil").setAudience("ieltiva-web").setExpirationTime("5m").sign(key)).expect(401);
    await get(await claims(userId, sid).setIssuer("ieltiva-api").setAudience("other").setExpirationTime("5m").sign(key)).expect(401);
    // A valid signature can't pair one user with another user's session.
    await get(await claims(other.session.userId, sid).setIssuer("ieltiva-api").setAudience("ieltiva-web").setExpirationTime("5m").sign(key)).expect(401);
  });

  it("ignores a role claim inside a validly signed token", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    const token = await new SignJWT({ sid: s.session.id, roles: ["SUPER_ADMIN"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(s.session.userId)
      .setIssuer("ieltiva-api")
      .setAudience("ieltiva-web")
      .setExpirationTime("5m")
      .sign(key);
    const res = await request(app).get(`${API}/me`).set("Cookie", `ieltiva_access=${token}`).expect(200);
    expect(res.body.data.user.roles).toEqual(["STUDENT"]);
  });

  it("doesn't accept an OAuth flow token as an access token", async () => {
    const tokens = createTokenService(env);
    const flow = await tokens.signOAuthFlow({ state: "s", nonce: "n", codeVerifier: "v" }, 5);
    await expect(tokens.verifyAccessToken(flow)).resolves.toBeNull();
  });
});

describe("session revocation and isolation", () => {
  it("rejects a revoked session's access token immediately", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    await prisma.userSession.update({ where: { id: s.session.id }, data: { revokedAt: new Date() } });
    await s.agent.get(`${API}/me`).expect(401);
  });

  it("keeps users separate: each sees only their own data and sessions", async () => {
    const app = makeApp();
    const a = await signedIn(app);
    const b = await signedIn(app);
    expect((await a.agent.get(`${API}/me`)).body.data.user.email).toBe(a.email);
    expect((await b.agent.get(`${API}/me`)).body.data.user.email).toBe(b.email);
    await a.post("/logout-all").expect(200);
    await a.agent.get(`${API}/me`).expect(401);
    await b.agent.get(`${API}/me`).expect(200);
  });

  it("requires a session for protected endpoints when called directly", async () => {
    const app = makeApp();
    await request(app).get(`${API}/me`).expect(401);
    const c = await client(app);
    await c.post("/logout-all").expect(401);
  });
});

describe("concurrent refresh", () => {
  it("lets exactly one request win, and never issues two valid tokens", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    const refresh = cookie(s.login, "ieltiva_refresh").split(";")[0]!;
    const results = await Promise.all(
      [1, 2, 3].map(() => request(app).post(`${API}/refresh`).set("X-CSRF-Token", s.csrf).set("Cookie", `${refresh}; ieltiva_csrf=${s.csrf}`)),
    );
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    const stillValid = await prisma.refreshToken.count({ where: { sessionId: s.session.id, usedAt: null, revokedAt: null } });
    expect(stillValid).toBeLessThanOrEqual(1);
  });
});

describe("recovery email limits", () => {
  it("sends one reset email per address per minute, with the same response", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    sent = [];
    const first = await s.post("/forgot-password", { email: s.email }).expect(202);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const second = await s.post("/forgot-password", { email: s.email }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toHaveLength(1);
    expect(second.body.message).toBe(first.body.message);
  });

  it("stores reset tokens only as hashes", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    sent = [];
    await s.post("/forgot-password", { email: s.email });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const token = sent[0]!.text.match(/token=([\w-]+)/)![1]!;
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: hashToken(token) } })).toBe(1);
  });
});

describe("hostile input", () => {
  it("treats injection attempts as plain invalid input", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    const before = await prisma.user.count();
    await s.post("/login", { email: "' OR 1=1 --@example.com", password: "x" }).expect(400);
    await s.post("/login", { email: s.email, password: "' OR '1'='1" }).expect(401);
    await s.post("/login", { email: { $ne: null }, password: { $ne: null } }).expect(400);
    await s.post("/verify-email", { token: "'; DROP TABLE users; --aaaaaaaaaa" }).expect(400);
    expect(await prisma.user.count()).toBe(before);
  });

  it("rejects script tags in names and unknown fields", async () => {
    const app = makeApp();
    const c = await client(app);
    const body = { firstName: "<script>alert(1)</script>", lastName: "B", email: "x@example.com", password: PASSWORD, confirmPassword: PASSWORD, termsAccepted: true };
    await c.post("/register", body).expect(400);
    await c.post("/register", { ...body, firstName: "A", emailVerifiedAt: "2020-01-01" }).expect(400);
    expect(await prisma.user.count({ where: { email: "x@example.com" } })).toBe(0);
  });

  it("handles a JSON-style cookie without crashing or authenticating", async () => {
    const app = makeApp();
    await request(app).get(`${API}/me`).set("Cookie", 'ieltiva_access=j:{"a":1}').expect(401);
  });
});

describe("cookies and headers", () => {
  it("marks session cookies Secure with the production setting, and keeps them HTTP-only", async () => {
    const app = makeApp({ COOKIE_SECURE: true, COOKIE_DOMAIN: ".example.test" } as never);
    const csrfRes = await request(app).get(`${API}/csrf`);
    const csrf = csrfRes.body.data.csrfToken as string;
    expect(cookie(csrfRes, "ieltiva_csrf")).toMatch(/Secure/);
    expect(cookie(csrfRes, "ieltiva_csrf")).not.toMatch(/HttpOnly/);

    const email = `secure-${Date.now()}@example.com`;
    const send = (route: string, body: object) =>
      request(app).post(`${API}${route}`).set("X-CSRF-Token", csrf).set("Cookie", `ieltiva_csrf=${csrf}`).send(body);
    await send("/register", { firstName: "A", lastName: "B", email, password: PASSWORD, confirmPassword: PASSWORD, termsAccepted: true }).expect(201);
    const login = await send("/login", { email, password: PASSWORD }).expect(200);
    for (const name of ["ieltiva_access", "ieltiva_refresh"]) {
      expect(cookie(login, name)).toMatch(/Secure/);
      expect(cookie(login, name)).toMatch(/HttpOnly/);
      expect(cookie(login, name)).toMatch(/SameSite=Lax/);
      expect(cookie(login, name)).toMatch(/Domain=\.example\.test/);
    }
  });

  it("marks auth responses no-store, and excludes secrets from the user response", async () => {
    const app = makeApp();
    const s = await signedIn(app);
    const res = await s.agent.get(`${API}/me`).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|failedLoginAttempts|lockedUntil/);
  });

  it("refuses CORS preflights from other origins", async () => {
    const app = makeApp();
    const denied = await request(app).options(`${API}/login`).set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    const allowed = await request(app).options(`${API}/login`).set("Origin", testEnv.FRONTEND_URL).set("Access-Control-Request-Method", "POST");
    expect(allowed.headers["access-control-allow-origin"]).toBe(testEnv.FRONTEND_URL);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
  });
});
