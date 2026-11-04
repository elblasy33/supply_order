import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const feed = path.resolve("e2e/fixtures/camera.y4m");
test.skip(!fs.existsSync(feed), "no fake camera feed (needs ffmpeg)");

test.use({
  permissions: ["camera"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${feed}`],
  },
});

async function signIn(page: Page) {
  await page.goto("/login");
  if (page.url().includes("/setup")) {
    await page.getByLabel("الاسم").fill("مدير النظام");
    await page.getByLabel("اسم المستخدم").fill("admin");
    await page.getByLabel(/كلمة المرور/).fill("secret-pass-1");
    await page.getByRole("button", { name: /إنشاء الحساب/ }).click();
  } else {
    await page.getByLabel("اسم المستخدم").fill("admin");
    await page.getByLabel("كلمة المرور").fill("secret-pass-1");
    await page.getByRole("button", { name: "دخول" }).click();
  }
  await page.waitForURL("/");
}

test("camera counting on a transfer: one count per label, again after it left the view", async ({ page }) => {
  await signIn(page);
  // a delivery of 5 + 5 units, counted from zero
  await page.goto("/orders/new");
  await page.getByPlaceholder("ابحث عن عميل…").fill("النور");
  await page.getByRole("option", { name: /شركة النور/ }).click();
  for (const name of ["شيبس حار", "شيبس جبنة"]) {
    await page.getByPlaceholder(/ابحث عن صنف/).fill(name);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
    await page.getByLabel("الكمية").last().fill("5");
  }
  await page.getByRole("button", { name: /إنشاء الأمر/ }).click();
  await page.getByRole("button", { name: /تأكيد الأمر/ }).click();
  await page.getByRole("button", { name: /تجهيز التسليم/ }).click();
  await expect(page).toHaveURL(/\/warehouse\/\d+$/);
  const hot = page.getByRole("spinbutton", { name: "كمية شيبس حار", exact: true });
  const cheese = page.getByRole("spinbutton", { name: "كمية شيبس جبنة", exact: true });
  await hot.fill("0");
  await cheese.fill("0");

  await page.getByRole("button", { name: "كاميرا الجوال" }).click();
  await expect(page.getByLabel("بث الكاميرا")).toBeVisible();
  await expect(page.getByText("0", { exact: true }).first()).toBeVisible();

  // first sighting of label A: counted once, even though it stays in view for 1.5 s
  await expect(hot).toHaveValue("1", { timeout: 15_000 });
  await page.waitForTimeout(900);
  await expect(hot).toHaveValue("1");
  await expect(page.getByRole("status").filter({ hasText: "شيبس حار" })).toContainText("1/5");
  await page.screenshot({ path: "e2e/shots/23-camera-scanning.png", fullPage: true });

  // it leaves the view, comes back (a second box): counted again; then label B
  await expect(hot).toHaveValue("2", { timeout: 8_000 });
  await expect(cheese).toHaveValue("1", { timeout: 8_000 });
  await page.getByRole("button", { name: "إغلاق الكاميرا" }).click();
  await expect(hot).toHaveValue("2");
  await expect(page.getByText("تعديلات غير محفوظة")).toBeVisible();

  // the counts are saved and confirmed like any other
  await page.getByRole("button", { name: "حفظ الكميات" }).click();
  await expect(page.getByText("تم حفظ الكميات.")).toBeVisible();
  await expect(hot).toHaveValue("2");
});

test("the camera scanner on the order screen adds the scanned item", async ({ page }) => {
  await signIn(page);
  await page.goto("/orders/new");
  await page.getByPlaceholder("ابحث عن عميل…").fill("النور");
  await page.getByRole("option", { name: /شركة النور/ }).click();
  await page.getByRole("button", { name: "مسح بكاميرا الجوال" }).click();
  await expect(page.getByRole("status").filter({ hasText: "شيبس حار" })).toContainText("+1", { timeout: 15_000 });
  await expect(page.getByRole("cell", { name: /شيبس حار/ })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق الكاميرا" }).click();
});
