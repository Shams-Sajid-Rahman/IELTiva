import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const PASSWORD = "Str0ng-Pass-Word";
const run = Date.now();
const email = `e2e-${run}-design@example.com`;
const examRoutes = ["/practice/preview/listening", "/practice/preview/reading", "/practice/preview/writing", "/practice/preview/speaking"];

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function fits(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/register");
  await page.getByLabel("First name").fill("Nadia");
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
  await context.close();
});

test.afterAll(async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  await client.query("DELETE FROM users WHERE email LIKE $1", [`e2e-${run}-%`]);
  await client.end();
});

test("the public site makes no invented claims", async ({ page }) => {
  await page.goto("/");
  const text = (await page.locator("main").innerText()).toLowerCase();
  expect(text).toContain("price announced at launch");
  await page.getByRole("tab", { name: "Timed practice" }).click();
  await expect(page.getByRole("tabpanel").getByText("In development")).toBeVisible();
  expect(text).not.toMatch(/[৳$€£]\s?\d|\bbdt\s?\d|\btk\s?\d/);
  expect(text).not.toMatch(/\d+\+? (students|learners|users)/);
  await expect(page.locator("blockquote")).toHaveCount(0);
});

test("the band calculator responds, and stays clear that it isn't a score", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Overall band 6.5")).toBeAttached();
  const writing = page.getByRole("slider", { name: "Writing" });
  await writing.focus();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowLeft");
  await expect(writing).toHaveValue("4");
  await expect(page.getByText("Overall band 6.0")).toBeAttached();
  await expect(page.getByText(/isn't a prediction or an IELTiva score/)).toBeVisible();
});

test("exam previews need an account", async ({ page }) => {
  await page.goto(examRoutes[0]!);
  await expect(page).toHaveURL(/\/login/);
});

test("the exam screens have no site navigation and pass checks at every width and theme", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    for (const width of [360, 768, 1024, 1440, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of examRoutes) {
        await page.goto(route);
        await expect(page.getByRole("timer").first()).toBeVisible();
        await page.waitForTimeout(350);
        await expect(page.getByRole("navigation", { name: "Student navigation" })).toHaveCount(0);
        await fits(page, `${route} ${width} ${theme}`);
        const axe = await new AxeBuilder({ page }).analyze();
        expect(axe.violations.map((v) => `${route} ${width} ${theme} ${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      }
    }
  }
});

test("reading shows one pane on phones and both on larger screens", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/practice/preview/reading");
  await expect(page.getByRole("heading", { name: "Gardens above the city" })).toBeVisible();
  await expect(page.getByText("Roofs in cities were once used mainly for gardens.")).toBeHidden();
  await page.getByRole("group", { name: "Choose what to show" }).getByRole("button", { name: "Questions" }).click();
  await expect(page.getByText("Roofs in cities were once used mainly for gardens.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gardens above the city" })).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("heading", { name: "Gardens above the city" })).toBeVisible();
  await expect(page.getByText("Roofs in cities were once used mainly for gardens.")).toBeVisible();
  const scrolls = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
  expect(scrolls, "panes scroll, not the page").toBe(true);
});

test("the audio player plays, and speaking never asks for the microphone", async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => {
    (window as unknown as { micCalls: number }).micCalls = 0;
    const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (navigator.mediaDevices && original) {
      navigator.mediaDevices.getUserMedia = (constraints) => {
        (window as unknown as { micCalls: number }).micCalls += 1;
        return original(constraints);
      };
    }
  });
  await page.goto("/practice/preview/listening");
  await page.getByRole("button", { name: "Play recording" }).click();
  await expect(page.getByRole("button", { name: "Pause recording" })).toBeVisible();
  await page.getByRole("button", { name: "Pause recording" }).click();

  await page.goto("/practice/preview/speaking");
  await page.getByRole("button", { name: "Start speaking" }).click();
  await expect(page.getByText("Speak now")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  expect(await page.evaluate(() => (window as unknown as { micCalls: number }).micCalls)).toBe(0);
});

test("finishing an exam makes no save or marking request", async ({ page }) => {
  await signIn(page);
  await page.goto("/practice/preview/writing");
  await page.waitForLoadState("networkidle");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/")) writes.push(request.url());
  });
  await page.getByLabel("Your answer for Task 1").fill("Car use declined while cycling grew.");
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Preview finished" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("touch devices get large targets and no sideways scrolling", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: "http://localhost:3100", viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signIn(page);
  for (const route of ["/dashboard", "/courses", "/learning", "/practice", "/profile", "/settings", ...examRoutes]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await fits(page, `touch ${route}`);
  }
  const box = await page.getByRole("button", { name: "Finish" }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(40);
  await context.close();
});

test("very wide screens keep the layout contained", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 2560, height: 1300 });
  await page.goto("/dashboard");
  await fits(page, "dashboard at 2560");
  const main = await page.locator("main").boundingBox();
  expect(main!.width).toBeLessThanOrEqual(1536);
});

test("reduced-motion users see the final values straight away", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "IELTS preparation that shows you what to do next" })).toBeVisible();
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await expect(page.getByText("Assessment pack")).toBeVisible();
  await context.close();
});
