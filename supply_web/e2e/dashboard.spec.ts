import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill("admin");
  await page.getByLabel("كلمة المرور").fill("secret-pass-1");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL("/");
}

test("dashboard: headline numbers, one chart per question, and what needs action", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "الفترة" })).toBeVisible();
  await expect(page.getByRole("link", { name: "30 يوم" })).toHaveAttribute("aria-current", "true");
  // headline tiles
  for (const label of ["قيمة الأوامر", "عدد الأوامر", "نسبة التنفيذ الفعلي", "أوامر تعدّلت بعد التأكيد"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("87.4%")).toBeVisible();
  await expect(page.getByRole("meter", { name: "نسبة التنفيذ الفعلي" })).toHaveAttribute("aria-valuenow", "87.4");
  // the action strip links to the lists
  await expect(page.getByRole("link", { name: /مسودات تنتظر التأكيد/ })).toHaveAttribute("href", "/orders?state=draft");
  // every chart family is there
  for (const name of ["قيمة الأوامر عبر الزمن", "حركة المخزن"]) await expect(page.getByRole("img", { name })).toBeVisible();
  for (const title of ["من التأكيد إلى الفوترة", "حالة الأوامر", "أكثر الأصناف طلباً", "أكبر الشركاء قيمةً", "ماذا تغيّر بعد التأكيد؟", "متى يتحرك المخزن؟", "الصلاحية: ما المعرَّض؟", "الخصومات المؤجلة"]) {
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  }
  await page.screenshot({ path: "e2e/shots/26-dashboard.png", fullPage: true });
});

test("dashboard: hover reads every series at that day; keyboard works too", async ({ page }) => {
  await signIn(page);
  const chart = page.getByRole("img", { name: "قيمة الأوامر عبر الزمن" });
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("توريد لعملاء");
  await expect(tip).toContainText("شراء من موردين");
  await expect(tip).toContainText(/\d{2}\/\d{2}\/2026/);
  await page.mouse.move(box.x + box.width * 0.6, box.y - 80);
  await expect(tip).toHaveCount(0);
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tooltip")).toBeVisible();

  // a bar column reads its own values
  const warehouse = page.getByRole("img", { name: "حركة المخزن" });
  await warehouse.locator("rect[tabindex]").nth(5).focus();
  await expect(page.getByRole("tooltip")).toContainText("تسليم");
});

test("dashboard: every chart has the same numbers as a table; legends name the series", async ({ page }) => {
  await signIn(page);
  const card = page.getByRole("region", { name: "قيمة الأوامر عبر الزمن" });
  await expect(card.getByText("توريد لعملاء")).toBeVisible(); // legend (two series)
  await card.getByRole("button", { name: "عرض كجدول" }).click();
  await expect(card.getByRole("columnheader", { name: "شراء من موردين" })).toBeVisible();
  expect(await card.locator("tbody tr").count()).toBe(30);
  await card.getByRole("button", { name: "عرض كجدول" }).click();
  await expect(page.getByRole("img", { name: "قيمة الأوامر عبر الزمن" })).toBeVisible();
});

test("dashboard: the period filter rescopes everything; switches change the ranking", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "7 يوم" }).click();
  await expect(page).toHaveURL(/days=7/);
  await page.getByRole("region", { name: "قيمة الأوامر عبر الزمن" }).getByRole("button", { name: "عرض كجدول" }).click();
  expect(await page.getByRole("region", { name: "قيمة الأوامر عبر الزمن" }).locator("tbody tr").count()).toBe(7);
  await page.getByRole("link", { name: "سنة" }).click();
  await expect(page).toHaveURL(/days=365/);
  await expect(page.getByRole("region", { name: "قيمة الأوامر عبر الزمن" })).toContainText("شهري"); // monthly buckets over a year

  const partners = page.getByRole("region", { name: "أكبر الشركاء قيمةً" });
  await expect(partners.getByText("شركة النور للتجارة")).toBeVisible();
  await partners.getByRole("button", { name: "موردون" }).click();
  await expect(partners.getByText("مورد الأمل")).toBeVisible();
  await expect(partners.getByText("شركة النور للتجارة")).toHaveCount(0);
});

test("dashboard in English and in the dark, on a phone and on a wide screen", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "English" }).first().click();
  await expect(page.getByRole("region", { name: "Order value over time" })).toBeVisible();
  await expect(page.getByText("Actual fulfilment rate", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Appearance/ }).first().click();
  await page.getByRole("button", { name: /Appearance/ }).first().click(); // system -> light -> dark
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: "e2e/shots/27-dashboard-dark-en.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "e2e/shots/28-dashboard-phone.png", fullPage: true });
  await page.setViewportSize({ width: 2560, height: 1300 });
  await page.screenshot({ path: "e2e/shots/29-dashboard-wide.png", fullPage: true });
  await page.getByRole("button", { name: "العربية" }).first().click();
});
