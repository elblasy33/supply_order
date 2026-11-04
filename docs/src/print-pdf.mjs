// Renders the HTML documents to A4 PDFs with Chrome (Arabic shaping and RTL are native there).
// Usage (from the repo root):  node docs/src/print-pdf.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "../../supply_web/node_modules/@playwright/test/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const jobs = [
  { html: "report.html", pdf: "SOLUTION_REPORT_AR.pdf", title: "نظام أوامر التوريد — وثيقة الحل ودورة العمل" },
  { html: "trial-plan.html", pdf: "TRIAL_PLAN_AR.pdf", title: "نظام أوامر التوريد — خطة التجربة والاختبار" },
];
const browser = await chromium.launch({ channel: "chrome" });
for (const j of jobs) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(here, j.html)).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const footer = `<div style="width:100%;font-size:8.5px;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between;direction:rtl;font-family:'Noto Kufi Arabic',sans-serif">
    <span>${j.title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  await page.pdf({ path: path.join(here, "..", j.pdf), format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<div></div>", footerTemplate: footer, margin: { top: "16mm", bottom: "18mm", left: "0", right: "0" }, preferCSSPageSize: false });
  console.log("pdf:", j.pdf);
  await page.close();
}
await browser.close();
