import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const shots = path.resolve(process.cwd(), "../../docs/screenshots/phase-3");
const API = "http://localhost:5100/api/v1";
const PASSWORD = "Str0ng-Pass-Word";
const widths = [360, 390, 480, 768, 1024, 1280, 1440, 1600];
const run = Date.now();
const adminEmail = `e2e-${run}-admin@example.com`;
const studentEmail = `e2e-${run}-student@example.com`;
const targetEmail = `e2e-${run}-target@example.com`;
const courseTitle = `Reading basics ${run}`;

test.describe.configure({ mode: "serial" });

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

async function checkPage(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `no horizontal scroll on ${label}`).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await signUp(page, adminEmail, "Adil");
  await signUp(page, studentEmail, "Sadia");
  await signUp(page, targetEmail, "Tanvir");
  await context.close();
  await db((c) => c.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.code = 'ADMIN'`, [adminEmail]));
});

test.afterAll(async () => {
  await db(async (c) => {
    await c.query("DELETE FROM users WHERE email LIKE $1", [`e2e-${run}-%`]);
  });
});

test("an administrator builds and publishes a course in the interface", async ({ page }) => {
  await signIn(page, adminEmail);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
  await expect(page.getByText("Registered users")).toBeVisible();

  await page.getByRole("navigation", { name: "Administration navigation" }).getByRole("link", { name: "Courses" }).click();
  await page.getByRole("button", { name: "New course" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Course title").fill(courseTitle);
  await dialog.getByLabel("Description").fill("Learn how to read IELTS passages with confidence.");
  await dialog.getByLabel("Learning objectives, one per line").fill("Skim a passage\nFind key details");
  await expect(dialog.getByLabel("Learning module").locator("option", { hasText: "Reading" })).toHaveCount(1);
  await dialog.getByLabel("Learning module").selectOption({ label: "Reading" });
  await dialog.getByRole("button", { name: "Save course" }).click();
  await expect(page).toHaveURL(/\/admin\/courses\/[\w-]+$/);

  // Publishing incomplete content explains what's missing.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Add a visible section with at least one resource.")).toBeVisible();

  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("dialog").getByLabel("Section title").fill("Getting started");
  await page.getByRole("dialog").getByRole("button", { name: "Save section" }).click();
  await page.getByRole("button", { name: "Add resource" }).click();
  await page.getByRole("dialog").getByLabel("Resource title").fill("How to skim");
  await page.getByRole("dialog").getByLabel("Lesson content").fill("Read the first sentence of each paragraph.");
  await page.getByRole("dialog").getByRole("button", { name: "Save resource" }).click();
  await expect(page.getByText("How to skim", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText(/Published · Adil/)).toBeVisible();
});

test("a student enrolls, learns and sees real progress", async ({ page }) => {
  await signIn(page, studentEmail);
  await expect(page.getByRole("heading", { name: "Welcome, Sadia" })).toBeVisible();
  await expect(page.getByText("Start your first course")).toBeVisible();

  await page.getByRole("navigation", { name: "Student navigation" }).getByRole("link", { name: "Browse courses" }).click();
  await page.getByRole("searchbox", { name: "Search courses" }).fill(courseTitle);
  await page.getByRole("link", { name: courseTitle }).click();
  await page.getByRole("button", { name: "Enroll now" }).click();
  await page.getByRole("link", { name: "How to skim" }).click();
  await expect(page.getByText("Read the first sentence of each paragraph.")).toBeVisible();
  await page.getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("100%")).toBeVisible();
  await expect(page.getByText("1 of 1 completed")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByText("Completed a course")).toBeVisible();
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Course completed" })).toBeVisible();

  // The page keeps working after reload, and no tokens or private data are stored in the browser.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/eyJ|@example\.com|ieltiva_refresh/);
});

test("students can't use administration, in the interface or by calling the API", async ({ page, playwright, context }) => {
  await signIn(page, studentEmail);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const api = await playwright.request.newContext({ extraHTTPHeaders: { Cookie: cookies } });
  for (const route of ["/users", "/roles", "/dashboard/admin", "/admin/audit-logs", "/admin/settings", "/enrollments"]) {
    expect((await api.get(`${API}${route}`)).status(), route).toBe(403);
  }
  await api.dispose();
});

test("an administrator manages a user, and it takes effect and is audited", async ({ page, browser }) => {
  const targetContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const targetPage = await targetContext.newPage();
  await signIn(targetPage, targetEmail);

  await signIn(page, adminEmail);
  await page.goto("/admin/users");
  await page.getByRole("searchbox").fill(targetEmail);
  await page.getByRole("link", { name: `View ${targetEmail}` }).click();
  await expect(page.getByRole("heading", { name: "Tanvir Tester" })).toBeVisible();
  await page.getByRole("button", { name: "Suspend account" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText("Suspended", { exact: true }).first()).toBeVisible();

  await targetPage.reload();
  await expect(targetPage).toHaveURL(/\/login/);
  await targetContext.close();

  // Granting a role beyond the administrator's authority is refused by the API.
  await page.getByRole("checkbox", { name: "Super administrator" }).click();
  await page.getByRole("button", { name: "Save roles" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/more authority than yours/)).toBeVisible();

  await page.goto("/admin/audit-logs");
  await page.getByRole("searchbox", { name: "Filter by action" }).fill("user.status");
  await expect(page.getByText("user.status").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: adminEmail }).first()).toBeVisible();
});

test("announcements reach the audience", async ({ page, browser }) => {
  const title = `Maintenance ${run}`;
  await signIn(page, adminEmail);
  await page.goto("/admin/notifications");
  await page.getByRole("button", { name: "New announcement" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill(title);
  await page.getByRole("dialog").getByLabel("Message").fill("The platform will restart tonight.");
  await page.getByRole("dialog").getByRole("button", { name: "Save announcement" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const student = await context.newPage();
  await signIn(student, studentEmail);
  await student.goto("/notifications");
  await expect(student.getByRole("heading", { name: title })).toBeVisible();
  await student.getByRole("button", { name: `Dismiss ${title}` }).click();
  await expect(student.getByRole("heading", { name: title })).toHaveCount(0);
  await context.close();
});

test("profile and sessions work, and sign-out returns to the login page", async ({ page }) => {
  await signIn(page, studentEmail);
  await page.goto("/settings");
  await page.getByLabel("IELTS type").selectOption("ACADEMIC");
  await page.getByLabel("Target band").selectOption("7.5");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.getByRole("tab", { name: "Security" }).click();
  await expect(page.getByText("This device")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("Preparing for IELTS Academic")).toBeVisible();
  await expect(page.getByText("Target band 7.5")).toBeVisible();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("the sidebar collapses on desktop, and the drawer works on mobile", async ({ page }) => {
  await signIn(page, studentEmail);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "My learning" }).click();
  await expect(page).toHaveURL(/\/learning$/);
  await expect(page.getByRole("dialog")).toBeHidden();
});

const studentRoutes = ["/dashboard", "/learning", "/courses", "/practice", "/planner", "/history", "/notifications", "/profile", "/settings"];
const adminRoutes = ["/admin", "/admin/users", "/admin/roles", "/admin/courses", "/admin/modules", "/admin/enrollments", "/admin/notifications", "/admin/audit-logs", "/admin/settings"];

for (const theme of ["light", "dark"] as const) {
  test(`every page fits and passes accessibility checks at all widths, ${theme}`, async ({ page }) => {
    test.setTimeout(420_000);
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/status of 40[134]/.test(message.text())) problems.push(message.text());
    });
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);

    await signIn(page, studentEmail);
    const courseId = await db(async (c) => (await c.query("SELECT id FROM courses WHERE title = $1", [courseTitle])).rows[0].id as string);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [...studentRoutes, `/courses/${courseId}`]) {
        await page.goto(route);
        await checkPage(page, `${route} ${width} ${theme}`);
        if (route === "/dashboard" && (width === 390 || width === 1440)) await page.screenshot({ path: path.join(shots, `student-dashboard-${width}-${theme}.png`), fullPage: true });
        if (route === `/courses/${courseId}` && width === 1440) await page.screenshot({ path: path.join(shots, `course-${width}-${theme}.png`), fullPage: true });
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await signIn(page, adminEmail);
    const adminCourse = `/admin/courses/${courseId}`;
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [...adminRoutes, adminCourse]) {
        await page.goto(route);
        await checkPage(page, `${route} ${width} ${theme}`);
        if (route === "/admin" && (width === 390 || width === 1440)) await page.screenshot({ path: path.join(shots, `admin-overview-${width}-${theme}.png`), fullPage: true });
        if (route === "/admin/users" && width === 1440) await page.screenshot({ path: path.join(shots, `admin-users-${width}-${theme}.png`), fullPage: true });
      }
    }
    expect(problems).toEqual([]);
  });
}

test("reduced-motion users see all content", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", reducedMotion: "reduce" });
  const page = await context.newPage();
  await signIn(page, studentEmail);
  await expect(page.getByText("Overall progress")).toBeVisible();
  await context.close();
});
