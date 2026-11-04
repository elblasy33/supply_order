// Builds the fake camera feed the browser tests use (Chrome's --use-file-for-fake-video-capture):
// barcode A for 1.5 s, an empty table for 1 s, A again, empty, then barcode B — the feed loops.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bwipjs from "bwip-js";

const dir = path.resolve("e2e/fixtures");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, "camera.y4m");
if (fs.existsSync(out) && !process.argv.includes("--force")) process.exit(0);

try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { console.warn("ffmpeg not found: camera tests will be skipped"); process.exit(0); }

const png = async (name, text) => {
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, await bwipjs.toBuffer({ bcid: "ean13", text, scale: 4, height: 22, includetext: true, textxalign: "center", backgroundcolor: "FFFFFF", paddingwidth: 12, paddingheight: 8 }));
  return file;
};
const A = await png("a", "6221000000010");
const B = await png("b", "6221000000027");
const seg = (file, secs) => ["-loop", "1", "-t", String(secs), "-framerate", "15", "-i", file];
const blank = (secs) => ["-f", "lavfi", "-t", String(secs), "-i", "color=c=0xd8d4cc:s=640x480:r=15"];
const inputs = [...seg(A, 1.5), ...blank(1), ...seg(A, 1.5), ...blank(1), ...seg(B, 1.5)];
const fit = (i) => `[${i}:v]scale=480:-2:flags=neighbor,pad=640:480:(ow-iw)/2:(oh-ih)/2:0xd8d4cc,setsar=1,fps=15,format=yuv420p[v${i}]`;
const filter = [0, 1, 2, 3, 4].map(fit).join(";") + ";[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[out]";
execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-pix_fmt", "yuv420p", out], { stdio: "ignore" });
console.log("fake camera feed:", out);
