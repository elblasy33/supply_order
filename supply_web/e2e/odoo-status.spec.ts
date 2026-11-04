import { expect, test, type Page } from "@playwright/test";

const MOCK = "http://localhost:8070";
const setMock = (page: Page, mode: "up" | "down" | "slow") => page.request.get(`${MOCK}/__mode?m=${mode}`);
const recheck = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("odoo-status-refresh")));

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill("admin");
  await page.getByLabel("كلمة المرور").fill("secret-pass-1");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL("/");
}

test.afterEach(async ({ page }) => { await setMock(page, "up"); });

test("the Odoo connection state is always on screen: ok, then down with a banner, then back", async ({ page }) => {
  await signIn(page);
  const pill = page.getByRole("status", { name: "متصل بأودو" }).first();
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("data-odoo-state", "ok");
  await expect(pill).toContainText(/\d+ms/); // how fast it answers
  await expect(page.getByRole("alert").filter({ hasText: "أودو غير متاح" })).toHaveCount(0);
  await page.screenshot({ path: "e2e/shots/30-odoo-ok.png" });

  await setMock(page, "down");
  await recheck(page);
  const down = page.getByRole("status", { name: "أودو غير متاح" }).first();
  await expect(down).toHaveAttribute("data-odoo-state", "down");
  const banner = page.getByRole("alert").filter({ hasText: "أودو غير متاح" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("لن تُحفظ تغييراتك");
  await page.screenshot({ path: "e2e/shots/31-odoo-down.png" });

  // it follows the user from screen to screen
  await page.getByRole("link", { name: "أوامر التوريد" }).first().click();
  await expect(page.getByRole("status", { name: "أودو غير متاح" }).first()).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "أودو غير متاح" }).first()).toBeVisible();

  // back online: the retry button clears it
  await setMock(page, "up");
  await page.getByRole("button", { name: "إعادة المحاولة" }).first().click();
  await expect(page.getByRole("status", { name: "متصل بأودو" }).first()).toHaveAttribute("data-odoo-state", "ok");
  await expect(page.getByRole("alert").filter({ hasText: "أودو غير متاح" })).toHaveCount(0);
});

test("slow Odoo is flagged, and the pill is in the phone header and the collapsed sidebar", async ({ page }) => {
  await signIn(page);
  await setMock(page, "slow");
  await recheck(page);
  await expect(page.getByRole("status", { name: "أودو بطيء" }).first()).toHaveAttribute("data-odoo-state", "slow", { timeout: 15_000 });
  await setMock(page, "up");
  await recheck(page);
  await expect(page.getByRole("status", { name: "متصل بأودو" }).first()).toHaveAttribute("data-odoo-state", "ok");

  // collapsed sidebar: just the icon, still named for screen readers and hover
  await page.getByRole("button", { name: "طيّ الشريط الجانبي" }).click();
  const rail = page.locator("aside[data-collapsed='true']").getByRole("status", { name: "متصل بأودو" });
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "توسيع الشريط الجانبي" }).click();

  // phone: right in the top bar
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("header").getByRole("status", { name: "متصل بأودو" })).toBeVisible();
  await setMock(page, "down");
  await recheck(page);
  await expect(page.locator("header").getByRole("status", { name: "أودو غير متاح" })).toBeVisible();
  await page.screenshot({ path: "e2e/shots/32-odoo-down-phone.png" });
});

test("English wording of the connection state", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "English" }).first().click();
  await expect(page.getByRole("status", { name: "Connected to Odoo" }).first()).toBeVisible();
  await setMock(page, "down");
  await recheck(page);
  await expect(page.getByRole("alert").filter({ hasText: "Odoo is unreachable" })).toContainText("will not be saved");
  await setMock(page, "up");
  await page.getByRole("button", { name: "العربية" }).first().click();
});
