// Renders the app icons (home-screen icon, maskable icon, Apple touch icon, favicon) from public/icons/logo.svg,
// the same box-and-check mark as the Odoo module. Run: node scripts/make-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const svg = fs.readFileSync("public/icons/logo.svg", "utf8").replace(/width="50" height="50"/, 'width="100%" height="100%"');
// `pad` is the share of the tile left empty around the mark; maskable icons need a 20% safe zone on each side
const tile = (size, pad, radius, bg) => `<!doctype html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${Math.round(size * pad)}px;background:${bg};border-radius:${radius}px">${svg}</div></body>`;

const jobs = [
  { file: "public/icons/icon-192.png", size: 192, pad: 0.14, radius: 40, bg: "#ffffff" },
  { file: "public/icons/icon-512.png", size: 512, pad: 0.14, radius: 108, bg: "#ffffff" },
  { file: "public/icons/icon-maskable-512.png", size: 512, pad: 0.26, radius: 0, bg: "#e8f7f8" },
  { file: "src/app/apple-icon.png", size: 180, pad: 0.16, radius: 0, bg: "#ffffff" }, // iOS rounds it itself
  { file: "src/app/icon.png", size: 512, pad: 0.1, radius: 96, bg: "#ffffff" },
];

const browser = await chromium.launch({ channel: "chrome" });
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
  await page.setContent(tile(j.size, j.pad, j.radius, j.bg));
  fs.mkdirSync(path.dirname(j.file), { recursive: true });
  await page.screenshot({ path: j.file, omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  await page.close();
  console.log("icon:", j.file);
}
await browser.close();
