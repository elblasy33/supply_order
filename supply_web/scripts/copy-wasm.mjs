// The barcode decoder (zxing-cpp compiled to WebAssembly) is served from our own origin instead of a CDN:
// it works offline / behind a firewall and satisfies a strict Content-Security-Policy.
import fs from "node:fs";
import path from "node:path";

const from = path.resolve("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const to = path.resolve("public/wasm/zxing_reader.wasm");
if (fs.existsSync(from)) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
} else {
  console.warn("copy-wasm: zxing_reader.wasm not found (run npm install first)");
}
