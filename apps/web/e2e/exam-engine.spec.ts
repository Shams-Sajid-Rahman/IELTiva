import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

const API = "http://localhost:5100/api/v1";
const PASSWORD = "Str0ng-Pass-Word";
const run = Date.now();
const adminEmail = `e2e-${run}-exam-admin@example.com`;
const studentEmail = `e2e-${run}-exam-student@example.com`;
const WAV_BASE64 = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(40)]).toString("base64");

test.describe.configure({ mode: "serial" });
// A fake microphone lets the real recording flow run in the browser.
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["microphone"] });

async function db<T>(work: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function signUp(page: Page, email: string, firstName: string) {
  await page.goto("/register");
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/(dashboard|admin)$/);
}

async function call<T>(page: Page, method: string, route: string, body?: unknown, binaryBase64?: string): Promise<T> {
  return page.evaluate(
    async ({ API, method, route, body, binaryBase64 }) => {
      const csrf = await (await fetch(`${API}/auth/csrf`, { credentials: "include" })).json();
      const bytes = binaryBase64 ? Uint8Array.from(atob(binaryBase64), (char) => char.charCodeAt(0)) : null;
      const response = await fetch(`${API}${route}`, {
        method,
        credentials: "include",
        headers: { ...(bytes ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }), "X-CSRF-Token": csrf.data.csrfToken },
        ...(bytes ? { body: bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(`${method} ${route}: ${JSON.stringify(json)}`);
      return json.data;
    },
    { API, method, route, body, binaryBase64 },
  ) as Promise<T>;
}

const titles = { reading: `Reading ${run}`, listening: `Listening ${run}`, writing: `Writing ${run}`, speaking: `Speaking ${run}`, mock: `Mock ${run}`, resume: `Resume ${run}`, expiry: `Expiry ${run}` };
const ids: Record<string, string> = {};

async function buildReading(page: Page, title: string) {
  const exam = await call<{ id: string; versions: { id: string }[] }>(page, "POST", "/admin/exams", { title });
  const versionId = exam.versions[0]!.id;
  const section = await call<{ id: string }>(page, "POST", `/admin/exam-versions/${versionId}/sections`, { skill: "READING", title: "Reading section", durationSeconds: 1200 });
  await call(page, "POST", `/admin/exam-sections/${section.id}/passages`, { title: "Gardens above the city", body: "Plants on roofs cool the rooms below. Critics mention the local climate." });
  const tf = await call<{ id: string }>(page, "POST", `/admin/exam-sections/${section.id}/groups`, { type: "TRUE_FALSE_NOT_GIVEN", instructions: "Do the statements agree?" });
  await call(page, "POST", `/admin/question-groups/${tf.id}/questions`, { number: 1, prompt: "Plants cool the rooms below.", explanation: "Stated in the first sentence.", answers: [{ acceptedValue: "TRUE" }] });
  const typed = await call<{ id: string }>(page, "POST", `/admin/exam-sections/${section.id}/groups`, { type: "SENTENCE_COMPLETION", instructions: "One word only." });
  await call(page, "POST", `/admin/question-groups/${typed.id}/questions`, { number: 2, prompt: "Critics mention the local ____.", answers: [{ acceptedValue: "climate", maxWords: 1 }] });
  const match = await call<{ id: string }>(page, "POST", `/admin/exam-sections/${section.id}/groups`, { type: "MATCHING_HEADINGS", instructions: "Choose a heading." });
  await call(page, "POST", `/admin/question-groups/${match.id}/questions`, { number: 3, prompt: "Paragraph one", options: [{ label: "i", body: "Cooling" }, { label: "ii", body: "Cost" }], answers: [{ acceptedValue: "i" }] });
  await call(page, "POST", `/admin/exam-versions/${versionId}/publish`);
  return { id: exam.id, sectionId: section.id };
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await signUp(page, adminEmail, "Adil");
  await signUp(page, studentEmail, "Sadia");
  await db((c) => c.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.code = 'ADMIN'`, [adminEmail]));
  await signIn(page, adminEmail);

  ids.reading = (await buildReading(page, titles.reading)).id;
  ids.resume = (await buildReading(page, titles.resume)).id;
  ids.expiry = (await buildReading(page, titles.expiry)).id;

  const listening = await call<{ id: string; versions: { id: string }[] }>(page, "POST", "/admin/exams", { title: titles.listening });
  const lSection = await call<{ id: string }>(page, "POST", `/admin/exam-versions/${listening.versions[0]!.id}/sections`, { skill: "LISTENING", title: "Listening section", durationSeconds: 600 });
  await call(page, "PUT", `/admin/exam-sections/${lSection.id}/audio?durationSeconds=5`, undefined, WAV_BASE64);
  const lGroup = await call<{ id: string }>(page, "POST", `/admin/exam-sections/${lSection.id}/groups`, { type: "FORM_COMPLETION", instructions: "Complete the form." });
  await call(page, "POST", `/admin/question-groups/${lGroup.id}/questions`, { number: 1, prompt: "Name:", answers: [{ acceptedValue: "Riverside" }] });
  await call(page, "POST", `/admin/exam-versions/${listening.versions[0]!.id}/publish`);
  ids.listening = listening.id;

  const writing = await call<{ id: string; versions: { id: string }[] }>(page, "POST", "/admin/exams", { title: titles.writing, examType: "ACADEMIC" });
  const wSection = await call<{ id: string }>(page, "POST", `/admin/exam-versions/${writing.versions[0]!.id}/sections`, { skill: "WRITING", title: "Writing section", durationSeconds: 3600 });
  await call(page, "POST", `/admin/exam-sections/${wSection.id}/writing-tasks`, { taskType: "ACADEMIC_TASK_1", prompt: "Describe the fictional chart.", minWords: 150, suggestedMinutes: 20 });
  await call(page, "POST", `/admin/exam-sections/${wSection.id}/writing-tasks`, { taskType: "TASK_2", prompt: "Discuss the fictional question.", minWords: 250, suggestedMinutes: 40 });
  await call(page, "POST", `/admin/exam-versions/${writing.versions[0]!.id}/publish`);
  ids.writing = writing.id;

  const speaking = await call<{ id: string; versions: { id: string }[] }>(page, "POST", "/admin/exams", { title: titles.speaking });
  const sSection = await call<{ id: string }>(page, "POST", `/admin/exam-versions/${speaking.versions[0]!.id}/sections`, { skill: "SPEAKING", title: "Speaking section", durationSeconds: 840 });
  await call(page, "POST", `/admin/exam-sections/${sSection.id}/speaking-questions`, { part: "PART_1", prompt: "What do you do at the weekend?", maxAnswerSeconds: 30 });
  await call(page, "POST", `/admin/exam-sections/${sSection.id}/speaking-questions`, { part: "PART_2", prompt: "Describe a place you enjoy.", cueCard: ["Where it is"], prepSeconds: 60, maxAnswerSeconds: 30 });
  await call(page, "POST", `/admin/exam-versions/${speaking.versions[0]!.id}/publish`);
  ids.speaking = speaking.id;

  const mock = await call<{ id: string; versions: { id: string }[] }>(page, "POST", "/admin/exams", { title: titles.mock, isMock: true, examType: "ACADEMIC" });
  const mVersion = mock.versions[0]!.id;
  const mReading = await call<{ id: string }>(page, "POST", `/admin/exam-versions/${mVersion}/sections`, { skill: "READING", title: "Mock reading", durationSeconds: 1200 });
  await call(page, "POST", `/admin/exam-sections/${mReading.id}/passages`, { title: "Mock passage", body: "Short text." });
  const mGroup = await call<{ id: string }>(page, "POST", `/admin/exam-sections/${mReading.id}/groups`, { type: "SHORT_ANSWER" });
  await call(page, "POST", `/admin/question-groups/${mGroup.id}/questions`, { number: 1, prompt: "A word:", answers: [{ acceptedValue: "text" }] });
  const mWriting = await call<{ id: string }>(page, "POST", `/admin/exam-versions/${mVersion}/sections`, { skill: "WRITING", title: "Mock writing", durationSeconds: 3600 });
  await call(page, "POST", `/admin/exam-sections/${mWriting.id}/writing-tasks`, { taskType: "TASK_2", prompt: "Discuss the mock question.", minWords: 250, suggestedMinutes: 40 });
  await call(page, "POST", `/admin/exam-versions/${mVersion}/publish`);
  ids.mock = mock.id;
  await context.close();
});

test.afterAll(async () => {
  await db(async (c) => {
    await c.query("DELETE FROM users WHERE email LIKE $1", [`e2e-${run}-%`]);
  });
});

async function open(page: Page, examId: string, button = "Start timed") {
  await page.goto(`/practice/exams/${examId}`);
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(/\/exam\//);
}

test("a student completes a timed Reading paper and sees raw marks and a review", async ({ page }) => {
  await signIn(page, studentEmail);
  await page.goto("/practice");
  await page.getByRole("searchbox", { name: "Search exams" }).fill(titles.reading);
  await page.getByRole("link", { name: titles.reading }).click();
  await page.getByRole("button", { name: "Start timed" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();

  await expect(page.getByRole("timer")).toContainText(/19:5\d|20:00/);
  await expect(page.getByRole("heading", { name: "Gardens above the city" })).toBeVisible();
  await page.getByRole("radio", { name: "TRUE" }).click();
  await page.getByRole("textbox", { name: /Critics mention/ }).fill("  CLIMATE. ");
  await page.getByRole("combobox", { name: /Paragraph one/ }).selectOption("ii");
  await expect(page.getByRole("status").filter({ hasText: /Saved at/ })).toBeVisible({ timeout: 8000 });

  await page.getByRole("button", { name: "Flag question 3" }).click();
  await expect(page.getByRole("button", { name: /Question 3, answered, flagged/ })).toBeVisible();
  await page.getByRole("button", { name: "Review answers" }).click();
  await expect(page.getByRole("dialog").getByText("3 of 3 answered")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Finish section" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish section" }).click();
  await expect(page).toHaveURL(/\/practice\/attempts\//);
  await expect(page.getByRole("banner").or(page.locator("header")).getByText("2 / 3").first()).toBeVisible();
  await expect(page.getByText("Raw score")).toBeVisible();
  await expect(page.getByText(/not an IELTS band/)).toBeVisible();
  await expect(page.getByText("Stated in the first sentence.")).toBeVisible();
  await expect(page.getByText(/Your answer:/).first()).toBeVisible();
  expect((await page.locator("main").innerText())).not.toMatch(/band\s+\d/i);

  await page.goto("/practice/history");
  await expect(page.getByText(titles.reading)).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: titles.reading })).toBeVisible();
});

test("a reload resumes the same clock and answers, and disconnection doesn't lose work", async ({ page, context }) => {
  await signIn(page, studentEmail);
  await open(page, ids.resume!);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("radio", { name: "TRUE" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Saved at/ })).toBeVisible({ timeout: 8000 });

  // Answer while offline. The work is kept and the screen says so.
  await context.setOffline(true);
  await page.getByRole("textbox", { name: /Critics mention/ }).fill("climate");
  await expect(page.getByRole("status").filter({ hasText: /Not saved yet/ })).toBeVisible({ timeout: 8000 });

  // Back online, the work reaches the server, and a reload shows it.
  await context.setOffline(false);
  await expect.poll(async () => {
    const row = await db(async (c) => (await c.query(`SELECT r.response FROM question_responses r JOIN questions q ON q.id = r.question_id JOIN section_attempts s ON s.id = r.section_attempt_id WHERE q.prompt = 'Critics mention the local ____.' AND s.exam_attempt_id = $1`, [page.url().split("/").pop()])).rows[0]);
    return row?.response;
  }, { timeout: 15_000 }).toEqual({ text: "climate" });
  const before = await page.getByRole("timer").innerText();
  await page.reload();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("radio", { name: "TRUE" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: /Critics mention/ })).toHaveValue("climate");
  // The clock carries on from the server's deadline. A reload never adds time.
  const toSeconds = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  expect(toSeconds(await page.getByRole("timer").innerText())).toBeLessThanOrEqual(toSeconds(before));
});

test("when time runs out, the server closes the attempt and keeps saved answers", async ({ page }) => {
  await signIn(page, studentEmail);
  await open(page, ids.expiry!);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("radio", { name: "TRUE" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Saved at/ })).toBeVisible({ timeout: 8000 });
  const attemptId = page.url().split("/").pop()!;
  await db((c) => c.query(`UPDATE section_attempts SET expires_at = now() - interval '1 minute' WHERE exam_attempt_id = $1`, [attemptId]));

  // The next save is refused by the server, whatever the browser's clock says.
  await page.getByRole("textbox", { name: /Critics mention/ }).fill("climate");
  await expect(page).toHaveURL(/\/practice\/attempts\//, { timeout: 15_000 });
  await expect(page.getByText("1 / 3").first()).toBeVisible();
  await expect(page.getByText("Time ran out").first()).toBeVisible();
});

test("Listening plays private audio, and a limited play can't be restarted", async ({ page }) => {
  await signIn(page, studentEmail);
  await open(page, ids.listening!);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Plays used: 0 of 1")).toBeVisible();
  const addresses: string[] = [];
  page.on("request", (request) => addresses.push(request.url()));
  await page.getByRole("button", { name: "Play recording" }).click();
  await expect(page.getByText("Plays used: 1 of 1")).toBeVisible();
  expect(addresses.some((address) => address.includes("/audio/"))).toBe(true);
  expect(addresses.some((address) => /storage|\.wav/.test(address))).toBe(false);
  const source = await page.locator("audio").getAttribute("src");
  expect(source).toMatch(/^blob:/);
});

test("Writing saves drafts, counts words, explains assessment, and submits without a score", async ({ page }) => {
  await signIn(page, studentEmail);
  await open(page, ids.writing!);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Task Achievement / Task Response").first()).toBeVisible();
  await expect(page.getByText("Grammatical Range and Accuracy").first()).toBeVisible();
  await expect(page.getByText(/Automated assessment isn't available yet/).first()).toBeVisible();
  await page.getByLabel("Your answer for task 1").fill("Car use declined steadily over time.");
  await expect(page.getByText("6 of 150 words")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Saved at/ })).toBeVisible({ timeout: 8000 });

  await page.reload();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByLabel("Your answer for task 1")).toHaveValue("Car use declined steadily over time.");

  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("dialog").getByText(/1 task is still blank/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/practice\/attempts\//);
  await expect(page.getByText("Car use declined steadily over time.")).toBeVisible();
  await expect(page.getByText(/no score is given/)).toBeVisible();
  await expect(page.getByText("Raw score")).toHaveCount(0);

  await page.goto("/practice/history");
  await page.getByRole("tab", { name: "Writing" }).click();
  await expect(page.getByText("Describe the fictional chart.")).toBeVisible();
});

test("Speaking records from the microphone, previews, saves and submits", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, studentEmail);
  await open(page, ids.speaking!);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByLabel("Listen to your recording")).toBeVisible();
  await page.getByRole("button", { name: "Save recording" }).click();
  await expect(page.getByText(/Saved, 00:0\d long/)).toBeVisible();

  await page.getByRole("tab", { name: "Part 2" }).click();
  await expect(page.getByText("Where it is")).toBeVisible();
  await page.getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByText("Prepare your answer")).toBeVisible();
  await page.getByRole("tab", { name: "Part 1" }).click();

  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/practice\/attempts\//);
  await page.getByRole("button", { name: "Load recording" }).first().click();
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByText(/no score is given/)).toBeVisible();

  await page.goto("/practice/history");
  await page.getByRole("tab", { name: "Speaking" }).click();
  await expect(page.getByText(/What do you do at the weekend/)).toBeVisible();
});

test("a blocked microphone is explained", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
  });
  const page = await context.newPage();
  await signIn(page, studentEmail);
  await page.goto("/practice/history");
  await page.goto(`/practice/exams/${ids.speaking}`);
  await page.getByRole("button", { name: "Start timed" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Microphone access is blocked/ })).toBeVisible();
  await context.close();
});

test("a mock test runs its sections in order", async ({ page }) => {
  await signIn(page, studentEmail);
  await page.goto(`/practice/exams/${ids.mock}`);
  await page.getByRole("button", { name: "Start mock test" }).click();
  await expect(page.getByRole("heading", { name: "Mock reading" })).toBeVisible();
  const buttons = page.getByRole("button", { name: "Start", exact: true });
  await expect(buttons.nth(0)).toBeEnabled();
  await expect(buttons.nth(1)).toBeDisabled();
  await buttons.nth(0).click();
  await page.getByRole("button", { name: "Finish section" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish section" }).click();
  await expect(page.getByText("Submitted").first()).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Discuss the mock question.")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/practice\/attempts\//);
  await expect(page.getByText("0 / 1").first()).toBeVisible();
});

test("an administrator builds, previews and publishes an exam, which then locks", async ({ page }) => {
  const title = `Built in the interface ${run}`;
  await signIn(page, adminEmail);
  await page.getByRole("navigation", { name: "Administration navigation" }).getByRole("link", { name: "Exams" }).click();
  await page.getByRole("button", { name: "New exam" }).click();
  await page.getByRole("dialog").getByLabel("Exam title").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/admin\/exams\/[\w-]+$/);

  await expect(page.getByText("Add at least one section.")).toBeVisible();
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("dialog").getByLabel("Skill").selectOption("READING");
  await page.getByRole("dialog").getByLabel("Section title").fill("Section one");
  await page.getByRole("dialog").getByLabel("Duration in minutes").fill("20");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Section one" }).or(page.getByText("Section one", { exact: true })).first()).toBeVisible();

  await page.getByRole("button", { name: "Add passage" }).click();
  await page.getByRole("dialog").getByLabel("Passage title").fill("A passage");
  await page.getByRole("dialog").getByLabel("Passage text").fill("Original passage text.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("A passage")).toBeVisible();

  await page.getByRole("button", { name: "Add question group" }).click();
  await page.getByRole("dialog").getByLabel("Question type").selectOption("TRUE_FALSE_NOT_GIVEN");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Question text").fill("The text is original.");
  await page.getByRole("dialog").getByLabel("Accepted answers, one per line").fill("TRUE");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Key: TRUE")).toBeVisible();
  await expect(page.getByText("Ready to publish")).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "TRUE" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(0);
  await page.getByRole("button", { name: "New version" }).click();
  await expect(page.getByRole("button", { name: "Add section" })).toBeVisible();
});

test("students can't open exam administration", async ({ page }) => {
  await signIn(page, studentEmail);
  await page.goto("/admin/exams");
  await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
});

test("exam screens pass accessibility and fit at every width", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, studentEmail);
  const reading = await buildAttempt(page, titles.reading);
  const writing = await buildAttempt(page, titles.writing);
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [label, id] of [["reading", reading], ["writing", writing]] as const) {
        await page.goto(`/exam/${id}`);
        await page.getByRole("button", { name: /^(Start|Resume)$/ }).first().click();
        await expect(page.getByRole("timer").first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${label} ${width} ${theme}`).toBeLessThanOrEqual(0);
        const axe = await new AxeBuilder({ page }).analyze();
        expect(axe.violations.map((v) => `${label} ${width} ${theme} ${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      }
      for (const route of ["/practice", "/practice/history"]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${route} ${width} ${theme}`).toBeLessThanOrEqual(0);
        const axe = await new AxeBuilder({ page }).analyze();
        expect(axe.violations.map((v) => `${route} ${width} ${theme} ${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      }
    }
  }
});

async function buildAttempt(page: Page, title: string) {
  const list = await call<{ id: string; title: string }[]>(page, "GET", `/exams?search=${encodeURIComponent(title)}`);
  const attempt = await call<{ id: string }>(page, "POST", `/exams/${list[0]!.id}/attempts`, { mode: "TIMED" });
  return attempt.id;
}
