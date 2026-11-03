import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib.js";
import { createApp } from "../src/app.js";
import { createPrismaClient } from "../src/config/database.js";
import { createAuthMiddleware } from "../src/middleware/authenticate.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createPlatformRouter } from "../src/routes/platform.routes.js";
import { createAuthService } from "../src/services/auth.service.js";
import { calculateStreak } from "../src/services/dashboard.service.js";
import type { EmailMessage, EmailProvider } from "../src/services/email/email.provider.js";
import { createNotificationService, createPlatformServices } from "../src/services/platform.js";
import { LocalPrivateStorage } from "../src/services/storage/private-storage.js";
import { createTokenService } from "../src/services/token.service.js";
import { sanitizeAuditValue } from "../src/services/audit.service.js";
import { createLogger } from "../src/utils/logger.js";
import { testEnv } from "./helpers.js";

const apiRoot = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.resolve(apiRoot, "../../.env"), quiet: true });

// Runs in a new database, created and dropped here. No other database is touched.
const dbName = `ieltiva_platform_disposable_${Date.now()}`;
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

const V1 = "/api/v1";
const PASSWORD = "Str0ng-Pass-Word";
const env = { ...testEnv, API_BASE_URL: "http://localhost:5000", JWT_ACCESS_SECRET: "test-jwt-secret-test-jwt-secret-00000", ACCESS_TOKEN_MINUTES: 15, REFRESH_TOKEN_DAYS: 30 };
const limits = { login: 100_000, register: 100_000, refresh: 100_000, emailAction: 100_000, tokenAction: 100_000 };

let prisma: ReturnType<typeof createPrismaClient>;
let app: ReturnType<typeof createApp>;
let storageDir: string;
const sent: EmailMessage[] = [];

type Person = Awaited<ReturnType<typeof person>>;
let counter = 0;

