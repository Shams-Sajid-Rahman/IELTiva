import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib.js";
import { createApp } from "../src/app.js";
import { createPrismaClient } from "../src/config/database.js";
import { createAuthMiddleware } from "../src/middleware/authenticate.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createPlatformRouter } from "../src/routes/platform.routes.js";
import { createAuthService } from "../src/services/auth.service.js";
import type { EmailProvider } from "../src/services/email/email.provider.js";
import { createNotificationService, createPlatformServices } from "../src/services/platform.js";
import { LocalPrivateStorage } from "../src/services/storage/private-storage.js";
import { createTokenService } from "../src/services/token.service.js";
import { createLogger } from "../src/utils/logger.js";
import { testEnv } from "./helpers.js";

const apiRoot = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.resolve(apiRoot, "../../.env"), quiet: true });

// Runs in a new database, created and dropped here. No other database is touched.
const dbName = `ieltiva_exam_disposable_${Date.now()}`;
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
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(40)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);

let prisma: ReturnType<typeof createPrismaClient>;
let app: ReturnType<typeof createApp>;
let storageDir: string;
let counter = 0;

type Person = Awaited<ReturnType<typeof person>>;

async function person(role?: string) {
  const agent = request.agent(app);
  const csrf = (await agent.get(`${V1}/auth/csrf`)).body.data.csrfToken as string;
  const email = `exam${++counter}-${Date.now()}@example.com`;
  const write = (method: "post" | "patch" | "delete" | "put", route: string) => agent[method](`${V1}${route}`).set("X-CSRF-Token", csrf);
  await write("post", "/auth/register").send({ firstName: "Test", lastName: `User${counter}`, email, password: PASSWORD, confirmPassword: PASSWORD, termsAccepted: true }).expect(201);
  await write("post", "/auth/login").send({ email, password: PASSWORD }).expect(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (role) {
    const found = await prisma.role.findUniqueOrThrow({ where: { code: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: found.id } });
  }
  return {
    id: user.id,
    agent,
    get: (route: string) => agent.get(`${V1}${route}`),
    post: (route: string, body: object = {}) => write("post", route).send(body),
    patch: (route: string, body: object = {}) => write("patch", route).send(body),
    put: (route: string, body: object = {}) => write("put", route).send(body),
    del: (route: string) => write("delete", route).send({}),
    upload: (route: string, data: Buffer) => write("put", route).set("Content-Type", "application/octet-stream").send(data),
  };
}

let author: Person;
let student: Person;
let other: Person;

async function draftExam(title: string, options: object = {}) {
  const exam = (await author.post("/admin/exams", { title, ...options }).expect(201)).body.data;
  return { examId: exam.id as string, versionId: exam.versions[0].id as string };
}

/** Reading with typed and choice questions, marked out of 4. */
async function readingExam(title = `Reading ${++counter}`, options: object = {}, durationSeconds = 600) {
  const { examId, versionId } = await draftExam(title, options);
  const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "Passage one", durationSeconds }).expect(201)).body.data;
  await author.post(`/admin/exam-sections/${section.id}/passages`, { title: "Rooftops", body: "Secret passage text about rooftops." }).expect(201);
  const tfng = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "TRUE_FALSE_NOT_GIVEN" }).expect(201)).body.data;
  await author.post(`/admin/question-groups/${tfng.id}/questions`, { number: 1, prompt: "Roofs were gardens.", explanation: "EXPLANATION-ONE", answers: [{ acceptedValue: "FALSE" }] }).expect(201);
  const typed = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "SENTENCE_COMPLETION" }).expect(201)).body.data;
  const q2 = (await author.post(`/admin/question-groups/${typed.id}/questions`, { number: 2, prompt: "Cost is ____.", answers: [{ acceptedValue: "SECRETANSWER", maxWords: 2 }, { acceptedValue: "secret alt" }] }).expect(201)).body.data;
  const multi = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "MULTIPLE_CHOICE_MULTI" }).expect(201)).body.data;
  await author.post(`/admin/question-groups/${multi.id}/questions`, { number: 3, marks: 2, scoringMode: "PER_ITEM", prompt: "Choose two.", options: [{ label: "A", body: "One" }, { label: "B", body: "Two" }, { label: "C", body: "Three" }], answers: [{ acceptedValue: "A" }, { acceptedValue: "C" }] }).expect(201);
  await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
  return { examId, versionId, sectionId: section.id as string, q2Id: q2.id as string };
}

const questionIds = async (user: Person, attemptId: string, sectionId: string) => {
  const view = (await user.get(`/attempts/${attemptId}/sections/${sectionId}`).expect(200)).body.data;
  return view.section.questionGroups.flatMap((group: { questions: { id: string; number: number }[] }) => group.questions) as { id: string; number: number }[];
};

