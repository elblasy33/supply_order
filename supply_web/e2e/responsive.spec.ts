import { expect, test, type Page } from "@playwright/test";

/**
 * Walks every screen at phone, tablet, laptop and wide-monitor sizes and fails on what breaks a layout:
 * the page scrolling sideways, content spilling out of the screen, tap targets too small for a thumb,
 * and text cut off by its own box. Screenshots go to e2e/shots/resp-*.png for a visual review.
 */
const SIZES = [
  { name: "phone-small", width: 360, height: 740 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-wide", width: 1024, height: 768 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1920, height: 1080 },
  { name: "ultrawide", width: 2560, height: 1200 },
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill("admin");
  await page.getByLabel("كلمة المرور").fill("secret-pass-1");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL("/");
}

async function firstId(page: Page, list: string, pattern: RegExp) {
  await page.goto(list);
  const hrefs = await page.locator("main a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => pattern.test(h));
  expect(href, `no link like ${pattern} on ${list}`).toBeTruthy();
  return href!;
}

/** What is wrong with the current page, as readable lines. */
async function problems(page: Page, phone: boolean): Promise<string[]> {
  return page.evaluate((isPhone) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
    const scrollable = (el: Element | null): boolean => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 28)}"`;
    for (const el of document.querySelectorAll("main *, aside *, header *")) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none" || s.position === "fixed") continue;
      if ((r.right > vw + 1 || r.left < -1) && !scrollable(el) && !el.closest("table") && !el.closest("[data-chart-scroll]")) out.push(`spills out of the screen: ${label(el)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
      if (isPhone && (el.tagName === "BUTTON" || el.tagName === "A") && !el.closest("table") && (el as HTMLElement).offsetParent !== null) {
        const small = Math.min(r.width, r.height) < 32 && !/sr-only/.test(el.className?.toString?.() ?? "");
        if (small && r.height < 32) out.push(`tap target too small (${Math.round(r.width)}x${Math.round(r.height)}): ${label(el)}`);
      }
      if (!/sr-only/.test(el.className?.toString?.() ?? "") && s.overflow === "hidden" && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0 && (el.textContent ?? "").trim().length > 3) {
        out.push(`text cut off: ${label(el)}`);
      }
    }
    return [...new Set(out)].slice(0, 12);
  }, phone);
}

for (const size of SIZES) {
  test(`layout holds at ${size.name} (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const phone = size.width < 768;
    await signIn(page);
    const order = await firstId(page, "/orders", /^\/orders\/\d+$/);
    const transfer = await firstId(page, "/warehouse?state=all", /^\/warehouse\/\d+$/).catch(() => "/warehouse");
    const screens: [string, string][] = [
      ["dashboard", "/"], ["orders", "/orders"], ["order-new", "/orders/new"], ["order", order], ["warehouse", "/warehouse?state=all"],
      ["transfer", transfer], ["alerts", "/alerts"], ["reconcile", "/accounting/reconcile"], ["rebates", "/rebates"],
      ["users", "/settings/users"], ["roles", "/settings/roles"], ["odoo", "/settings/odoo"],
    ];
    const report: string[] = [];
    for (const [name, url] of screens) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      if (name === "reconcile") {
        await page.getByPlaceholder("ابحث عن عميل أو مورد…").fill("النور");
        await page.getByRole("option", { name: /شركة النور/ }).click();
        await page.getByRole("button", { name: "تحميل" }).click();
        await page.getByText("INV/2026/0001").waitFor();
      }
      await page.screenshot({ path: `e2e/shots/resp-${size.name}-${name}.png`, fullPage: true });
      for (const p of await problems(page, phone)) report.push(`${name}: ${p}`);
    }
    expect(report, report.join("\n")).toEqual([]);
  });
}