async function person(role?: string) {
  const agent = request.agent(app);
  const csrf = (await agent.get(`${V1}/auth/csrf`)).body.data.csrfToken as string;
  const email = `user${++counter}-${Date.now()}@example.com`;
  const write = (method: "post" | "patch" | "delete" | "put", route: string) => agent[method](`${V1}${route}`).set("X-CSRF-Token", csrf);
  await write("post", "/auth/register").send({ firstName: "Test", lastName: `User${counter}`, email, password: PASSWORD, confirmPassword: PASSWORD, termsAccepted: true }).expect(201);
  await write("post", "/auth/login").send({ email, password: PASSWORD }).expect(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (role) {
    const found = await prisma.role.findUniqueOrThrow({ where: { code: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: found.id } });
  }
  return {
    agent,
    csrf,
    email,
    id: user.id,
    get: (route: string) => agent.get(`${V1}${route}`),
    post: (route: string, body: object = {}) => write("post", route).send(body),
    patch: (route: string, body: object = {}) => write("patch", route).send(body),
    del: (route: string) => write("delete", route).send({}),
    put: write,
  };
}

async function generalModule() {
  return prisma.learningModule.findUniqueOrThrow({ where: { code: "GENERAL" } });
}

/** A complete, published course with two resources. */
async function publishedCourse(owner: Person, overrides: object = {}) {
  const module = await generalModule();
  const course = (await owner.post("/courses", {
    title: `Course ${++counter}`,
    moduleId: module.id,
    description: "A complete description of this practice course.",
    learningObjectives: ["Understand the format"],
    ...overrides,
  }).expect(201)).body.data;
  const section = (await owner.post(`/courses/${course.id}/sections`, { title: "Start here" }).expect(201)).body.data;
  const first = (await owner.post(`/sections/${section.id}/resources`, { type: "ARTICLE", title: "Lesson one", body: "Lesson text" }).expect(201)).body.data;
  const second = (await owner.post(`/sections/${section.id}/resources`, { type: "EXTERNAL_LINK", title: "Reference", externalUrl: "https://example.com/guide" }).expect(201)).body.data;
  await owner.post(`/courses/${course.id}/publish`).expect(200);
  return { course, section, first, second };
}

beforeAll(async () => {
  await admin(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe" });
  prisma = createPrismaClient(url.href);
  await runSeed(prisma, {});
  storageDir = await mkdtemp(path.join(tmpdir(), "ieltiva-test-"));
  const logger = createLogger("silent");
  const tokens = createTokenService(env);
  const email: EmailProvider = {
    name: "memory",
    send: async (message) => {
      sent.push(message);
      return { delivered: true };
    },
  };
  const notifications = createNotificationService(prisma);
  const auth = createAuthService({ prisma, env, tokens, email, logger, notifyUser: notifications.notifyUser });
  const { authenticateUser } = createAuthMiddleware({ tokens, auth });
  const services = createPlatformServices({ prisma, env, email, logger, storage: new LocalPrivateStorage(storageDir), auth, notifications });
  app = createApp({
    env,
    logger,
    checkDatabase: async () => {},
    authRouter: createAuthRouter({ env, auth, tokens, google: null, limits }),
    platformRouter: createPlatformRouter(services, authenticateUser),
  });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(() => {
  sent.length = 0;
});

describe("authentication is required", () => {
  it.each([
    "/dashboard/student",
    "/dashboard/admin",
    "/users",
    "/roles",
    "/courses",
    "/modules",
    "/enrollments/me",
    "/progress/me",
    "/history/me",
    "/profile/me",
    "/profile/sessions",
    "/notifications",
    "/admin/audit-logs",
    "/planner/tasks",
  ])("GET %s without a session returns 401", async (route) => {
    await request(app).get(`${V1}${route}`).expect(401);
  });

  it("rejects writes without a CSRF token even with a session", async () => {
    const student = await person();
    await student.agent.patch(`${V1}/profile/me`).send({ firstName: "X" }).expect(403);
  });
});

describe("students are blocked from administration", () => {
  it.each([
    ["get", "/dashboard/admin"],
    ["get", "/dashboard/analytics"],
    ["get", "/users"],
    ["get", "/roles"],
    ["get", "/permissions"],
    ["get", "/enrollments"],
    ["get", "/admin/audit-logs"],
    ["get", "/admin/notifications"],
    ["get", "/admin/settings"],
  ] as const)("%s %s returns 403", async (_method, route) => {
    const student = await person();
    await student.get(route).expect(403);
  });

  it("blocks student writes to content, users and modules", async () => {
    const student = await person();
    const module = await generalModule();
    await student.post("/courses", { title: "Nope", moduleId: module.id }).expect(403);
    await student.post("/modules", { name: "Nope" }).expect(403);
    await student.post("/admin/notifications", { title: "Hello", body: "World", audience: "ALL" }).expect(403);
    await student.patch(`/users/${student.id}/status`, { status: "ACTIVE" }).expect(403);
    await student.patch(`/users/${student.id}/roles`, { roles: ["ADMIN"] }).expect(403);
  });

  it("doesn't let a user change their own role through the profile", async () => {
    const student = await person();
    await student.patch("/profile/me", { role: "ADMIN" }).expect(400);
    await student.patch("/profile/preferences", { roles: ["ADMIN"] }).expect(400);
    expect((await student.get("/profile/me")).body.data.roles.map((r: { code: string }) => r.code)).toEqual(["STUDENT"]);
  });
});

describe("student dashboard", () => {
  it("shows an honest empty state for a new student", async () => {
    const student = await person();
    const { data } = (await student.get("/dashboard/student").expect(200)).body;
    expect(data.stats).toMatchObject({ overallPercent: 0, completedActivities: 0, loggedMinutes: 0, streakDays: 0, enrolledCourses: 0 });
    expect(data.enrollments).toEqual([]);
    expect(data.profile.firstName).toBe("Test");
  });

  it("reflects real enrollment, progress and activity", async () => {
    const owner = await person("ADMIN");
    const { course, first, second } = await publishedCourse(owner);
    const student = await person();
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    await student.post("/progress", { resourceId: first.id, status: "COMPLETED", minutesSpent: 12 }).expect(200);

    let { data } = (await student.get("/dashboard/student")).body;
    expect(data.stats).toMatchObject({ overallPercent: 50, completedActivities: 1, loggedMinutes: 12, streakDays: 1, enrolledCourses: 1 });
    expect(data.enrollments[0].lastResource.id).toBe(first.id);
    expect(data.recentActivity.map((a: { eventType: string }) => a.eventType)).toContain("RESOURCE_COMPLETED");

    await student.post("/progress", { resourceId: second.id, status: "COMPLETED" }).expect(200);
    ({ data } = (await student.get("/dashboard/student")).body);
    expect(data.stats.overallPercent).toBe(100);
  });

  it("calculates a streak from consecutive days", () => {
    expect(calculateStreak([], "2026-11-04")).toBe(0);
    expect(calculateStreak(["2026-11-04", "2026-11-03", "2026-11-01"], "2026-11-04")).toBe(2);
    expect(calculateStreak(["2026-11-03", "2026-11-02"], "2026-11-04")).toBe(2);
    expect(calculateStreak(["2026-11-02"], "2026-11-04")).toBe(0);
  });

  it("creates one real reminder per day for a due study task", async () => {
    const student = await person();
    await student.post("/planner/tasks", { title: "Read a passage", scheduledDate: "2020-01-01" }).expect(201);
    await student.get("/dashboard/student").expect(200);
    await student.get("/dashboard/student").expect(200);
    const list = (await student.get("/notifications")).body.data as { title: string }[];
    expect(list.filter((n) => n.title === "Study tasks due")).toHaveLength(1);
  });
});

describe("admin dashboard", () => {
  it("returns database-backed metrics and analytics", async () => {
    const admin = await person("ADMIN");
    const before = (await admin.get("/dashboard/admin").expect(200)).body.data.metrics;
    await person();
    const after = (await admin.get("/dashboard/admin")).body.data.metrics;
    expect(after.totalUsers).toBe(before.totalUsers + 1);
    expect(after.students).toBe(before.students + 1);

    const today = new Date().toISOString().slice(0, 10);
    const analytics = (await admin.get(`/dashboard/analytics?from=${today}&to=${today}`).expect(200)).body.data;
    expect(analytics.registrations).toHaveLength(1);
    expect(analytics.registrations[0].count).toBeGreaterThan(0);
  });

  it("fills empty days with zero and rejects bad ranges", async () => {
    const admin = await person("ADMIN");
    const { data } = (await admin.get("/dashboard/analytics?from=2020-01-01&to=2020-01-03").expect(200)).body;
    expect(data.enrollments).toEqual([
      { day: "2020-01-01", count: 0 },
      { day: "2020-01-02", count: 0 },
      { day: "2020-01-03", count: 0 },
    ]);
    await admin.get("/dashboard/analytics?from=2020-01-03&to=2020-01-01").expect(400);
    await admin.get("/dashboard/analytics?from=2020-01-01&to=2023-01-01").expect(400);
  });
});

describe("user management", () => {
  it("lists with search, filters, sorting and pagination, without secrets", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    const res = await admin.get(`/users?search=${encodeURIComponent(target.email)}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe(target.email);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|argon2/);

    const paged = await admin.get("/users?page=1&pageSize=2&sort=email").expect(200);
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body.meta.pageSize).toBe(2);
    expect(paged.body.meta.total).toBeGreaterThan(2);
    expect(paged.body.data[0].email <= paged.body.data[1].email).toBe(true);

    const admins = await admin.get("/users?role=ADMIN&pageSize=100").expect(200);
    expect(admins.body.data.every((u: { roles: string[] }) => u.roles.includes("ADMIN"))).toBe(true);
    await admin.get("/users?pageSize=1000").expect(400);
    await admin.get("/users?sort=passwordHash").expect(400);
  });

  it("shows details without secrets, and rejects bad ids", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    const res = await admin.get(`/users/${target.id}`).expect(200);
    expect(res.body.data.learning).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2|tokenHash/);
    await admin.get("/users/not-a-uuid").expect(400);
    await admin.get("/users/00000000-0000-7000-8000-000000000000").expect(404);
  });

  it("updates permitted fields and audits them", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    const res = await admin.patch(`/users/${target.id}`, { firstName: "Renamed" }).expect(200);
    expect(res.body.data.firstName).toBe("Renamed");
    await admin.patch(`/users/${target.id}`, { email: "x@example.com" }).expect(400);
    expect(await prisma.auditLog.count({ where: { action: "user.update", entityId: target.id, actorId: admin.id } })).toBe(1);
  });

  it("suspending ends sessions immediately, and is audited and reversible", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    await target.get("/profile/me").expect(200);
    await admin.patch(`/users/${target.id}/status`, { status: "SUSPENDED", reason: "Testing" }).expect(200);
    await target.get("/profile/me").expect(401);
    expect(await prisma.userSession.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.status", entityId: target.id } });
    expect(log.after).toMatchObject({ status: "SUSPENDED" });
    await admin.patch(`/users/${target.id}/status`, { status: "ACTIVE" }).expect(200);
  });

  it("stops self-suspension and acting on someone with more authority", async () => {
    const admin = await person("ADMIN");
    const superAdmin = await person("SUPER_ADMIN");
    await admin.patch(`/users/${admin.id}/status`, { status: "SUSPENDED" }).expect(409);
    await admin.patch(`/users/${superAdmin.id}/status`, { status: "SUSPENDED" }).expect(403);
    await admin.patch(`/users/${superAdmin.id}`, { firstName: "Hacked" }).expect(403);
  });

  it("shows activity, with audit entries only for audit readers", async () => {
    const admin = await person("ADMIN");
    const editor = await person("EDITOR");
    const target = await person();
    await admin.patch(`/users/${target.id}`, { firstName: "Seen" }).expect(200);
    const res = await admin.get(`/users/${target.id}/activity`).expect(200);
    expect(res.body.data.auditEntries.length).toBeGreaterThan(0);
    await editor.get(`/users/${target.id}/activity`).expect(403);
  });
});

describe("roles and permissions", () => {
  it("lists roles and grouped permissions", async () => {
    const admin = await person("ADMIN");
    const roles = (await admin.get("/roles").expect(200)).body.data as { code: string; permissions: string[]; locked: boolean }[];
    expect(roles.map((r) => r.code)).toEqual(expect.arrayContaining(["STUDENT", "INSTRUCTOR", "ADMIN"]));
    expect(roles.find((r) => r.code === "SUPER_ADMIN")?.locked).toBe(true);
    const groups = (await admin.get("/permissions").expect(200)).body.data as { key: string; label: string }[];
    expect(groups.map((g) => g.label)).toEqual(expect.arrayContaining(["User management", "Role management", "Course management", "Audit log access", "Platform settings"]));
  });

  it("lets an admin assign roles within their authority, and audits it", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    const res = await admin.patch(`/users/${target.id}/roles`, { roles: ["STUDENT", "INSTRUCTOR"] }).expect(200);
    expect(res.body.data.roles).toEqual(["STUDENT", "INSTRUCTOR"]);
    expect(await prisma.auditLog.count({ where: { action: "user.roles", entityId: target.id } })).toBe(1);
    expect((await target.get("/notifications")).body.data.some((n: { title: string }) => n.title === "Your access changed")).toBe(true);
  });

  it("stops an admin granting more authority than they hold", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    await admin.patch(`/users/${target.id}/roles`, { roles: ["STUDENT", "SUPER_ADMIN"] }).expect(403);
    expect(await prisma.userRole.count({ where: { userId: target.id, role: { code: "SUPER_ADMIN" } } })).toBe(0);
  });

  it("stops self-promotion and removing your own admin access", async () => {
    const admin = await person("ADMIN");
    await admin.patch(`/users/${admin.id}/roles`, { roles: ["STUDENT", "ADMIN", "INSTRUCTOR"] }).expect(403);
    await admin.patch(`/users/${admin.id}/roles`, { roles: ["STUDENT"] }).expect(409);
    expect((await admin.get("/users?pageSize=1")).status).toBe(200);
  });

  it("protects the last super administrator", async () => {
    const superAdmin = await person("SUPER_ADMIN");
    await prisma.userRole.deleteMany({ where: { role: { code: "SUPER_ADMIN" }, userId: { not: superAdmin.id } } });
    const other = await person("SUPER_ADMIN");
    await superAdmin.patch(`/users/${other.id}/status`, { status: "SUSPENDED" }).expect(200);
    await other.get("/profile/me").expect(401);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    await prisma.userRole.create({ data: { userId: superAdmin.id, roleId: adminRole.id } });
    const refused = await superAdmin.patch(`/users/${superAdmin.id}/roles`, { roles: ["STUDENT", "ADMIN"] }).expect(409);
    expect(refused.body.message).toContain("no active super administrator");
    await superAdmin.patch(`/users/${other.id}/status`, { status: "ACTIVE" }).expect(200);
  });

  it("restricts changing role permissions to super administrators, within limits", async () => {
    const admin = await person("ADMIN");
    const superAdmin = await person("SUPER_ADMIN");
    const roles = (await superAdmin.get("/roles")).body.data as { id: string; code: string; permissions: string[] }[];
    const instructor = roles.find((r) => r.code === "INSTRUCTOR")!;
    const student = roles.find((r) => r.code === "STUDENT")!;
    const top = roles.find((r) => r.code === "SUPER_ADMIN")!;

    await admin.patch(`/roles/${instructor.id}/permissions`, { permissions: instructor.permissions }).expect(403);
    await superAdmin.patch(`/roles/${top.id}/permissions`, { permissions: [] }).expect(409);
    await superAdmin.patch(`/roles/${instructor.id}/permissions`, { permissions: ["roles.manage"] }).expect(403);
    await superAdmin.patch(`/roles/${student.id}/permissions`, { permissions: ["users.manage"] }).expect(403);
    await superAdmin.patch(`/roles/${instructor.id}/permissions`, { permissions: ["made.up"] }).expect(400);

    const updated = [...instructor.permissions, "enrollments.read"];
    const res = await superAdmin.patch(`/roles/${instructor.id}/permissions`, { permissions: updated }).expect(200);
    expect(res.body.data.permissions).toContain("enrollments.read");
    expect(await prisma.auditLog.count({ where: { action: "role.permissions", entityId: instructor.id } })).toBeGreaterThan(0);
    await superAdmin.patch(`/roles/${instructor.id}/permissions`, { permissions: instructor.permissions }).expect(200);
  });
});

describe("course management", () => {
  it("creates a draft, invisible to students, with audit", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const module = await generalModule();
    const course = (await admin.post("/courses", { title: "Writing Task 2 basics", moduleId: module.id, difficulty: "BEGINNER", examType: "ACADEMIC", learningObjectives: ["Plan"], estimatedMinutes: 90 }).expect(201)).body.data;
    expect(course.status).toBe("DRAFT");
    expect(course.slug).toBe("writing-task-2-basics");
    await student.get(`/courses/${course.id}`).expect(404);
    expect(await prisma.auditLog.count({ where: { action: "course.create", entityId: course.id } })).toBe(1);
  });

  it("rejects duplicate slugs, unsafe thumbnails and script text", async () => {
    const admin = await person("ADMIN");
    const module = await generalModule();
    const slug = `unique-${Date.now()}`;
    await admin.post("/courses", { title: "First", slug, moduleId: module.id }).expect(201);
    await admin.post("/courses", { title: "Second", slug, moduleId: module.id }).expect(409);
    await admin.post("/courses", { title: "Bad", moduleId: module.id, thumbnailUrl: "javascript:alert(1)" }).expect(400);
    await admin.post("/courses", { title: "Bad", moduleId: module.id, thumbnailUrl: "http://example.com/x.png" }).expect(400);
    await admin.post("/courses", { title: "<script>x</script>", moduleId: module.id }).expect(400);
  });

  it("refuses to publish incomplete content, then publishes with history", async () => {
    const admin = await person("ADMIN");
    const module = await generalModule();
    const course = (await admin.post("/courses", { title: "Incomplete", moduleId: module.id }).expect(201)).body.data;
    const failed = await admin.post(`/courses/${course.id}/publish`).expect(400);
    expect(failed.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["description", "learningObjectives", "sections"]));

    const { course: done } = await publishedCourse(admin);
    const history = (await admin.get(`/courses/${done.id}/history`).expect(200)).body.data;
    expect(history[0]).toMatchObject({ action: "PUBLISHED", toStatus: "PUBLISHED" });
    expect(history[0].actorName).toBeTruthy();
  });

  it("records changes to published content rather than changing it silently", async () => {
    const admin = await person("ADMIN");
    const { course, first } = await publishedCourse(admin);
    await admin.patch(`/resources/${first.id}`, { body: "Updated text" }).expect(200);
    await admin.patch(`/courses/${course.id}`, { title: "New title" }).expect(200);
    const history = (await admin.get(`/courses/${course.id}/history`)).body.data as { action: string; note: string }[];
    expect(history.filter((h) => h.action === "CONTENT_UPDATED").map((h) => h.note)).toEqual(expect.arrayContaining(["Resource updated: Lesson one", "Course details updated"]));
  });

  it("protects courses students use from deletion and unpublishing", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course } = await publishedCourse(admin);
    await admin.del(`/courses/${course.id}`).expect(409);
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    await admin.post(`/courses/${course.id}/unpublish`).expect(409);
    await admin.post(`/courses/${course.id}/archive`).expect(200);
    await admin.del(`/courses/${course.id}`).expect(409);
    // Enrolled students keep access to an archived course.
    await student.get(`/courses/${course.id}`).expect(200);
    const outsider = await person();
    await outsider.get(`/courses/${course.id}`).expect(404);
    await outsider.post("/enrollments", { courseId: course.id }).expect(404);
  });

  it("lets a draft be deleted softly", async () => {
    const admin = await person("ADMIN");
    const module = await generalModule();
    const course = (await admin.post("/courses", { title: "Temporary", moduleId: module.id }).expect(201)).body.data;
    await admin.del(`/courses/${course.id}`).expect(200);
    await admin.get(`/courses/${course.id}`).expect(404);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).deletedAt).not.toBeNull();
  });

  it("confines instructors to their own courses", async () => {
    const instructor = await person("INSTRUCTOR");
    const other = await person("INSTRUCTOR");
    const admin = await person("ADMIN");
    const module = await generalModule();
    const mine = (await instructor.post("/courses", { title: "Mine", moduleId: module.id, instructorId: admin.id }).expect(201)).body.data;
    expect(mine.instructor.id).toBe(instructor.id);
    await other.patch(`/courses/${mine.id}`, { title: "Stolen" }).expect(403);
    await other.post(`/courses/${mine.id}/publish`).expect(403);
    await other.post(`/courses/${mine.id}/sections`, { title: "Nope" }).expect(403);
    await other.get(`/courses/${mine.id}`).expect(404);
    await instructor.patch(`/courses/${mine.id}`, { instructorId: other.id }).expect(403);
    const managed = (await other.get("/courses?scope=manage")).body.data as { id: string }[];
    expect(managed.some((c) => c.id === mine.id)).toBe(false);
    // Instructors have no administrative access.
    await instructor.get("/users").expect(403);
    await instructor.get("/admin/audit-logs").expect(403);
    await instructor.post("/modules", { name: "Nope" }).expect(403);
  });

  it("filters, searches and paginates the catalog, showing only published courses", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const module = await generalModule();
    const tag = `Zebra${Date.now()}`;
    await publishedCourse(admin, { title: `${tag} Academic`, examType: "ACADEMIC" });
    await publishedCourse(admin, { title: `${tag} General`, examType: "GENERAL_TRAINING" });
    await admin.post("/courses", { title: `${tag} Draft`, moduleId: module.id }).expect(201);
    expect((await student.get(`/courses?search=${tag}`)).body.meta.total).toBe(2);
    expect((await student.get(`/courses?search=${tag}&examType=ACADEMIC`)).body.data).toHaveLength(1);
    expect((await student.get(`/courses?search=${tag}&pageSize=1`)).body.data).toHaveLength(1);
    await student.get("/courses?scope=manage").expect(403);
  });
});

describe("sections and resources", () => {
  it("reorders sections and hides invisible ones from students", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course, section } = await publishedCourse(admin);
    const extra = (await admin.post(`/courses/${course.id}/sections`, { title: "Second" }).expect(201)).body.data;
    await admin.patch(`/sections/${extra.id}`, { position: 1 }).expect(200);
    const order = (await admin.get(`/courses/${course.id}/sections`)).body.data as { id: string }[];
    expect(order.map((s) => s.id)).toEqual([extra.id, section.id]);

    await admin.patch(`/sections/${extra.id}`, { isVisible: false }).expect(200);
    expect((await student.get(`/courses/${course.id}/sections`)).body.data).toHaveLength(1);
    await admin.del(`/sections/${extra.id}`).expect(200);
    expect((await admin.get(`/courses/${course.id}/sections`)).body.data).toHaveLength(1);
  });

  it("validates resource types and never returns storage keys", async () => {
    const admin = await person("ADMIN");
    const { section, first } = await publishedCourse(admin);
    await admin.post(`/sections/${section.id}/resources`, { type: "VIDEO", title: "No link" }).expect(400);
    await admin.post(`/sections/${section.id}/resources`, { type: "ARTICLE", title: "No body" }).expect(400);
    await admin.post(`/sections/${section.id}/resources`, { type: "EXTERNAL_LINK", title: "Unsafe", externalUrl: "javascript:alert(1)" }).expect(400);
    await admin.post(`/sections/${section.id}/resources`, { type: "ARTICLE", title: "Sneaky", body: "x", storageKey: "secret/key" }).expect(400);
    await prisma.learningResource.update({ where: { id: first.id }, data: { storageKey: "private/secret-key.pdf" } });
    const res = await admin.get(`/resources/${first.id}`).expect(200);
    expect(JSON.stringify(res.body)).not.toContain("private/secret-key");
  });

  it("keeps resource content from people who aren't enrolled", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course, first, second } = await publishedCourse(admin);
    await student.get(`/resources/${first.id}`).expect(403);
    const detail = (await student.get(`/courses/${course.id}`)).body.data;
    expect(JSON.stringify(detail)).not.toContain("Lesson text");
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    const lesson = (await student.get(`/resources/${first.id}`).expect(200)).body.data;
    expect(lesson.body).toBe("Lesson text");
    expect(lesson.nextId).toBe(second.id);
  });
});

describe("learning modules", () => {
  it("runs the draft, publish and archive workflow with history", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const created = (await admin.post("/modules", { name: "Advanced grammar", skill: "WRITING", examType: "ACADEMIC", difficulty: "ADVANCED", estimatedMinutes: 300, position: 9 }).expect(201)).body.data;
    expect(created.status).toBe("DRAFT");
    await student.get(`/modules/${created.id}`).expect(404);
    await admin.post(`/modules/${created.id}/publish`).expect(400);
    await admin.patch(`/modules/${created.id}`, { description: "Grammar for high bands." }).expect(200);
    await admin.post(`/modules/${created.id}/publish`).expect(200);
    await student.get(`/modules/${created.id}`).expect(200);
    await admin.post(`/modules/${created.id}/archive`).expect(200);
    await student.get(`/modules/${created.id}`).expect(404);
    expect(await prisma.contentPublicationHistory.count({ where: { moduleId: created.id } })).toBeGreaterThanOrEqual(2);
  });

  it("won't archive a module published courses use", async () => {
    const admin = await person("ADMIN");
    const created = (await admin.post("/modules", { name: "In use", description: "A module with courses." }).expect(201)).body.data;
    await admin.post(`/modules/${created.id}/publish`).expect(200);
    await publishedCourse(admin, { moduleId: created.id });
    await admin.post(`/modules/${created.id}/archive`).expect(409);
  });
});

describe("enrollment and progress", () => {
  it("enrolls once, notifies, and can re-enroll after canceling", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course } = await publishedCourse(admin);
    const enrollment = (await student.post("/enrollments", { courseId: course.id }).expect(201)).body.data;
    await student.post("/enrollments", { courseId: course.id }).expect(409);
    expect((await student.get("/notifications")).body.data.some((n: { title: string }) => n.title === "Enrollment confirmed")).toBe(true);
    await student.patch(`/enrollments/${enrollment.id}`, { status: "CANCELED" }).expect(200);
    await student.patch(`/enrollments/${enrollment.id}`, { status: "ACTIVE" }).expect(403);
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    expect(await prisma.userEnrollment.count({ where: { userId: student.id, courseId: course.id } })).toBe(1);
  });

  it("blocks premium courses until an entitlement exists", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course } = await publishedCourse(admin, { isPremium: true });
    expect((await student.get(`/courses/${course.id}`)).body.data.locked).toBe(true);
    const denied = await student.post("/enrollments", { courseId: course.id }).expect(403);
    expect(denied.body.error.code).toBe("ENTITLEMENT_REQUIRED");
    await prisma.userEntitlement.create({ data: { userId: student.id, featureKey: "practice_pass", endsAt: new Date(Date.now() + 60_000) } });
    await student.post("/enrollments", { courseId: course.id }).expect(201);
  });

  it("stores progress, never regresses, and completes the course", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course, first, second } = await publishedCourse(admin);
    await student.post("/progress", { resourceId: first.id, status: "COMPLETED" }).expect(403);
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    await student.post("/progress", { resourceId: first.id, status: "IN_PROGRESS" }).expect(200);
    let result = (await student.post("/progress", { resourceId: first.id, status: "COMPLETED", minutesSpent: 5 }).expect(200)).body.data;
    expect(result.progress).toMatchObject({ total: 2, completed: 1, percent: 50 });
    result = (await student.post("/progress", { resourceId: first.id, status: "IN_PROGRESS" }).expect(200)).body.data;
    expect(result.status).toBe("COMPLETED");
    result = (await student.post("/progress", { resourceId: second.id, status: "COMPLETED" }).expect(200)).body.data;
    expect(result.courseCompleted).toBe(true);
    const enrollment = await prisma.userEnrollment.findFirstOrThrow({ where: { userId: student.id, courseId: course.id } });
    expect(enrollment.status).toBe("COMPLETED");
    expect(enrollment.lastResourceId).toBe(second.id);
    await student.post("/progress", { resourceId: first.id, status: "COMPLETED", minutesSpent: 9999 }).expect(400);

    const mine = (await student.get("/progress/me").expect(200)).body.data;
    expect(mine[0].progress.percent).toBe(100);
    const history = (await student.get("/history/me").expect(200)).body.data as { eventType: string }[];
    expect(history.map((h) => h.eventType)).toEqual(expect.arrayContaining(["ENROLLED", "RESOURCE_COMPLETED", "COURSE_COMPLETED"]));
  });

  it("keeps each student's enrollments and history private", async () => {
    const admin = await person("ADMIN");
    const a = await person();
    const b = await person();
    const { course } = await publishedCourse(admin);
    const enrollment = (await a.post("/enrollments", { courseId: course.id }).expect(201)).body.data;
    await b.get(`/enrollments/${enrollment.id}`).expect(404);
    await b.patch(`/enrollments/${enrollment.id}`, { status: "CANCELED" }).expect(404);
    expect((await b.get("/enrollments/me")).body.data).toEqual([]);
    expect((await b.get("/history/me")).body.data).toEqual([]);
    await admin.get(`/enrollments/${enrollment.id}`).expect(200);
    await admin.patch(`/enrollments/${enrollment.id}`, { status: "CANCELED" }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: "enrollment.status", entityId: enrollment.id } })).toBe(1);
  });

  it("lists enrollments for administrators with filters", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course } = await publishedCourse(admin);
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    const res = await admin.get(`/enrollments?courseId=${course.id}&status=ACTIVE`).expect(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].user.email).toBe(student.email);
  });
});

describe("study planner", () => {
  it("keeps tasks private to their owner", async () => {
    const a = await person();
    const b = await person();
    const task = (await a.post("/planner/tasks", { title: "Practise", scheduledDate: "2030-01-01", skill: "READING" }).expect(201)).body.data;
    await b.patch(`/planner/tasks/${task.id}`, { completed: true }).expect(404);
    await b.del(`/planner/tasks/${task.id}`).expect(404);
    const done = (await a.patch(`/planner/tasks/${task.id}`, { completed: true }).expect(200)).body.data;
    expect(done.completedAt).not.toBeNull();
    await a.del(`/planner/tasks/${task.id}`).expect(200);
  });
});

describe("profile and settings", () => {
  it("updates permitted fields and preferences, and validates them", async () => {
    const student = await person();
    await student.patch("/profile/me", { firstName: "Ayesha", lastName: "Rahman" }).expect(200);
    const res = await student.patch("/profile/preferences", {
      examType: "ACADEMIC",
      targetBand: 7.5,
      examDate: "2030-06-01",
      preferredSkills: ["WRITING"],
      timezone: "Asia/Dhaka",
      dailyGoalMinutes: 30,
      notificationPrefs: { learning: false, announcements: true },
    }).expect(200);
    expect(res.body.data).toMatchObject({ firstName: "Ayesha", examType: "ACADEMIC", targetBand: 7.5, examDate: "2030-06-01", timezone: "Asia/Dhaka", notificationPrefs: { learning: false } });
    await student.patch("/profile/preferences", { targetBand: 7.3 }).expect(400);
    await student.patch("/profile/preferences", { timezone: "Mars/Olympus" }).expect(400);
    await student.patch("/profile/preferences", { locale: "xx" }).expect(400);
    expect(JSON.stringify((await student.get("/profile/me")).body)).not.toMatch(/argon2|passwordHash/);
  });

  it("respects learning notification preferences, but not for security messages", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const { course } = await publishedCourse(admin);
    await student.patch("/profile/preferences", { notificationPrefs: { learning: false, announcements: true } }).expect(200);
    await student.post("/enrollments", { courseId: course.id }).expect(201);
    await admin.patch(`/users/${student.id}/roles`, { roles: ["STUDENT", "INSTRUCTOR"] }).expect(200);
    const titles = ((await student.get("/notifications?pageSize=100")).body.data as { title: string }[]).map((n) => n.title);
    expect(titles).not.toContain("Enrollment confirmed");
    expect(titles).toContain("Your access changed");
  });

  it("accepts only real images for profile photos", async () => {
    const student = await person();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const upload = (data: Buffer, type: string) => student.put("put", "/profile/photo").set("Content-Type", type).send(data);
    await upload(Buffer.from("<svg onload=alert(1)></svg>"), "image/png").expect(400);
    await upload(Buffer.from("<script>alert(1)</script>"), "image/jpeg").expect(400);
    await upload(Buffer.alloc(2_200_000), "image/png").expect(413);
    const res = await upload(png, "image/png").expect(200);
    expect(res.body.data.hasPhoto).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("avatars/");
    const photo = await student.get("/profile/photo").expect(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    await request(app).get(`${V1}/profile/photo`).expect(401);
    await student.del("/profile/photo").expect(200);
    await student.get("/profile/photo").expect(404);
  });

  it("changes a password with the current one, ending other sessions", async () => {
    const student = await person();
    const other = request.agent(app);
    const csrf = (await other.get(`${V1}/auth/csrf`)).body.data.csrfToken;
    await other.post(`${V1}/auth/login`).set("X-CSRF-Token", csrf).send({ email: student.email, password: PASSWORD }).expect(200);
    const next = "N3w-Strong-Secret";
    await student.post("/profile/password", { currentPassword: "wrong", newPassword: next, confirmPassword: next }).expect(400);
    await student.post("/profile/password", { currentPassword: PASSWORD, newPassword: "weak", confirmPassword: "weak" }).expect(400);
    await student.post("/profile/password", { currentPassword: PASSWORD, newPassword: next, confirmPassword: next }).expect(200);
    await student.get("/profile/me").expect(200);
    await other.get(`${V1}/profile/me`).expect(401);
    expect(await prisma.auditLog.count({ where: { action: "user.password_change", entityId: student.id } })).toBe(1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.password_change", entityId: student.id } });
    expect(JSON.stringify(log)).not.toContain(next);
  });

  it("changes email only after the new address confirms, without revealing taken addresses", async () => {
    const student = await person();
    const other = await person();
    const newEmail = `moved-${Date.now()}@example.com`;
    await student.post("/profile/email", { newEmail, currentPassword: "wrong" }).expect(400);
    sent.length = 0;
    const taken = await student.post("/profile/email", { newEmail: other.email, currentPassword: PASSWORD }).expect(202);
    expect(sent).toHaveLength(0);
    const ok = await student.post("/profile/email", { newEmail, currentPassword: PASSWORD }).expect(202);
    expect(ok.body.message).toBe(taken.body.message);
    expect((await student.get("/profile/me")).body.data.email).toBe(student.email);
    expect(sent[0]!.to).toBe(newEmail);
    const token = sent[0]!.text.match(/token=([\w-]+)/)![1]!;
    await student.post("/auth/verify-email", { token }).expect(200);
    expect((await student.get("/profile/me")).body.data.email).toBe(newEmail);
    await student.post("/auth/verify-email", { token }).expect(400);
  });

  it("lists own sessions without tokens, and ends specific or all other sessions", async () => {
    const student = await person();
    const other = request.agent(app);
    const csrf = (await other.get(`${V1}/auth/csrf`)).body.data.csrfToken;
    await other.post(`${V1}/auth/login`).set("X-CSRF-Token", csrf).set("User-Agent", "Second device").send({ email: student.email, password: PASSWORD }).expect(200);
    const sessions = (await student.get("/profile/sessions").expect(200)).body.data as { id: string; current: boolean; userAgent: string }[];
    expect(sessions).toHaveLength(2);
    expect(JSON.stringify(sessions)).not.toMatch(/tokenHash|eyJ/);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const second = sessions.find((s) => !s.current)!;

    const stranger = await person();
    await stranger.del(`/profile/sessions/${second.id}`).expect(404);
    await student.del(`/profile/sessions/${second.id}`).expect(200);
    await other.get(`${V1}/profile/me`).expect(401);

    await student.post("/auth/login", { email: student.email, password: PASSWORD }).expect(200);
    const result = await student.del("/profile/sessions").expect(200);
    expect(result.body.data.revoked).toBeGreaterThan(0);
    await student.get("/profile/me").expect(200);
  });
});

describe("notifications", () => {
  it("sends a welcome message, and supports read, read-all and dismiss", async () => {
    const student = await person();
    const list = (await student.get("/notifications").expect(200)).body;
    const welcome = list.data.find((n: { title: string }) => n.title === "Welcome to IELTiva");
    expect(welcome).toBeDefined();
    expect((await student.get("/notifications/unread-count")).body.data.count).toBeGreaterThan(0);
    await student.patch(`/notifications/${welcome.id}/read`).expect(200);
    expect((await student.get("/notifications?unread=true")).body.data.some((n: { id: string }) => n.id === welcome.id)).toBe(false);
    await student.patch("/notifications/read-all").expect(200);
    expect((await student.get("/notifications/unread-count")).body.data.count).toBe(0);
    await student.del(`/notifications/${welcome.id}`).expect(200);
    expect((await student.get("/notifications")).body.data.some((n: { id: string }) => n.id === welcome.id)).toBe(false);
    await student.del(`/notifications/${welcome.id}`).expect(404);
  });

  it("keeps notifications private", async () => {
    const a = await person();
    const b = await person();
    const id = (await a.get("/notifications")).body.data[0].id;
    await b.patch(`/notifications/${id}/read`).expect(404);
    await b.del(`/notifications/${id}`).expect(404);
  });

  it("targets announcements by role, supports drafts, and respects expiry and preferences", async () => {
    const admin = await person("ADMIN");
    const student = await person();
    const instructor = await person("INSTRUCTOR");
    const muted = await person();
    await muted.patch("/profile/preferences", { notificationPrefs: { learning: true, announcements: false } }).expect(200);
    const title = `Maintenance ${Date.now()}`;
    await admin.post("/admin/notifications", { title, body: "Tonight.", audience: "ROLE" }).expect(400);
    const draft = (await admin.post("/admin/notifications", { title, body: "Tonight.", audience: "ROLE", audienceRole: "INSTRUCTOR", publish: false }).expect(201)).body.data;
    const has = async (p: Person) => ((await p.get("/notifications?type=ANNOUNCEMENT")).body.data as { title: string }[]).some((n) => n.title === title);
    expect(await has(instructor)).toBe(false);
    await admin.post(`/admin/notifications/${draft.id}/publish`).expect(200);
    expect(await has(instructor)).toBe(true);
    expect(await has(student)).toBe(false);
    await admin.post(`/admin/notifications/${draft.id}/publish`).expect(409);

    const everyone = `Everyone ${Date.now()}`;
    await admin.post("/admin/notifications", { title: everyone, body: "Hello all.", audience: "ALL", expiresAt: new Date(Date.now() + 60_000).toISOString() }).expect(201);
    const hasEveryone = async (p: Person) => ((await p.get("/notifications")).body.data as { title: string }[]).some((n) => n.title === everyone);
    expect(await hasEveryone(student)).toBe(true);
    expect(await hasEveryone(muted)).toBe(false);
    await prisma.notification.updateMany({ where: { title: everyone }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await hasEveryone(student)).toBe(false);
    await admin.post("/admin/notifications", { title: "Late", body: "Too late.", audience: "ALL", expiresAt: "2020-01-01T00:00:00Z" }).expect(400);
    expect((await admin.get("/admin/notifications")).body.meta.total).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "announcement.publish", entityId: draft.id } })).toBe(1);
  });

  it("tells students about a newly published course once", async () => {
    const admin = await person("ADMIN");
    const earlier = await person();
    const second = await publishedCourse(admin);
    const list = (await earlier.get("/notifications?pageSize=100")).body.data as { link: string }[];
    expect(list.filter((n) => n.link === `/courses/${second.course.id}`)).toHaveLength(1);
    await admin.post(`/courses/${second.course.id}/archive`).expect(200);
    await admin.post(`/courses/${second.course.id}/publish`).expect(200);
    expect(((await earlier.get("/notifications?pageSize=100")).body.data as { link: string }[]).filter((n) => n.link === `/courses/${second.course.id}`)).toHaveLength(1);
  });
});

describe("audit logs and settings", () => {
  it("filters and paginates, and offers no way to edit", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    await admin.patch(`/users/${target.id}`, { firstName: "Audited" }).expect(200);
    const res = await admin.get(`/admin/audit-logs?action=user.update&actorId=${admin.id}&pageSize=5`).expect(200);
    expect(res.body.data[0]).toMatchObject({ action: "user.update", entityType: "User", entityId: target.id, actor: { email: admin.email } });
    const id = res.body.data[0].id;
    await admin.patch(`/admin/audit-logs/${id}`, { action: "changed" }).expect(404);
    await admin.del(`/admin/audit-logs/${id}`).expect(404);
  });

  it("blocks audit edits in the database too, while allowing actor removal", async () => {
    const admin = await person("ADMIN");
    const target = await person();
    await admin.patch(`/users/${target.id}`, { firstName: "Protected" }).expect(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { actorId: admin.id } });
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "tampered" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/cannot be deleted/);
    await prisma.userRole.deleteMany({ where: { userId: admin.id } });
    await prisma.user.delete({ where: { id: admin.id } });
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })).actorId).toBeNull();
  });

  it("removes secrets from audit values", () => {
    expect(sanitizeAuditValue({ title: "x", password: "p", nested: { refreshToken: "t", ok: 1 } })).toEqual({ title: "x", nested: { ok: 1 } });
  });

  it("restricts settings changes and validates values", async () => {
    const admin = await person("ADMIN");
    const superAdmin = await person("SUPER_ADMIN");
    const list = (await admin.get("/admin/settings").expect(200)).body.data as { key: string }[];
    expect(list.map((s) => s.key)).toContain("retention.speaking_recordings_days");
    expect(list.map((s) => s.key)).not.toContain("seed.role_mapping_version");
    await admin.patch("/admin/settings/retention.speaking_recordings_days", { value: 30 }).expect(403);
    await superAdmin.patch("/admin/settings/retention.speaking_recordings_days", { value: -1 }).expect(400);
    await superAdmin.patch("/admin/settings/unknown.key", { value: 1 }).expect(404);
    await superAdmin.patch("/admin/settings/retention.speaking_recordings_days", { value: 30 }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: "setting.update" } })).toBeGreaterThan(0);
  });
});