async function startReading(user: Person, exam: { examId: string; sectionId: string }, mode = "TIMED") {
  const attempt = (await user.post(`/exams/${exam.examId}/attempts`, { mode }).expect(201)).body.data;
  await user.post(`/attempts/${attempt.id}/sections/${exam.sectionId}/start`).expect(200);
  return attempt.id as string;
}

beforeAll(async () => {
  await admin(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe" });
  prisma = createPrismaClient(url.href);
  await runSeed(prisma, {});
  storageDir = await mkdtemp(path.join(tmpdir(), "ieltiva-exam-"));
  const logger = createLogger("silent");
  const tokens = createTokenService(env);
  const email: EmailProvider = { name: "memory", send: async () => ({ delivered: true }) };
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
  author = await person("ADMIN");
  student = await person();
  other = await person();
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

describe("database time", () => {
  it("stores the true time, whatever timezone the database server uses", async () => {
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone TO 'Asia/Dhaka'`);
    const fresh = createPrismaClient(url.href);
    try {
      const row = await fresh.appMetadata.upsert({ where: { key: "time-check" }, create: { key: "time-check", value: "x" }, update: { value: "y" } });
      const rows = await fresh.$queryRaw<{ drift: number }[]>`SELECT abs(extract(epoch FROM (now() - updated_at)))::float AS drift FROM app_metadata WHERE key = 'time-check'`;
      expect(rows[0]!.drift).toBeLessThan(60);
      expect(Math.abs(row.updatedAt.getTime() - Date.now())).toBeLessThan(60_000);
    } finally {
      await fresh.$disconnect();
    }
  });
});

describe("answer key secrecy", () => {
  it("never sends keys, explanations or transcripts before submission", async () => {
    const exam = await readingExam();
    const summary = JSON.stringify((await student.get(`/exams/${exam.examId}`).expect(200)).body);
    expect(summary).not.toContain("Secret passage");
    const attemptId = await startReading(student, exam);
    const body = JSON.stringify((await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`).expect(200)).body);
    expect(body).toContain("Roofs were gardens");
    for (const secret of ["SECRETANSWER", "secret alt", "EXPLANATION-ONE", "acceptedValue", "explanation", "isCorrect", "storageKey", "imageStorageKey"]) expect(body).not.toContain(secret);
    await student.get(`/attempts/${attemptId}/result`).expect(409);
  });
});

describe("marking and results", () => {
  it("marks on the server with normalization, partial credit and raw scores only", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1, q2, q3] = await questionIds(student, attemptId, exam.sectionId);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, {
      answers: [
        { questionId: q1!.id, response: { selected: ["FALSE"] } },
        { questionId: q2!.id, response: { text: "  SECRET   Alt. " } },
        { questionId: q3!.id, response: { selected: ["A", "B"] } },
      ],
    }).expect(200);
    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    const result = (await student.get(`/attempts/${attemptId}/result`).expect(200)).body.data;
    expect(result.rawScore).toBe(3);
    expect(result.maxScore).toBe(4);
    expect(result.sections[0].rawScore).toBe(3);
    expect(result.sections[0].review[0].explanation).toBe("EXPLANATION-ONE");
    expect(result.sections[0].review[1].acceptedAnswers).toContain("SECRETANSWER");
    expect(result.sections[0].review[2].marksAwarded).toBe(1);
    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(stored.overallBand).toBeNull();
    expect(stored.bandTableVersion).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/"(overallBand|bandScore)":\s*\d/);
  });

  it("ignores any correctness the client claims", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1] = await questionIds(student, attemptId, exam.sectionId);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1!.id, response: { selected: ["TRUE"] }, isCorrect: true }] }).expect(400);
  });

  it("hides the review when the exam's policy says so", async () => {
    const { examId, versionId } = await draftExam(`No review ${++counter}`);
    await author.patch(`/admin/exam-versions/${versionId}`, { settings: { reviewPolicy: "NEVER" } }).expect(200);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "One", durationSeconds: 600 })).body.data;
    await author.post(`/admin/exam-sections/${section.id}/passages`, { title: "Passage", body: "Text" });
    const group = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "SHORT_ANSWER" })).body.data;
    await author.post(`/admin/question-groups/${group.id}/questions`, { number: 1, answers: [{ acceptedValue: "x" }] });
    await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
    const attemptId = await startReading(student, { examId, sectionId: section.id });
    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    const result = (await student.get(`/attempts/${attemptId}/result`).expect(200)).body.data;
    expect(result.reviewAllowed).toBe(false);
    expect(result.sections[0].review).toBeUndefined();
    expect(result.sections[0].rawScore).toBe(0);
  });
});

