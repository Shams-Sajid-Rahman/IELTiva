// Screenshot capture for design reviews. Runs only when asked: VISUAL_SHOTS=<folder name> npm run test:e2e -- visual
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const folder = process.env.VISUAL_SHOTS;
const shots = path.resolve(process.cwd(), "../../docs/screenshots/frontend-upgrade", folder ?? "unused");
const API = "http://localhost:5100/api/v1";
const PASSWORD = "Str0ng-Pass-Word";
const run = Date.now();
const adminEmail = `e2e-${run}-visual-admin@example.com`;
const studentEmail = `e2e-${run}-visual-student@example.com`;
const widths = [360, 768, 1440];

test.describe.configure({ mode: "serial" });
test.skip(!folder, "Set VISUAL_SHOTS to capture screenshots.");

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
  await page.getByLabel("Last name").fill("Rahman");
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

/** Calls the API from inside the page, so the session cookies and CSRF token work as they do for a real user. */
async function call<T>(page: Page, method: string, route: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ API, method, route, body }) => {
      const csrf = await (await fetch(`${API}/auth/csrf`, { credentials: "include" })).json();
      const response = await fetch(`${API}${route}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.data.csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(`${method} ${route}: ${JSON.stringify(json)}`);
      return json.data;
    },
    { API, method, route, body },
  ) as Promise<T>;
}

async function capture(page: Page, name: string, width: number, theme: string) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const offenders = overflow <= 0 ? [] : await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(-6)
      .map((element) => `${element.tagName}.${String(element.getAttribute("class")).slice(0, 60)} right=${Math.round(element.getBoundingClientRect().right)} text=${(element.textContent ?? "").slice(0, 30)}`),
  );
  expect.soft(overflow, `${name} at ${width} scrolls sideways: ${offenders.join(" || ")}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(shots, `${name}-${width}-${theme}.png`), fullPage: true });
}

const seed = [
  { skill: "LISTENING", title: "Listening for detail", description: "Follow conversations and lectures, and catch the answer the first time you hear it." },
  { skill: "READING", title: "Reading strategies", description: "Skim, scan and manage your time across three long passages." },
  { skill: "WRITING", title: "Writing Task 2 essentials", description: "Plan a clear argument and develop it in well-organised paragraphs." },
  { skill: "SPEAKING", title: "Speaking with confidence", description: "Extend your answers and keep talking through the long turn." },
];

let courseId = "";
let resourceId = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await signUp(page, adminEmail, "Adil");
  await signUp(page, studentEmail, "Sadia");
  await db((c) => c.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.code = 'ADMIN'`, [adminEmail]));

  await signIn(page, adminEmail);
  const modules = await call<{ id: string; skill: string | null }[]>(page, "GET", "/modules?pageSize=50");
  const created: { id: string; resources: string[] }[] = [];
  for (const item of seed) {
    const moduleId = modules.find((row) => row.skill === item.skill)?.id;
    const course = await call<{ id: string }>(page, "POST", "/courses", {
      title: `${item.title} ${run}`,
      description: item.description,
      moduleId,
      difficulty: "INTERMEDIATE",
      estimatedMinutes: 90,
      learningObjectives: ["Understand the task format", "Practise a repeatable method", "Check your own work"],
    });
    const section = await call<{ id: string }>(page, "POST", `/courses/${course.id}/sections`, { title: "Getting started" });
    const resources: string[] = [];
    for (const title of ["What to expect", "A method you can repeat", "Common mistakes"]) {
      const resource = await call<{ id: string }>(page, "POST", `/sections/${section.id}/resources`, { type: "ARTICLE", title, durationMinutes: 15, body: "Read the first sentence of each paragraph, then decide where to look for detail.\n\nThis lesson is sample text for design review." });
      resources.push(resource.id);
    }
    await call(page, "POST", `/courses/${course.id}/publish`);
    created.push({ id: course.id, resources });
  }
  await context.clearCookies();

  await signIn(page, studentEmail);
  await call(page, "PATCH", "/profile/preferences", { examType: "ACADEMIC", targetBand: 7, examDate: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10), dailyGoalMinutes: 30, weeklyStudyHours: 8, preferredSkills: ["READING", "WRITING"] });
  for (const [index, course] of created.slice(0, 3).entries()) {
    await call(page, "POST", "/enrollments", { courseId: course.id });
    for (const id of course.resources.slice(0, index + 1)) await call(page, "POST", "/progress", { resourceId: id, status: "COMPLETED", minutesSpent: 12 });
  }
  await call(page, "POST", "/planner/tasks", { title: "Practise skimming a passage", scheduledDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), skill: "READING" });
  courseId = created[0]!.id;
  resourceId = created[0]!.resources[1]!;
  await context.close();
});

test.afterAll(async () => {
  await db((c) => c.query("DELETE FROM users WHERE email LIKE $1", [`e2e-${run}-%`]));
});

const isBaseline = folder === "before";
const themes = isBaseline ? (["light"] as const) : (["light", "dark"] as const);

for (const theme of themes) {
  const sizes = theme === "light" ? widths : [360, 1440];

  test(`public pages, ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    for (const width of sizes) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, route] of [["home", "/"], ["login", "/login"]] as const) {
        await page.goto(route);
        await capture(page, name, width, theme);
      }
    }
  });

  test(`student pages, ${theme}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await signIn(page, studentEmail);
    const routes: [string, string][] = [
      ["dashboard", "/dashboard"],
      ["learning", "/learning"],
      ["courses", "/courses"],
      ["course", `/courses/${courseId}`],
      ["lesson", `/courses/${courseId}/resources/${resourceId}`],
      ["practice", "/practice"],
      ["profile", "/profile"],
      ["settings", "/settings"],
    ];
    if (!isBaseline) for (const skill of ["listening", "reading", "writing", "speaking"]) routes.push([`exam-${skill}`, `/practice/preview/${skill}`]);
    for (const width of sizes) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, route] of routes) {
        await page.goto(route);
        await capture(page, name, width, theme);
      }
    }
  });

  test(`admin pages, ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await signIn(page, adminEmail);
    for (const width of sizes) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, route] of [["admin", "/admin"], ["admin-users", "/admin/users"]] as const) {
        await page.goto(route);
        await capture(page, name, width, theme);
      }
    }
  });
}
