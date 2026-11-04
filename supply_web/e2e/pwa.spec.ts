import { expect, test } from "@playwright/test";

test("the manifest makes the app installable: standalone, icons, shortcuts, RTL", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m).toMatchObject({ display: "standalone", start_url: "/", scope: "/", lang: "ar", dir: "rtl", theme_color: "#0d8f99" });
  expect(m.name).toBe("أوامر التوريد");
  const purposes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"])); // what Android needs to offer installation
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/warehouse", "/orders/new"]);
});

test("the page declares the installed-app look (iOS and Android)", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", /#/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
});

test("service worker: caches only static files, shows the offline page, never serves old data", async ({ page, context, request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-cache"); // an update is always noticed
  await page.goto("/login");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null || true)).toBeTruthy();
  await page.reload(); // now controlled by the worker
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(cached).toContain("/offline.html");
  expect(cached).toContain("/wasm/zxing_reader.wasm"); // the scanner's decoder is available at once, even offline
  expect(cached.some((p) => p.startsWith("/_next/static/"))).toBe(true);
  expect(cached.filter((p) => /^\/(login|orders|warehouse|api|setup|$)/.test(p) && p !== "/")).toEqual([]); // no pages, no data

  await context.setOffline(true);
  await page.goto("/orders").catch(() => {});
  await expect(page.getByText("لا يوجد اتصال بالإنترنت")).toBeVisible();
  await expect(page.getByRole("button", { name: /إعادة المحاولة/ })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: /إعادة المحاولة/ }).click();
  await expect(page.getByLabel("اسم المستخدم")).toBeVisible(); // back online: the real app (login, since signed out)
});

test.describe("install invitation on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36", hasTouch: true });

  async function signedIn(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("اسم المستخدم").fill("admin");
    await page.getByLabel("كلمة المرور").fill("secret-pass-1");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.waitForURL("/");
  }

  test("Android/Chrome: one-tap install through the browser's own prompt", async ({ page }) => {
    await signedIn(page);
    await expect(page.getByRole("region", { name: "تثبيت التطبيق" })).toHaveCount(0); // nothing until the browser offers it
    await page.evaluate(() => {
      (window as unknown as { __prompted: boolean }).__prompted = false;
      const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => { (window as unknown as { __prompted: boolean }).__prompted = true; },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(e);
    });
    const banner = page.getByRole("region", { name: "تثبيت التطبيق" });
    await expect(banner).toBeVisible();
    await page.screenshot({ path: "e2e/shots/24-install-banner.png" });
    await banner.getByRole("button", { name: "تثبيت" }).click();
    expect(await page.evaluate(() => (window as unknown as { __prompted: boolean }).__prompted)).toBe(true);
    await expect(banner).toHaveCount(0);
  });

  test("dismissed once, it stays away for two weeks", async ({ page }) => {
    await signedIn(page);
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) })));
    await page.getByRole("region", { name: "تثبيت التطبيق" }).getByRole("button", { name: "إغلاق" }).click();
    await page.reload();
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) })));
    await expect(page.getByRole("region", { name: "تثبيت التطبيق" })).toHaveCount(0);
  });
});

test.describe("iPhone", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });

  test("Safari has no install prompt, so the two steps are shown", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("اسم المستخدم").fill("admin");
    await page.getByLabel("كلمة المرور").fill("secret-pass-1");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.waitForURL("/");
    const banner = page.getByRole("region", { name: "تثبيت التطبيق" });
    await expect(banner).toContainText("إضافة إلى الشاشة الرئيسية");
    await page.screenshot({ path: "e2e/shots/25-install-ios.png" });
  });
});