describe("autosave and resume", () => {
  it("restores saved answers and flags, and keeps the same deadline", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const first = (await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`)).body.data;
    const [q1] = first.section.questionGroups[0].questions;
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1.id, response: { selected: ["TRUE"] }, isFlagged: true }] }).expect(200);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1.id, response: { selected: ["FALSE"] } }] }).expect(200);
    const resumed = (await student.post(`/attempts/${attemptId}/sections/${exam.sectionId}/start`).expect(200)).body.data;
    expect(resumed.expiresAt).toBe(first.expiresAt);
    expect(resumed.responses).toEqual([{ questionId: q1.id, response: { selected: ["FALSE"] }, isFlagged: true }]);
    expect(resumed.lastSavedAt).toBeTruthy();
    expect(new Date(resumed.serverTime).getTime()).toBeLessThan(new Date(resumed.expiresAt).getTime());
  });

  it("returns the existing attempt instead of starting another", async () => {
    const exam = await readingExam();
    const a = (await student.post(`/exams/${exam.examId}/attempts`, {}).expect(201)).body.data;
    const b = (await student.post(`/exams/${exam.examId}/attempts`, {}).expect(201)).body.data;
    expect(b.id).toBe(a.id);
  });

  it("refuses a question from another section", async () => {
    const one = await readingExam();
    const two = await readingExam();
    const attemptOne = await startReading(student, one);
    const attemptTwo = await startReading(student, two);
    const [foreign] = await questionIds(student, attemptTwo, two.sectionId);
    await student.put(`/attempts/${attemptOne}/sections/${one.sectionId}/answers`, { answers: [{ questionId: foreign!.id, response: { text: "x" } }] }).expect(400);
  });

  it("limits how often one attempt can autosave", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1] = await questionIds(student, attemptId, exam.sectionId);
    const body = { answers: [{ questionId: q1!.id, isFlagged: true }] };
    let limited = false;
    for (let index = 0; index < 125 && !limited; index += 1) {
      limited = (await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, body)).status === 429;
    }
    expect(limited).toBe(true);
  }, 60_000);
});

describe("server-controlled time", () => {
  const expire = (attemptId: string) => prisma.sectionAttempt.updateMany({ where: { examAttemptId: attemptId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

  it("rejects late answers, keeps earlier ones, and closes the attempt", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1, q2] = await questionIds(student, attemptId, exam.sectionId);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1!.id, response: { selected: ["FALSE"] } }] }).expect(200);
    await expire(attemptId);
    const late = await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q2!.id, response: { text: "secretanswer" } }] });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe("ATTEMPT_EXPIRED");
    const view = (await student.get(`/attempts/${attemptId}`).expect(200)).body.data;
    expect(view.status).toBe("EXPIRED");
    const result = (await student.get(`/attempts/${attemptId}/result`).expect(200)).body.data;
    expect(result.rawScore).toBe(1);
  });

  it("marks an expired attempt once even when it's submitted afterwards", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    await expire(attemptId);
    const view = (await student.post(`/attempts/${attemptId}/submit`).expect(200)).body.data;
    expect(view.status).toBe("EXPIRED");
  });

  it("closes attempts left alone past the resume window", async () => {
    const exam = await readingExam();
    const attempt = (await student.post(`/exams/${exam.examId}/attempts`, {}).expect(201)).body.data;
    await prisma.examAttempt.update({ where: { id: attempt.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const history = (await student.get("/attempts?pageSize=100").expect(200)).body.data;
    expect(history.find((row: { id: string }) => row.id === attempt.id).status).toBe("EXPIRED");
  });

  it("practice mode has no clock", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam, "PRACTICE");
    const view = (await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`).expect(200)).body.data;
    expect(view.expiresAt).toBeNull();
  });
});

