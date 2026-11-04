import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/shots/${name}.png`, fullPage: true });

async function login(page: Page, username: string, password: string, expectFailure = false) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  if (!expectFailure) await page.waitForURL("/");
}

test("first run creates the administrator and lands on the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("الاسم").fill("مدير النظام");
  await page.getByLabel("اسم المستخدم").fill("admin");
  await page.getByLabel(/كلمة المرور/).fill("secret-pass-1");
  await page.getByRole("button", { name: /إنشاء الحساب/ }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: /أهلاً مدير النظام/ })).toBeVisible();
  await expect(page.getByText("آخر الأوامر")).toBeVisible();
  await shot(page, "01-dashboard");
});

test("wrong password is refused, right one works, logout returns to login", async ({ page }) => {
  await login(page, "admin", "wrong-password", true);
  await expect(page.locator("form [role=alert]")).toContainText("غير صحيحة");
  await login(page, "admin", "secret-pass-1");
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "تسجيل الخروج" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login/);
});

test("create an order, confirm it, deliver, invoice", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/orders/new");
  await page.getByPlaceholder("ابحث عن عميل…").fill("النور");
  await page.getByRole("option", { name: /شركة النور/ }).click();
  await page.getByPlaceholder(/مثال: 11100/).fill("20200");
  await page.getByPlaceholder(/ابحث عن صنف/).fill("شيبس");
  await page.getByRole("option", { name: /شيبس حار/ }).click();
  await page.getByPlaceholder(/ابحث عن صنف/).fill("عصير");
  await page.getByRole("option", { name: /عصير/ }).click();
  await page.getByPlaceholder("أو امسح باركود ثم Enter").fill("6221000000011");
  await page.getByPlaceholder("أو امسح باركود ثم Enter").press("Enter");
  await expect(page.getByLabel("الكمية").first()).toHaveValue("2"); // scanning the same item raises the quantity
  await shot(page, "02-new-order");
  await page.getByRole("button", { name: /إنشاء الأمر/ }).click();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByText("مسودة").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /شيبس حار/ })).toBeVisible();
  await shot(page, "03-order-draft");

  await page.getByRole("button", { name: /تأكيد الأمر/ }).click();
  await expect(page.getByText("مؤكد").first()).toBeVisible();
  await page.getByRole("button", { name: /تجهيز التسليم/ }).click();
  await expect(page.getByText("WH/OUT/").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /إنشاء فاتورة/ })).toBeVisible();
  await page.getByRole("button", { name: /إنشاء فاتورة/ }).click();
  await expect(page.getByText("INV/2026/").first()).toBeVisible();
  await shot(page, "04-order-delivered-invoiced");
});

test("scan, edit with a reason, substitute, remove — and the change log tells the story", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/orders?state=confirmed");
  await page.getByRole("link", { name: /SUP\/2026\/00101/ }).click();
  const scan = page.getByLabel(/مسح باركود/);
  await scan.fill("6221000000028");
  await scan.press("Enter");
  await expect(page.getByText(/زادت الكمية/)).toBeVisible();
  await scan.fill("6221000000042"); // new item on a confirmed order
  await scan.press("Enter");
  await expect(page.getByText(/أُضيف الصنف/)).toBeVisible();
  await scan.fill("0000");
  await scan.press("Enter");
  await expect(page.getByText(/غير معروف/)).toBeVisible();

  const row = page.getByRole("row", { name: /شيبس حار/ });
  await row.getByRole("button", { name: "تعديل" }).click();
  const panel = page.getByRole("group", { name: "تعديل السطر" });
  await panel.getByLabel("الكمية", { exact: true }).fill("45");
  await expect(panel.getByRole("button", { name: "حفظ", exact: true })).toBeDisabled(); // confirmed order: a reason is needed
  await panel.getByLabel(/سبب التعديل/).fill("العميل طلب زيادة");
  await panel.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page.getByText("تم حفظ التعديل.")).toBeVisible();
  await expect(page.getByText("العميل طلب زيادة")).toBeVisible();

  await page.getByRole("row", { name: /شيبس جبنة/ }).getByRole("button", { name: "استبدال" }).click();
  await page.getByRole("dialog").getByPlaceholder(/ابحث عن صنف/).fill("ملح");
  await page.getByRole("option", { name: /ملح/ }).click();
  await page.getByPlaceholder(/الصنف نفد/).fill("نفد من المخزن");
  await page.getByRole("dialog").getByRole("button", { name: "استبدال", exact: true }).click();
  await expect(page.getByText(/المطلوب أصلاً/)).toBeVisible();
  await expect(page.getByText("نفد من المخزن").first()).toBeVisible();
  await shot(page, "05-order-changes");
});

test("printing goes through the app and keeps the Odoo key server-side", async ({ page, request }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/orders?state=confirmed");
  await page.getByRole("link", { name: /SUP\/2026\/00101/ }).click();
  await page.getByRole("button", { name: /طباعة/ }).click();
  await expect(page.getByRole("link", { name: /PDF/ }).first()).toBeVisible();
  const res = await page.request.get("/api/print/quotation/pdf/101");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect((await res.body()).toString().startsWith("%PDF")).toBeTruthy();
  const anon = await request.get("/api/print/quotation/pdf/101");
  expect(anon.status()).toBe(401);
  const html = await page.content();
  expect(html).not.toContain("test-key");
});

test("permissions are decided in the app: roles, users, and enforcement", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/settings/roles");
  await page.getByRole("button", { name: /دور جديد/ }).click();
  await page.getByLabel("اسم الدور").fill("مشاهد فقط");
  await page.getByLabel("عرض أوامر التوريد").check();
  await page.getByRole("button", { name: "إنشاء الدور" }).click();
  await expect(page.getByText("تم حفظ الدور.")).toBeVisible();
  await shot(page, "06-roles");

  await page.goto("/settings/users");
  await page.getByRole("button", { name: /مستخدم جديد/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("الاسم").fill("سارة");
  await dlg.getByLabel("اسم المستخدم").fill("sara");
  await dlg.getByLabel(/كلمة المرور/).fill("sara-pass-123");
  await dlg.getByLabel("الدور").selectOption({ label: "مشاهد فقط" });
  await dlg.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByText("تم الحفظ.")).toBeVisible();
  await shot(page, "07-users");

  await page.context().clearCookies();
  await login(page, "sara", "sara-pass-123");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "الإعدادات" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "المستخدمون" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /أمر توريد جديد/ })).toHaveCount(0);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/forbidden/);
  await page.goto("/orders/new");
  await expect(page).toHaveURL(/forbidden/);
  await page.goto("/orders?state=confirmed");
  await page.getByRole("link", { name: /SUP\/2026\/00101/ }).click();
  await expect(page.getByRole("button", { name: /تأكيد|إغلاق|إلغاء|تجهيز/ })).toHaveCount(0);
  await expect(page.getByLabel(/مسح باركود/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /طباعة/ })).toHaveCount(0);
  const res = await page.request.get("/api/print/quotation/pdf/101");
  expect(res.status()).toBe(403);
});

test("alerts, reconciliation and rebates", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/alerts");
  await expect(page.getByText("LOT-A1")).toBeVisible();
  await expect(page.getByText(/منتهية منذ/)).toBeVisible();
  await shot(page, "08-alerts");
  await page.goto("/alerts?tab=purchases");
  await expect(page.getByText("P00012")).toBeVisible();

  await page.goto("/accounting/reconcile");
  await page.getByPlaceholder("ابحث عن عميل أو مورد…").fill("النور");
  await page.getByRole("option", { name: /شركة النور/ }).click();
  await page.getByRole("button", { name: "تحميل" }).click();
  await expect(page.getByText("INV/2026/0001")).toBeVisible();
  await expect(page.getByRole("button", { name: "تسوية", exact: true })).toBeDisabled(); // no invoice ticked yet
  await page.getByLabel("تحديد INV/2026/0001").check();
  await page.getByLabel("تحديد INV/2026/0002").check();
  await shot(page, "09-reconcile");
  await page.getByRole("button", { name: "تسوية", exact: true }).click();
  await expect(page.getByText(/تمت التسوية — REC-/)).toBeVisible();

  await page.goto("/rebates");
  await page.getByRole("button", { name: "تكوين المخصص" }).click();
  await expect(page.getByText("مكوَّن (للتسوية)").first()).toBeVisible();
  await page.getByRole("button", { name: "إصدار إشعار" }).click();
  await expect(page.getByText("مُسوّى").first()).toBeVisible();
  await shot(page, "10-rebates");
});

test("Odoo settings page tests the connection; mobile layout works", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/settings/odoo");
  await page.getByRole("button", { name: "اختبار الاتصال" }).click();
  await expect(page.getByText("الاتصال سليم.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/orders");
  await page.getByRole("button", { name: "القائمة" }).click();
  await expect(page.getByRole("link", { name: "أوامر التوريد" }).first()).toBeVisible();
  await shot(page, "11-mobile-menu");
});

test("double clicking an action does the work once (idempotency)", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/orders/new");
  await page.getByPlaceholder("ابحث عن عميل…").fill("النور");
  await page.getByRole("option", { name: /شركة النور/ }).click();
  await page.getByPlaceholder(/ابحث عن صنف/).fill("ملح");
  await page.getByRole("option", { name: /ملح/ }).click();
  const before = await (await page.request.get("http://localhost:8070/__calls", { headers: { Authorization: "Bearer test-key" } })).json();
  const createsBefore = before.filter((c: { method: string }) => c.method === "order_create").length;
  const btn = page.getByRole("button", { name: /إنشاء الأمر/ });
  await btn.dblclick();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  const after = await (await page.request.get("http://localhost:8070/__calls", { headers: { Authorization: "Bearer test-key" } })).json();
  expect(after.filter((c: { method: string }) => c.method === "order_create").length - createsBefore).toBeLessThanOrEqual(1);
});
