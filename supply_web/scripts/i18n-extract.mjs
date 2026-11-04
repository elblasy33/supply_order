// Lists every Arabic text of the source (the dictionary keys) so en.ts can be checked for gaps.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const AR = /[؀-ۿ]/;
const keys = new Map();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(ts|tsx)$/.test(e.name) && !f.includes("lib/i18n/en.ts")) scan(f);
  }
}
function add(k, f) { k = k.replace(/\s+/g, " ").trim(); if (k && AR.test(k)) keys.set(k, f); }
function scan(f) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  (function v(n) {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text, f);
    else if (ts.isTemplateExpression(n)) {
      let s = n.head.text; n.templateSpans.forEach((sp, i) => (s += `{${i}}` + sp.literal.text));
      add(s, f);
    } else if (ts.isJsxText(n)) add(n.text, f);
    ts.forEachChild(n, v);
  })(sf);
}
walk("src");
const mode = process.argv[2];
if (mode === "missing") {
  const en = fs.readFileSync("src/lib/i18n/en.ts", "utf8");
  const have = new Set([...en.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]}"`)));
  const miss = [...keys].filter(([k]) => !have.has(k));
  console.log(`${miss.length} missing of ${keys.size}`);
  for (const [k, f] of miss) console.log(JSON.stringify(k), "  //", f.replace("src/", ""));
} else {
  console.log(JSON.stringify([...keys.keys()], null, 0));
  console.error(keys.size, "keys");
}