describe("duplicate and concurrent requests", () => {
  it("many submissions at once mark once and agree", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1] = await questionIds(student, attemptId, exam.sectionId);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1!.id, response: { selected: ["FALSE"] } }] });
    const results = await Promise.all(Array.from({ length: 6 }, () => student.post(`/attempts/${attemptId}/submit`)));
    expect(results.map((row) => row.status)).toEqual(Array(6).fill(200));
    expect(new Set(results.map((row) => row.body.data.submittedAt)).size).toBe(1);
    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(stored.rawScore).toBe(1);
    const again = (await student.post(`/attempts/${attemptId}/submit`).expect(200)).body.data;
    expect(again.submittedAt).toBe(results[0]!.body.data.submittedAt);
  });

  it("many starts at once create one attempt", async () => {
    const exam = await readingExam();
    const results = await Promise.all(Array.from({ length: 6 }, () => student.post(`/exams/${exam.examId}/attempts`, {})));
    expect(results.map((row) => row.status)).toEqual(Array(6).fill(201));
    expect(new Set(results.map((row) => row.body.data.id)).size).toBe(1);
    expect(await prisma.examAttempt.count({ where: { userId: student.id, examVersionId: exam.versionId } })).toBe(1);
  });

  it("many section starts at once keep one deadline", async () => {
    const exam = await readingExam();
    const attempt = (await student.post(`/exams/${exam.examId}/attempts`, {})).body.data;
    const results = await Promise.all(Array.from({ length: 5 }, () => student.post(`/attempts/${attempt.id}/sections/${exam.sectionId}/start`)));
    expect(new Set(results.map((row) => row.body.data.expiresAt)).size).toBe(1);
  });

  it("a save can't change answers after a submission", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1] = await questionIds(student, attemptId, exam.sectionId);
    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    const late = await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1!.id, response: { selected: ["FALSE"] } }] });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("ATTEMPT_ALREADY_SUBMITTED");
  });

  it("concurrent saves and a submission leave one consistent score", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1] = await questionIds(student, attemptId, exam.sectionId);
    const save = () => student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1!.id, response: { selected: ["FALSE"] } }] });
    const results = await Promise.all([save(), save(), student.post(`/attempts/${attemptId}/submit`), save()]);
    expect(results.every((row) => [200, 409].includes(row.status))).toBe(true);
    const response = await prisma.questionResponse.findFirst({ where: { questionId: q1!.id, sectionAttempt: { examAttemptId: attemptId } } });
    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    // Whatever order they ran in, the stored score must match the stored answer's marks.
    expect(stored.rawScore).toBe(response?.marksAwarded ?? 0);
  });
});

describe("ownership and permissions", () => {
  it("another student can't see or change an attempt", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const [q1] = await questionIds(student, attemptId, exam.sectionId);
    await other.get(`/attempts/${attemptId}`).expect(404);
    await other.get(`/attempts/${attemptId}/sections/${exam.sectionId}`).expect(404);
    await other.put(`/attempts/${attemptId}/sections/${exam.sectionId}/answers`, { answers: [{ questionId: q1!.id, response: { selected: ["FALSE"] } }] }).expect(404);
    await other.post(`/attempts/${attemptId}/submit`).expect(404);
    await other.post(`/attempts/${attemptId}/cancel`).expect(404);
    await other.get(`/attempts/${attemptId}/result`).expect(404);
    const mine = (await other.get("/attempts?pageSize=100").expect(200)).body.data;
    expect(mine.some((row: { id: string }) => row.id === attemptId)).toBe(false);
  });

  it("students can't reach exam administration, and signed-out users can't reach anything", async () => {
    await student.get("/admin/exams").expect(403);
    await student.post("/admin/exams", { title: "Nope" }).expect(403);
    const exam = await readingExam();
    await student.get(`/admin/exam-versions/${exam.versionId}`).expect(403);
    await student.post(`/admin/exam-versions/${exam.versionId}/publish`).expect(403);
    await request(app).get(`${V1}/exams`).expect(401);
    await request(app).get(`${V1}/attempts`).expect(401);
  });

  it("an editor can write content but can't publish it", async () => {
    const editor = await person("EDITOR");
    const exam = (await editor.post("/admin/exams", { title: "Editor exam" }).expect(201)).body.data;
    await editor.post(`/admin/exam-versions/${exam.versions[0].id}/publish`).expect(403);
  });

  it("premium exams need access", async () => {
    const exam = await readingExam(`Premium ${++counter}`, { isPremium: true });
    const refused = await student.post(`/exams/${exam.examId}/attempts`, {});
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("ENTITLEMENT_REQUIRED");
  });
});

