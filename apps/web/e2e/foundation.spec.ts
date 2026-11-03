import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 360, height: 780 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const themes = ["light", "dark"] as const;
const shots = path.resolve(process.cwd(), "../../docs/screenshots/phase-1");

async function open(page: Page, url: string, theme: string) {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(url, { waitUntil: "networkidle" });
}

// Scrolling triggers every once-only reveal, so full-page checks see the final state.
async function settle(page: Page) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);
}

for (const vp of viewports) {
  for (const theme of themes) {
    for (const [pageName, url] of [["home", "/"], ["design-system", "/design-system"]] as const) {
      test(`${pageName} ${vp.name} ${theme}`, async ({ page }) => {
        const problems: string[] = [];
        page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
        page.on("pageerror", (e) => problems.push(e.message));

        await page.setViewportSize({ width: vp.width, height: vp.height });
        await open(page, url, theme);
        await settle(page);

        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);

        const axe = await new AxeBuilder({ page }).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
        expect(problems).toEqual([]);

        await page.screenshot({ path: path.join(shots, `${pageName}-${vp.name}-${theme}.png`), fullPage: true });
      });
    }
  }
}

test("theme choice persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("mobile menu navigates and closes", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Design system" }).click();
  await expect(page).toHaveURL(/design-system/);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("skip link is reachable first and moves to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("reduced motion still shows content", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/design-system");
  await page.locator("#motion").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "Listening", exact: true })).toBeVisible();
  await context.close();
});

test("unknown pages show the branded not-found page", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
});
