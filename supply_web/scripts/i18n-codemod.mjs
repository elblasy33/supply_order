// One-off migration: wraps Arabic text of components/pages in t("...") (texts are their own keys) and
// adds `const t = useT()` (client) or `const t = await getT()` (server) to the components that use it.
// Usage: node scripts/i18n-codemod.mjs <file...>   — prints what needs a manual look.
import fs from "node:fs";
import ts from "typescript";

const AR = /[؀-ۿ]/;
const report = [];

function run(file) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const client = /^\s*["']use client["']/.test(text);
  const edits = [];
  const fnOf = (node) => { for (let n = node.parent; n; n = n.parent) if (ts.isFunctionLike(n)) return n; return null; };
  const alreadyT = (node) => node.parent && ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === "t";
  const q = (s) => JSON.stringify(s);
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  (function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node) && AR.test(node.text)) {
      const raw = node.text;
      const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
      const core = raw.trim().replace(/\s+/g, " ");
      edits.push({ start: node.getStart(sf, true) - 0, end: node.end, text: `${lead}{t(${q(core)})}${trail}`, node });
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && AR.test(node.text)) {
      if (alreadyT(node)) return;
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      if (!fnOf(node)) { report.push(`${file}:${line(node)} module-level: ${node.text.slice(0, 50)}`); return; }
      const call = `t(${q(node.text)})`;
      edits.push({ start: node.getStart(), end: node.end, text: ts.isJsxAttribute(node.parent) ? `{${call}}` : call, node });
      return;
    }
    if (ts.isTemplateExpression(node) && AR.test(node.getText())) {
      if (alreadyT(node)) return;
      if (!fnOf(node)) { report.push(`${file}:${line(node)} module-level template`); return; }
      edits.push({ start: node.getStart(), end: node.end, text: `t(${node.getText()})`, node });
      return; // the literal pieces inside stay as they are
    }
    ts.forEachChild(node, visit);
  })(sf);

  if (!edits.length) return;

  // top-level functions that contain edits get the translator
  const tops = new Map();
  for (const e of edits) {
    let top = null;
    for (let n = e.node.parent; n; n = n.parent) if (ts.isFunctionLike(n) && (ts.isSourceFile(n.parent) || ts.isVariableDeclaration(n.parent) && ts.isSourceFile(n.parent.parent.parent) || ts.isExportAssignment(n.parent))) top = n;
    if (!top) { report.push(`${file}:${line(e.node)} not inside a top-level function`); continue; }
    tops.set(top, true);
  }
  const insertions = [];
  for (const fn of tops.keys()) {
    const name = ts.isFunctionDeclaration(fn) ? fn.name?.text : ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText() : "";
    if (!name || !/^[A-Z]/.test(name)) report.push(`${file}: top-level function "${name}" is not a component but uses t`);
    if (!fn.body || !ts.isBlock(fn.body)) { report.push(`${file}: ${name} has an expression body: add t by hand`); continue; }
    const decl = client ? "const t = useT();" : "const t = await getT();";
    insertions.push({ start: fn.body.getStart() + 1, end: fn.body.getStart() + 1, text: `\n  ${decl}` });
    if (!client && !fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      if (ts.isFunctionDeclaration(fn)) {
        const kw = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
        insertions.push({ start: kw.getStart(), end: kw.getStart(), text: "async " });
      } else report.push(`${file}: ${name} must be made async by hand`);
    }
  }
  let out = text;
  for (const e of [...edits, ...insertions].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const imp = client ? 'import { useT } from "@/lib/i18n/client";' : 'import { getT } from "@/lib/i18n/server";';
  const lastImport = [...out.matchAll(/^import [^;]*;$/gm)].pop();
  const at = lastImport ? lastImport.index + lastImport[0].length : (out.startsWith('"use client"') ? out.indexOf("\n") + 1 : 0);
  out = out.slice(0, at) + "\n" + imp + out.slice(at);
  fs.writeFileSync(file, out);
  console.log(`${file}: ${edits.length} texts, ${tops.size} components`);
}

for (const f of process.argv.slice(2)) run(f);
console.log("\n--- manual follow-up ---\n" + (report.join("\n") || "(none)"));