describe("published content", () => {
  it("can't change through the API or directly in the database", async () => {
    const exam = await readingExam();
    await author.post(`/admin/exam-versions/${exam.versionId}/sections`, { skill: "READING", title: "More", durationSeconds: 60 }).expect(409);
    await author.patch(`/admin/exam-sections/${exam.sectionId}`, { title: "Changed" }).expect(409);
    await author.patch(`/admin/exam-versions/${exam.versionId}`, { sourceNote: "Changed" }).expect(409);
    await author.patch(`/admin/questions/${exam.q2Id}`, { answers: [{ acceptedValue: "new" }] }).expect(409);
    await expect(prisma.questionAnswer.deleteMany({ where: { questionId: exam.q2Id } })).rejects.toThrow();
    await expect(prisma.examSection.update({ where: { id: exam.sectionId }, data: { title: "Direct" } })).rejects.toThrow();
  });

  it("a new version leaves attempts on the old one unchanged", async () => {
    const exam = await readingExam();
    const attemptId = await startReading(student, exam);
    const version = (await author.post(`/admin/exams/${exam.examId}/versions`).expect(201)).body.data;
    expect(version.versionNumber).toBe(2);
    const tree = (await author.get(`/admin/exam-versions/${version.id}`).expect(200)).body.data;
    expect(tree.sections[0].questionGroups).toHaveLength(3);
    expect(tree.sections[0].questionGroups[2].questions[0].scoringMode).toBe("PER_ITEM");
    await author.patch(`/admin/exam-sections/${tree.sections[0].id}`, { title: "Second edition" }).expect(200);
    await author.post(`/admin/exam-versions/${version.id}/publish`).expect(200);
    const summary = (await student.get(`/exams/${exam.examId}`).expect(200)).body.data;
    expect(summary.sections[0].title).toBe("Second edition");
    const old = (await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`).expect(200)).body.data;
    expect(old.section.title).toBe("Passage one");
  });

  it("deleting an author's account keeps the published exam locked and intact", async () => {
    const writer = await person("ADMIN");
    const exam = (await writer.post("/admin/exams", { title: `Author ${++counter}` }).expect(201)).body.data;
    const versionId = exam.versions[0].id as string;
    const section = (await writer.post(`/admin/exam-versions/${versionId}/sections`, { skill: "WRITING", title: "Writing", durationSeconds: 3600 })).body.data;
    await writer.post(`/admin/exam-sections/${section.id}/writing-tasks`, { taskType: "TASK_2", prompt: "Discuss the fictional question.", minWords: 250, suggestedMinutes: 40 });
    await writer.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
    await prisma.user.delete({ where: { id: writer.id } });
    const version = await prisma.examVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.createdById).toBeNull();
    expect(version.status).toBe("PUBLISHED");
    await expect(prisma.examVersion.update({ where: { id: versionId }, data: { sourceNote: "Changed" } })).rejects.toThrow();
    await expect(prisma.examVersion.update({ where: { id: versionId }, data: { createdById: author.id } })).rejects.toThrow();
  });

  it("publishing checks that the paper is complete", async () => {
    const { versionId } = await draftExam(`Incomplete ${++counter}`);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "Empty", durationSeconds: 600 })).body.data;
    const group = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "MULTIPLE_CHOICE_SINGLE" })).body.data;
    await author.post(`/admin/question-groups/${group.id}/questions`, { number: 1, options: [{ label: "A", body: "One" }], answers: [{ acceptedValue: "Z" }] });
    const check = (await author.get(`/admin/exam-versions/${versionId}/validation`).expect(200)).body.data;
    expect(check.errors.join(" ")).toContain("needs a passage");
    expect(check.errors.join(" ")).toContain("isn't one of its options");
    const refused = await author.post(`/admin/exam-versions/${versionId}/publish`);
    expect(refused.status).toBe(422);
  });

  it("draft and removed exams aren't offered to students", async () => {
    const { examId } = await draftExam(`Draft ${++counter}`);
    await student.get(`/exams/${examId}`).expect(404);
    await student.post(`/exams/${examId}/attempts`, {}).expect(404);
    const removed = await readingExam();
    await author.del(`/admin/exams/${removed.examId}`).expect(200);
    await student.get(`/exams/${removed.examId}`).expect(404);
  });

  it("question numbers can't repeat within a section", async () => {
    const { versionId } = await draftExam(`Numbers ${++counter}`);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "One", durationSeconds: 600 })).body.data;
    const one = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "SHORT_ANSWER" })).body.data;
    const two = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "SHORT_ANSWER" })).body.data;
    await author.post(`/admin/question-groups/${one.id}/questions`, { number: 1, answers: [{ acceptedValue: "a" }] }).expect(201);
    await author.post(`/admin/question-groups/${two.id}/questions`, { number: 1, answers: [{ acceptedValue: "b" }] }).expect(409);
  });
});

describe("listening audio", () => {
  async function listeningExam(settings: object = {}) {
    const { examId, versionId } = await draftExam(`Listening ${++counter}`);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "LISTENING", title: "Part 1", durationSeconds: 600, settings }).expect(201)).body.data;
    const audio = (await author.upload(`/admin/exam-sections/${section.id}/audio?durationSeconds=30`, WAV).expect(201)).body.data;
    expect(audio.storageKey).toBeUndefined();
    await author.patch(`/admin/audio/${audio.id}`, { transcript: "SECRET-TRANSCRIPT" }).expect(200);
    const group = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "FORM_COMPLETION" })).body.data;
    await author.post(`/admin/question-groups/${group.id}/questions`, { number: 1, prompt: "Name:", answers: [{ acceptedValue: "Riverside" }] });
    await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
    return { examId, sectionId: section.id as string, audioId: audio.id as string };
  }

  it("needs a play before streaming, and enforces the play limit on the server", async () => {
    const exam = await listeningExam();
    const attemptId = await startReading(student, exam);
    const base = `/attempts/${attemptId}/sections/${exam.sectionId}/audio/${exam.audioId}`;
    const view = JSON.stringify((await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`)).body);
    expect(view).not.toContain("SECRET-TRANSCRIPT");
    expect(view).not.toContain("content/");
    await student.get(base).expect(403);
    await student.post(`${base}/play`).expect(200);
    const file = await student.get(base).expect(200);
    expect(file.headers["content-type"]).toContain("audio/wav");
    await student.post(`${base}/play`).expect(409);
    await other.get(base).expect(404);
    await other.post(`${base}/play`).expect(404);
    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    await student.get(base).expect(409);
    const result = (await student.get(`/attempts/${attemptId}/result`)).body.data;
    expect(result.sections[0].transcripts).toEqual(["SECRET-TRANSCRIPT"]);
  });

  it("concurrent plays can't get past the limit", async () => {
    const exam = await listeningExam({ maxAudioPlays: 2 });
    const attemptId = await startReading(student, exam);
    const base = `/attempts/${attemptId}/sections/${exam.sectionId}/audio/${exam.audioId}/play`;
    const results = await Promise.all(Array.from({ length: 6 }, () => student.post(base)));
    expect(results.filter((row) => row.status === 200)).toHaveLength(2);
  });

  it("refuses files that aren't audio", async () => {
    const { versionId } = await draftExam(`Bad audio ${++counter}`);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "LISTENING", title: "Part 1", durationSeconds: 600 })).body.data;
    await author.upload(`/admin/exam-sections/${section.id}/audio?durationSeconds=30`, Buffer.from("<script>alert(1)</script>")).expect(400);
  });
});

