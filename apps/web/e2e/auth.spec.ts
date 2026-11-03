import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const shots = path.resolve(process.cwd(), "../../docs/screenshots/phase-2c");
const PASSWORD = "Str0ng-Pass-Word";
const widths = [360, 390, 768, 1024, 1440];
const themes = ["light", "dark"] as const;
const run = Date.now();
let count = 0;
const newEmail = () => `e2e-${run}-${++count}@example.com`;

async function db<T>(work: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function insertToken(table: "password_reset_tokens" | "email_verification_tokens", email: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await db((c) =>
    c.query(
      `INSERT INTO ${table} (id, user_id, token_hash, expires_at, updated_at)
       SELECT gen_random_uuid(), id, $1, now() + interval '1 hour', now() FROM users WHERE email = $2`,
      [hash, email],
    ),
  );
  return token;
}

async function registerViaUi(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("First name").fill("Ayesha");
  await page.getByLabel("Last name").fill("Rahman");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
}

async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
}

async function checkPage(page: Page) {
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}

test.afterAll(async () => {
  await db((c) => c.query("DELETE FROM users WHERE email LIKE $1", [`e2e-${run}-%`]));
});

for (const width of widths) {
  for (const theme of themes) {
    for (const route of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/verify-email/success", "/auth/google/result?status=error&reason=account_exists"]) {
      test(`${route} ${width} ${theme}`, async ({ page }) => {
        const problems: string[] = [];
        page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
        page.on("pageerror", (e) => problems.push(e.message));
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
        await page.goto(route, { waitUntil: "networkidle" });
        await checkPage(page);
        expect(problems).toEqual([]);
        if ((route === "/login" || route === "/register") && (width === 390 || width === 1440)) {
          await page.screenshot({ path: path.join(shots, `${route.slice(1)}-${width}-${theme}.png`), fullPage: true });
        }
      });
    }
  }
}

test("the full student journey works against the real API", async ({ page, context, playwright }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  const verification = await insertToken("email_verification_tokens", email);
  await page.goto(`/verify-email?token=${verification}`);
  await expect(page).toHaveURL(/\/verify-email\/success$/);
  await loginViaUi(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Ayesha" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome, Ayesha" })).toBeVisible();

  // Tokens stay in HTTP-only cookies, and aren't readable or stored by the page.
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "ieltiva_access")?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === "ieltiva_refresh")?.httpOnly).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie);
  expect(stored).not.toMatch(/eyJ|ieltiva_refresh|ieltiva_access/);

  // An expired access token is replaced silently.
  await context.clearCookies({ name: "ieltiva_access" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome, Ayesha" })).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await checkPage(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(shots, "dashboard-1440-light.png"), fullPage: true });

  // Keep this session's cookies, to prove they stop working after sign-out.
  const before = await context.cookies();
  const cookieHeader = before.map((c) => `${c.name}=${c.value}`).join("; ");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);

  const replay = await playwright.request.newContext({ extraHTTPHeaders: { Cookie: cookieHeader } });
  expect((await replay.get("http://localhost:5100/api/v1/auth/me")).status()).toBe(401);
  await replay.dispose();
});

test("security headers are sent, and an unsafe next path stays on this site", async ({ page, request }) => {
  const headers = (await request.get("/login")).headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");

  const email = newEmail();
  await registerViaUi(page, email);
  await page.goto("/login?next=/%09/evil.example");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL("http://localhost:3100/dashboard");
});

test("the reset token leaves the address bar once read", async ({ page }) => {
  await page.goto(`/reset-password?token=${"t".repeat(40)}`);
  await expect(page.getByLabel("New password")).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test("a wrong password shows a clear error and stays on the page", async ({ page }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  await loginViaUi(page, email, "Wrong-Pass-Word1");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a duplicate email is reported on the field", async ({ page }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  await page.goto("/register");
  await page.getByLabel("First name").fill("A");
  await page.getByLabel("Last name").fill("B");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
});

test("students can't open the admin area, and staff land on it", async ({ page }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  await loginViaUi(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  await expect(page.getByText("Administration", { exact: true })).toHaveCount(0);

  await db((c) =>
    c.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.code = 'ADMIN'`, [email]),
  );
  await page.reload();
  await expect(page.getByText("Administration", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("signed-in users are kept away from sign-in pages, and a next path is honoured", async ({ page }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("email verification works from a real token and can't be reused", async ({ page }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  const token = await insertToken("email_verification_tokens", email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/\/verify-email\/success$/);
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText("This link is invalid or has expired.")).toBeVisible();
  await loginViaUi(page, email);
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
});

test("password reset works from a real token and ends other sessions", async ({ page, browser }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  await loginViaUi(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);

  const token = await insertToken("password_reset_tokens", email);
  const other = await browser.newContext({ baseURL: "http://localhost:3100" });
  const resetPage = await other.newPage();
  const next = "N3w-Strong-Secret";
  await resetPage.goto(`/reset-password?token=${token}`);
  await resetPage.getByLabel("New password").fill(next);
  await resetPage.getByLabel("Confirm password").fill(next);
  await resetPage.getByRole("button", { name: "Update password" }).click();
  await expect(resetPage.getByRole("heading", { name: "Your password is updated" })).toBeVisible();
  await other.close();

  await page.reload();
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(next);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("forgot password gives the same confirmation for any email", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
});

test("the Google button reaches the backend and shows a clear message without credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/auth\/google\/result\?status=error&reason=google_unavailable/);
  await expect(page.getByText("Google sign-in isn't available right now.", { exact: false })).toBeVisible();
});

test("the login form works by keyboard with a visible focus indicator", async ({ page }) => {
  const email = newEmail();
  await registerViaUi(page, email);
  await page.goto("/login");
  const field = page.getByLabel("Email");
  await field.focus();
  const outline = await field.evaluate((el) => {
    const style = getComputedStyle(el);
    return `${style.outlineStyle} ${style.boxShadow}`;
  });
  expect(outline).not.toBe("none none");
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);
});
