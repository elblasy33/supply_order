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
  // the transfer opens right away: this is where the real quantities are counted
  await expect(page).toHaveURL(/\/warehouse\/\d+$/);
  await expect(page.getByRole("heading", { name: /WH\/OUT\// })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "كمية شيبس حار", exact: true })).toHaveValue("2"); // reserved quantity is the starting point
  await page.getByRole("button", { name: "تعبئة كل المطلوب" }).click();
  await page.getByLabel(/رقم التشغيلة عصير/).fill("LOT-D1"); // lot-tracked item needs its lot
  await shot(page, "13-picking-counting");
  await page.getByRole("button", { name: /تأكيد التسليم/ }).click();
  await expect(page.getByText("تم التنفيذ.")).toBeVisible();
  await expect(page.getByText("منفّذ").first()).toBeVisible();
  await page.getByRole("link", { name: /SUP\/2026\// }).first().click();
  await expect(page.getByRole("button", { name: /إنشاء فاتورة/ })).toBeVisible(); // only what was delivered is invoiceable
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

async function newOrder(page: Page, items: [string, number][]) {
  await page.goto("/orders/new");
  await page.getByPlaceholder("ابحث عن عميل…").fill("النور");
  await page.getByRole("option", { name: /شركة النور/ }).click();
  for (const [name, qty] of items) {
    await page.getByPlaceholder(/ابحث عن صنف/).fill(name);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
    await page.getByLabel("الكمية").last().fill(String(qty));
  }
  await page.getByRole("button", { name: /إنشاء الأمر/ }).click();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await page.getByRole("button", { name: /تأكيد الأمر/ }).click();
  await expect(page.getByText("مؤكد").first()).toBeVisible();
  await page.getByRole("button", { name: /تجهيز التسليم/ }).click();
  await expect(page).toHaveURL(/\/warehouse\/\d+$/);
}

test("warehouse: short delivery with a backorder, scanning, then a return", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await newOrder(page, [["شيبس حار", 10], ["ملح", 4]]);
  const hot = page.getByRole("spinbutton", { name: "كمية شيبس حار", exact: true });
  const salt = page.getByRole("spinbutton", { name: "كمية ملح 1 كجم", exact: true });
  await expect(hot).toHaveValue("10"); // deliveries start from what is reserved
  await hot.fill("6");
  await salt.fill("4");
  await page.getByRole("button", { name: "حفظ الكميات" }).click();
  await expect(page.getByText("تم حفظ الكميات.")).toBeVisible();
  await expect(page.getByText(/ناقص/).first()).toBeVisible();

  // scanning counts one unit per scan
  const scan = page.getByLabel(/امسح باركود الصنف/);
  await scan.fill("6221000000011");
  await scan.press("Enter");
  await expect(page.getByRole("spinbutton", { name: "كمية شيبس حار", exact: true })).toHaveValue("7");
  await scan.fill("not-a-code");
  await scan.press("Enter");
  await expect(page.getByText(/لا يوجد شيء لـ/)).toBeVisible();

  await page.getByRole("button", { name: /تأكيد التسليم/ }).click();
  await expect(page.getByRole("dialog")).toContainText("بعض الكميات ناقصة");
  await shot(page, "14-picking-short");
  await page.getByRole("dialog").getByRole("button", { name: "تأكيد" }).click();
  await expect(page.getByText("تم التنفيذ.")).toBeVisible();
  await expect(page.getByText(/أُنشئ إذن للمتبقي/)).toBeVisible();
  await expect(page.getByText("أذونات المتبقي:")).toBeVisible();

  // the order shows what really moved; the backorder holds the rest
  await page.getByRole("link", { name: /SUP\/2026\// }).first().click();
  await expect(page.getByRole("row", { name: /شيبس حار/ })).toContainText("7");
  await shot(page, "15-order-after-delivery");

  // return part of it from the done transfer
  await page.getByRole("link", { name: "فتح" }).first().click();
  await expect(page.getByRole("button", { name: "إنشاء مرتجع" })).toBeVisible();
  await page.getByRole("button", { name: "إنشاء مرتجع" }).click();
  await page.getByRole("spinbutton", { name: "مرتجع شيبس حار" }).fill("2");
  await page.getByRole("dialog").getByRole("button", { name: "إنشاء المرتجع" }).click();
  await expect(page.getByText("تم إنشاء المرتجع وتنفيذه.")).toBeVisible();

  // the warehouse list finds the open backorder
  await page.goto("/warehouse");
  await expect(page.getByText(/متبقٍ من WH\/OUT/).first()).toBeVisible();
  await shot(page, "16-warehouse-list");
  await page.goto("/warehouse?state=done&kind=delivery");
  await expect(page.getByText("منفّذ").first()).toBeVisible();
});

test("warehouse: cancelling a transfer frees the order to plan another", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await newOrder(page, [["ملح", 3]]);
  await page.getByRole("button", { name: "إلغاء الإذن" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "نعم، ألغِ" }).click();
  await expect(page.getByText("أُلغي الإذن.")).toBeVisible();
  await page.getByRole("link", { name: /SUP\/2026\// }).first().click();
  await expect(page.getByRole("button", { name: /تجهيز التسليم/ })).toBeVisible();
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
  await page.goto("/warehouse");
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

test("connection settings: every failure is explained, only a working connection is saved", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
  await page.goto("/settings/odoo");
  const url = page.getByLabel("عنوان خادم أودو");
  const key = page.getByLabel("مفتاح API لمستخدم التكامل");
  const test = page.getByRole("button", { name: "فحص الاتصال" });
  await expect(page.getByText("من ملف البيئة")).toBeVisible();

  await url.fill("http://localhost:9"); // nothing listens there
  await key.fill("whatever");
  await test.click();
  await expect(page.getByText(/تعذّر الاتصال/)).toBeVisible();
  await expect(page.getByText("لم يُفحص بسبب خطأ سابق.").first()).toBeVisible();

  await url.fill("http://localhost:3100"); // an HTTP server that is not Odoo
  await test.click();
  await expect(page.getByText(/لا يبدو خادم أودو/)).toBeVisible();

  await url.fill("localhost:8070"); // scheme is optional
  await key.fill("wrong-key");
  await test.click();
  await expect(page.getByText(/رفض أودو المفتاح/)).toBeVisible();
  await page.getByRole("button", { name: "فحص وحفظ" }).click();
  await expect(page.getByText(/لم يُحفظ الاتصال/).first()).toBeVisible();

  await key.fill("no-user-key");
  await test.click();
  await expect(page.getByText(/service_user_id/).first()).toBeVisible();

  await key.fill("test-key");
  await page.getByRole("button", { name: "فحص وحفظ" }).click();
  await expect(page.getByText("تم الحفظ — الاتصال سليم.")).toBeVisible();
  await expect(page.getByText(/mock_db/)).toBeVisible();
  await expect(page.locator("li", { hasText: "supply_api" }).first()).toBeVisible();
  await shot(page, "12-odoo-settings");
  await page.reload();
  await expect(page.getByText("محفوظ في التطبيق")).toBeVisible();
  await expect(page.getByLabel("مفتاح API لمستخدم التكامل")).toHaveAttribute("placeholder", /محفوظ/);
  expect(await page.content()).not.toContain("test-key");

  // the saved connection is the one in use, and an empty key field keeps it
  await page.getByRole("button", { name: "فحص الاتصال" }).click();
  await expect(page.getByText("الاتصال سليم.", { exact: true })).toBeVisible();
  await page.goto("/orders");
  await expect(page.getByText("SUP/2026/00101")).toBeVisible();
});

test("mobile layout works", async ({ page }) => {
  await login(page, "admin", "secret-pass-1");
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