describe("writing", () => {
  async function writingExam(examType: "ACADEMIC" | "GENERAL_TRAINING" = "ACADEMIC") {
    const { examId, versionId } = await draftExam(`Writing ${++counter}`, { examType });
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "WRITING", title: "Writing", durationSeconds: 3600 })).body.data;
    const task = (await author.post(`/admin/exam-sections/${section.id}/writing-tasks`, { taskType: examType === "ACADEMIC" ? "ACADEMIC_TASK_1" : "GENERAL_TASK_1", prompt: "Describe the fictional chart.", minWords: 150, suggestedMinutes: 20 }).expect(201)).body.data;
    const essay = (await author.post(`/admin/exam-sections/${section.id}/writing-tasks`, { taskType: "TASK_2", prompt: "Discuss the fictional question.", minWords: 250, suggestedMinutes: 40 }).expect(201)).body.data;
    await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
    return { examId, sectionId: section.id as string, taskId: task.id as string, essayId: essay.id as string };
  }

  it("saves drafts, seals on submission, prepares a hidden assessment and produces no band", async () => {
    const exam = await writingExam();
    const attemptId = await startReading(student, exam);
    const route = `/attempts/${attemptId}/sections/${exam.sectionId}/writing/${exam.taskId}`;
    expect((await student.put(route, { text: "Cars declined over time." }).expect(200)).body.data.wordCount).toBe(4);
    await student.put(route, { text: "Car use declined steadily over time." }).expect(200);
    const resumed = (await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`)).body.data;
    expect(resumed.writing[0].text).toBe("Car use declined steadily over time.");
    const drafts = (await student.get("/writing/submissions?status=draft").expect(200)).body.data;
    expect(drafts.some((row: { writingTask: { prompt: string }; assessment: string }) => row.writingTask.prompt.includes("fictional chart") && row.assessment === "NOT_AVAILABLE")).toBe(true);

    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    await student.put(route, { text: "Changed later" }).expect(409);
    const submission = await prisma.writingSubmission.findFirstOrThrow({ where: { writingTaskId: exam.taskId }, include: { results: { include: { criterionScores: true } } } });
    expect(submission.submittedAt).toBeTruthy();
    expect(submission.wordCount).toBe(6);
    expect(submission.results).toHaveLength(1);
    expect(submission.results[0]!.bandVisibility).toBe("HIDDEN");
    expect(submission.results[0]!.overallBand).toBeNull();
    expect(submission.results[0]!.criterionScores).toHaveLength(0);
    // A blank task isn't recorded as submitted work.
    expect(await prisma.assessmentResult.count({ where: { writingSubmission: { writingTaskId: exam.essayId } } })).toBe(0);
    const result = (await student.get(`/attempts/${attemptId}/result`)).body.data;
    expect(result.rawScore).toBeNull();
    expect(result.sections[0].rawScore).toBeNull();
    expect(result.sections[0].writing[0].wordCount).toBe(6);
  });

  it("lets a student discard a draft but not submitted work", async () => {
    const exam = await writingExam("GENERAL_TRAINING");
    const attemptId = await startReading(student, exam);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/writing/${exam.taskId}`, { text: "Dear Sir" }).expect(200);
    const draft = await prisma.writingSubmission.findFirstOrThrow({ where: { writingTaskId: exam.taskId } });
    await other.del(`/writing/submissions/${draft.id}`).expect(404);
    await student.del(`/writing/submissions/${draft.id}`).expect(200);
    await student.put(`/attempts/${attemptId}/sections/${exam.sectionId}/writing/${exam.taskId}`, { text: "Dear Madam" }).expect(200);
    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    const sealed = await prisma.writingSubmission.findFirstOrThrow({ where: { writingTaskId: exam.taskId } });
    await student.del(`/writing/submissions/${sealed.id}`).expect(409);
  });

  it("refuses a task from the wrong exam type at publishing", async () => {
    const { versionId } = await draftExam(`Mismatch ${++counter}`, { examType: "GENERAL_TRAINING" });
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "WRITING", title: "Writing", durationSeconds: 3600 })).body.data;
    await author.post(`/admin/exam-sections/${section.id}/writing-tasks`, { taskType: "ACADEMIC_TASK_1", prompt: "Describe the fictional chart.", minWords: 150, suggestedMinutes: 20 });
    await author.post(`/admin/exam-versions/${versionId}/publish`).expect(422);
  });
});

describe("speaking", () => {
  async function speakingExam() {
    const { examId, versionId } = await draftExam(`Speaking ${++counter}`);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "SPEAKING", title: "Speaking", durationSeconds: 840 })).body.data;
    const parts = await Promise.all(["PART_1", "PART_2", "PART_3"].map(async (part) => (await author.post(`/admin/exam-sections/${section.id}/speaking-questions`, { part, prompt: `Question for ${part}`, cueCard: part === "PART_2" ? ["Where it is"] : null, prepSeconds: part === "PART_2" ? 60 : null, maxAnswerSeconds: 120 }).expect(201)).body.data));
    await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
    return { examId, sectionId: section.id as string, questionId: parts[0].id as string };
  }

  it("stores private recordings, allows replacing them, and keeps them from anyone else", async () => {
    const exam = await speakingExam();
    const attemptId = await startReading(student, exam);
    const route = `/attempts/${attemptId}/sections/${exam.sectionId}/speaking/${exam.questionId}/recording`;
    await student.upload(`${route}?durationSeconds=12`, WEBM).expect(200);
    await student.upload(`${route}?durationSeconds=15`, WEBM).expect(200);
    const view = (await student.get(`/attempts/${attemptId}/sections/${exam.sectionId}`)).body.data;
    expect(view.speaking).toEqual([{ speakingQuestionId: exam.questionId, durationSeconds: 15, hasRecording: true }]);
    expect(JSON.stringify(view)).not.toContain("recordings/");
    const file = await student.get(route).expect(200);
    expect(file.headers["content-type"]).toContain("audio/webm");
    await other.get(route).expect(404);
    await other.upload(`${route}?durationSeconds=5`, WEBM).expect(404);

    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    await student.upload(`${route}?durationSeconds=5`, WEBM).expect(409);
    await student.del(route).expect(409);
    const stored = await prisma.speakingSubmission.findFirstOrThrow({ where: { speakingQuestionId: exam.questionId } });
    expect(stored.submittedAt).toBeTruthy();
    expect(stored.audioDeleteAfter).toBeTruthy();
    expect(stored.transcript).toBeNull();
    expect(stored.pronunciationFeedback).toBeNull();
    expect(await prisma.assessmentResult.count({ where: { speakingSubmissionId: stored.id } })).toBe(0);
    const history = (await student.get("/speaking/submissions?status=submitted").expect(200)).body.data;
    expect(history.some((row: { id: string; assessment: string }) => row.id === stored.id && row.assessment === "NOT_AVAILABLE")).toBe(true);
    await student.get(route).expect(200);
  });

  it("handles bad and interrupted uploads, which can then be retried", async () => {
    const exam = await speakingExam();
    const attemptId = await startReading(student, exam);
    const route = `/attempts/${attemptId}/sections/${exam.sectionId}/speaking/${exam.questionId}/recording`;
    await student.upload(`${route}?durationSeconds=5`, Buffer.alloc(0)).expect(400);
    await student.upload(`${route}?durationSeconds=5`, Buffer.from("not audio at all")).expect(400);
    await student.upload(route, WEBM).expect(400);
    await student.get(route).expect(404);
    await student.upload(`${route}?durationSeconds=5`, WEBM).expect(200);
    await student.del(route).expect(200);
    await student.get(route).expect(404);
    await student.upload(`${route}?durationSeconds=7`, WEBM).expect(200);
  });
});

describe("mock tests", () => {
  async function mockExam() {
    const { examId, versionId } = await draftExam(`Mock ${++counter}`, { isMock: true, examType: "ACADEMIC" });
    const reading = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "Reading", durationSeconds: 3600 })).body.data;
    await author.post(`/admin/exam-sections/${reading.id}/passages`, { title: "Passage", body: "Text" });
    const group = (await author.post(`/admin/exam-sections/${reading.id}/groups`, { type: "SHORT_ANSWER" })).body.data;
    await author.post(`/admin/question-groups/${group.id}/questions`, { number: 1, answers: [{ acceptedValue: "yes" }] });
    const writing = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "WRITING", title: "Writing", durationSeconds: 3600 })).body.data;
    await author.post(`/admin/exam-sections/${writing.id}/writing-tasks`, { taskType: "TASK_2", prompt: "Discuss the fictional question.", minWords: 250, suggestedMinutes: 40 });
    const published = (await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200)).body.data;
    return { examId, readingId: reading.id as string, writingId: writing.id as string, warnings: published.warnings as string[] };
  }

  it("runs sections in order, each with its own timer, and flags format differences", async () => {
    const exam = await mockExam();
    expect(exam.warnings.join(" ")).toContain("40 questions");
    const attempt = (await student.post(`/exams/${exam.examId}/attempts`, {}).expect(201)).body.data;
    expect(attempt.mode).toBe("MOCK");
    expect(attempt.navigation).toBe("SEQUENTIAL");
    await student.post(`/attempts/${attempt.id}/sections/${exam.writingId}/start`).expect(409);
    await student.post(`/attempts/${attempt.id}/sections/${exam.readingId}/start`).expect(200);
    const after = (await student.post(`/attempts/${attempt.id}/sections/${exam.readingId}/submit`).expect(200)).body.data;
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.sections[0].status).toBe("SUBMITTED");
    await student.get(`/attempts/${attempt.id}/sections/${exam.readingId}`).expect(409);
    const writing = (await student.post(`/attempts/${attempt.id}/sections/${exam.writingId}/start`).expect(200)).body.data;
    expect(writing.expiresAt).toBeTruthy();
    const done = (await student.post(`/attempts/${attempt.id}/sections/${exam.writingId}/submit`).expect(200)).body.data;
    expect(done.status).toBe("SUBMITTED");
    const result = (await student.get(`/attempts/${attempt.id}/result`).expect(200)).body.data;
    expect(result.maxScore).toBe(1);
  });

  it("can't be cancelled, but practice attempts can, and they free the exam", async () => {
    const mock = await mockExam();
    const attempt = (await student.post(`/exams/${mock.examId}/attempts`, {})).body.data;
    await student.post(`/attempts/${attempt.id}/cancel`).expect(409);

    const exam = await readingExam();
    const attemptId = await startReading(student, exam, "PRACTICE");
    const cancelled = (await student.post(`/attempts/${attemptId}/cancel`).expect(200)).body.data;
    expect(cancelled.status).toBe("ABANDONED");
    await student.post(`/attempts/${attemptId}/submit`).expect(409);
    await student.get(`/attempts/${attemptId}/result`).expect(409);
    const next = (await student.post(`/exams/${exam.examId}/attempts`, {}).expect(201)).body.data;
    expect(next.id).not.toBe(attemptId);
  });

  it("enforces a configured attempt limit", async () => {
    const { examId, versionId } = await draftExam(`Limited ${++counter}`);
    await author.patch(`/admin/exam-versions/${versionId}`, { settings: { maxAttempts: 1 } }).expect(200);
    const section = (await author.post(`/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "One", durationSeconds: 600 })).body.data;
    await author.post(`/admin/exam-sections/${section.id}/passages`, { title: "Passage", body: "Text" });
    const group = (await author.post(`/admin/exam-sections/${section.id}/groups`, { type: "SHORT_ANSWER" })).body.data;
    await author.post(`/admin/question-groups/${group.id}/questions`, { number: 1, answers: [{ acceptedValue: "x" }] });
    await author.post(`/admin/exam-versions/${versionId}/publish`).expect(200);
    const attemptId = await startReading(student, { examId, sectionId: section.id });
    await student.post(`/attempts/${attemptId}/submit`).expect(200);
    await student.post(`/exams/${examId}/attempts`, {}).expect(409);
  });

  it("lists and filters exams", async () => {
    const mock = await mockExam();
    const mocks = (await student.get("/exams?isMock=true&pageSize=100").expect(200)).body;
    expect(mocks.data.some((row: { id: string }) => row.id === mock.examId)).toBe(true);
    expect(mocks.meta.pageSize).toBe(100);
    const listening = (await student.get("/exams?skill=SPEAKING&isMock=true&pageSize=100").expect(200)).body.data;
    expect(listening.some((row: { id: string }) => row.id === mock.examId)).toBe(false);
  });
});
