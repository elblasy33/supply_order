// A stand-in for Odoo's `supply.api` (same envelope and shapes as docs/API_CONTRACT.yaml), used to test the UI
// without an Odoo server:  node e2e/mock-odoo.mjs  (port 8070, key "test-key").
import http from "node:http";

const KEY = "test-key";
const PORT = Number(process.env.MOCK_PORT ?? 8070);
const products = [
  { id: 1, name: "شيبس حار", barcode: "6221000000011", tracking: "none", uom: "وحدة", code: "CH-H", sale_price: 10, cost: 6 },
  { id: 2, name: "شيبس جبنة", barcode: "6221000000028", tracking: "none", uom: "وحدة", code: "CH-C", sale_price: 10, cost: 6 },
  { id: 3, name: "عصير برتقال 1 لتر", barcode: "6221000000035", tracking: "lot", uom: "وحدة", code: "JU-O", sale_price: 25, cost: 18 },
  { id: 4, name: "ملح 1 كجم", barcode: "6221000000042", tracking: "none", uom: "كجم", code: "SA-1", sale_price: 5, cost: 3 },
];
const partners = [
  { id: 10, name: "شركة النور للتجارة", ref: "C-001", phone: "0100000001" },
  { id: 11, name: "مورد الأمل", ref: "V-001", phone: "0100000002" },
];
const P = (id) => { const { code, sale_price, cost, ...p } = products.find((x) => x.id === id); return p; };
let seq = 100, lineSeq = 1000;
const orders = new Map();
const seen = new Map(); // idempotency
const users = new Map();
const calls = [];

function line(o, p, qty, price, extra = {}) {
  const l = { id: ++lineSeq, line_no: o.lines.length + 1, product: P(p), requested_product: P(p), substitution_reason: "",
    origin: o.state === "draft" ? "requested" : "added", note: "", qty_initial: 0, qty_requested: qty, qty_change: 0, qty_done: 0,
    qty_invoiced: 0, qty_unplanned: qty, uom: "وحدة", price_unit: price, discount: 0, taxes: [], invoice_group: "", lot: null,
    lot_name: "", subtotal: qty * price, ...extra };
  o.lines.push(l);
  return l;
}
function recompute(o) {
  for (const l of o.lines) {
    l.subtotal = l.qty_requested * l.price_unit * (1 - l.discount / 100);
    l.qty_change = o.state === "draft" ? 0 : l.qty_requested - l.qty_initial;
    l.qty_unplanned = l.qty_requested - l.planned_qty_hidden_or_0;
  }
  o.amount_untaxed = o.amount_total = o.lines.reduce((s, l) => s + l.subtotal, 0);
  o.line_count = o.lines.length;
  const done = o.lines.reduce((s, l) => s + l.qty_done, 0), want = o.lines.reduce((s, l) => s + l.qty_requested, 0);
  o.fulfillment_state = done === 0 ? "none" : done >= want ? "done" : "partial";
  const invd = o.lines.reduce((s, l) => s + l.qty_invoiced, 0);
  o.invoice_state = done > invd ? "to_invoice" : invd >= want && want > 0 ? "invoiced" : "nothing";
  const a = ["print"];
  if (o.state === "draft") a.push("edit", "add_line", "confirm", "cancel");
  if (o.state === "confirmed") { a.push("edit", "add_line", "substitute", "close", "cancel");
    if (o.lines.some((l) => l.qty_unplanned > 0)) a.push("prepare_transfer");
    if (done > invd) a.push("create_invoice"); }
  if (o.state === "cancel") a.push("reset_draft");
  if (["draft", "confirmed"].includes(o.state)) a.push(o.order_type === "sale" ? "create_sale_order" : "create_purchase_order");
  o.allowed_actions = a;
}
function newOrder(body, state = "draft") {
  const id = ++seq;
  const o = { id, name: `SUP/2026/${String(id).padStart(5, "0")}`, supply_ref: body.supply_ref ?? "", order_type: body.order_type, state,
    fulfillment_state: "none", invoice_state: "nothing", partner: partners.find((p) => p.id === body.partner_id) ?? partners[0],
    currency: "EGP", date_order: new Date().toISOString().replace(/\.\d+Z/, "Z"), amount_untaxed: 0, amount_tax: 0, amount_total: 0,
    note: body.note ?? "", line_count: 0, linked_supply_id: null, lines: [], documents: [], change_log: [], allowed_actions: [], grouping_warning: "" };
  for (const l of body.lines ?? []) line(o, l.product_id, l.qty_requested, l.price_unit ?? products.find((p) => p.id === l.product_id).sale_price, { note: l.note ?? "" });
  for (const l of o.lines) l.planned_qty_hidden_or_0 = 0;
  orders.set(id, o);
  recompute(o);
  return o;
}
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "planned_qty_hidden_or_0" ? undefined : v)));
const summary = (o) => { const c = clean(o); for (const k of ["lines", "documents", "change_log", "allowed_actions", "grouping_warning"]) delete c[k]; return c; };
const log = (o, type, item, old, nw, reason, user) => o.change_log.unshift({ date: new Date().toISOString(), type, item, old, new: nw, reason: reason ?? "", user: "Integration", app_user: user ?? "" });
class Err extends Error { constructor(code, message, field) { super(message); this.code = code; this.field = field; } }

const seed = newOrder({ partner_id: 10, order_type: "sale", supply_ref: "11100", lines: [{ product_id: 1, qty_requested: 40, price_unit: 10 }, { product_id: 2, qty_requested: 60, price_unit: 10 }] });
seed.state = "confirmed"; seed.lines.forEach((l) => { l.qty_initial = l.qty_requested; l.planned_qty_hidden_or_0 = 0; }); recompute(seed);
const seed2 = newOrder({ partner_id: 11, order_type: "purchase", supply_ref: "PO-77", lines: [{ product_id: 4, qty_requested: 200, price_unit: 3 }] });
void seed2;

const handlers = {
  whoami: (b, ctx) => ({ service_user: true, app_user: ctx.ext ? { id: ctx.ext.id, name: ctx.ext.name, login: ctx.ext.login, role: "manager" } : null, operations: [], company: { id: 1, name: "Mock Co", currency: "EGP" } }),
  ext_user_sync: (b) => { const u = users.get(b.login) ?? { id: users.size + 1, login: b.login }; Object.assign(u, { name: b.name, role: b.role, active: b.active }); users.set(b.login, u); return { id: u.id, login: u.login, name: u.name, role: u.role, active: u.active }; },
  order_search: (b) => {
    let list = [...orders.values()].reverse();
    if (b.query) list = list.filter((o) => [o.name, o.supply_ref, o.partner.name, ...o.lines.map((l) => l.product.name)].join(" ").includes(b.query));
    if (b.state) list = list.filter((o) => b.state.includes(o.state));
    if (b.order_type) list = list.filter((o) => o.order_type === b.order_type);
    if (b.invoice_state) list = list.filter((o) => o.invoice_state === b.invoice_state);
    const limit = Math.min(b.limit ?? 50, 200), offset = b.offset ?? 0;
    return { page: { total: list.length, offset, limit }, data: list.slice(offset, offset + limit).map(summary) };
  },
  order_read: (b) => { const o = orders.get(b.id); if (!o) throw new Err("not_found", "السجل لم يعد موجوداً.", "id"); return clean(o); },
  order_create: (b) => { if (!b.partner_id) throw new Err("validation_error", "partner_id مطلوب"); return clean(newOrder(b)); },
  order_action: (b, ctx) => {
    const o = orders.get(b.id); if (!o) throw new Err("not_found", "السجل لم يعد موجوداً.");
    const a = b.action;
    if (a === "confirm") { if (!o.lines.length) throw new Err("user_error", "أضف سطراً واحداً على الأقل قبل التأكيد."); o.state = "confirmed"; o.lines.forEach((l) => (l.qty_initial = l.qty_requested)); }
    else if (a === "cancel") o.state = "cancel";
    else if (a === "reset_draft") o.state = "draft";
    else if (a === "close") o.state = "closed";
    else if (a === "prepare_transfer") {
      const todo = o.lines.filter((l) => l.qty_unplanned > 0);
      if (!todo.length) throw new Err("user_error", "لا شيء للتخطيط: كل الكميات لها حركات بالفعل.");
      todo.forEach((l) => { l.planned_qty_hidden_or_0 = l.qty_requested; l.qty_done = l.qty_requested; }); // the mock delivers at once
      const d = { model: "stock.picking", id: ++seq, name: `WH/OUT/${seq}`, state: "done", kind: o.order_type === "sale" ? "delivery" : "receipt" };
      o.documents.push(d); recompute(o); const r = clean(o); r.created = { model: d.model, id: d.id, name: d.name }; return r;
    } else if (a === "create_invoice") {
      const todo = o.lines.filter((l) => l.qty_done > l.qty_invoiced);
      if (!todo.length) throw new Err("user_error", "لا شيء للفوترة: لا توجد كمية منفذة غير مفوترة.");
      todo.forEach((l) => (l.qty_invoiced = l.qty_done));
      const d = { model: "account.move", id: ++seq, name: `INV/2026/${seq}`, state: "draft", kind: o.order_type === "sale" ? "invoice" : "vendor_bill" };
      o.documents.push(d); recompute(o); const r = clean(o); r.created = { model: d.model, id: d.id, name: d.name }; return r;
    } else if (a === "create_sale_order" || a === "create_purchase_order") {
      const d = { model: a === "create_sale_order" ? "sale.order" : "purchase.order", id: ++seq, name: `${a === "create_sale_order" ? "S" : "P"}${seq}`, state: "draft", kind: a === "create_sale_order" ? "sale" : "purchase" };
      o.documents.push(d); recompute(o); const r = clean(o); r.created = { model: d.model, id: d.id, name: d.name }; return r;
    } else throw new Err("validation_error", `Unknown action: ${a}`, "action");
    void ctx; recompute(o); return clean(o);
  },
  line_add: (b, ctx) => {
    const o = orders.get(b.order_id); const l = line(o, b.line.product_id, b.line.qty_requested, b.line.price_unit ?? 10, { note: b.line.note ?? "" });
    l.planned_qty_hidden_or_0 = 0;
    if (o.state !== "draft") { l.origin = "added"; log(o, "add", l.product.name, "", String(l.qty_requested), b.reason, ctx.ext?.name); }
    recompute(o); return clean(o);
  },
  line_update: (b, ctx) => {
    const l = [...orders.values()].flatMap((o) => o.lines.map((x) => [o, x])).find(([, x]) => x.id === b.line_id); if (!l) throw new Err("not_found", "السطر غير موجود.");
    const [o, x] = l; const v = b.values ?? {};
    if (v.qty_requested !== undefined && o.state !== "draft") { if (v.qty_requested < x.qty_done) throw new Err("user_error", `${x.product.name}: تم تحريك ${x.qty_done} بالفعل، ولا يمكن أن تقل الكمية عن ذلك.`); log(o, "qty", x.product.name, String(x.qty_requested), String(v.qty_requested), b.reason, ctx.ext?.name); }
    Object.assign(x, { qty_requested: v.qty_requested ?? x.qty_requested, price_unit: v.price_unit ?? x.price_unit, discount: v.discount ?? x.discount, note: v.note ?? x.note, invoice_group: v.invoice_group ?? x.invoice_group });
    if (b.line_no) { o.lines.splice(o.lines.indexOf(x), 1); o.lines.splice(b.line_no - 1, 0, x); o.lines.forEach((y, i) => (y.line_no = i + 1)); }
    recompute(o); return clean(o);
  },
  line_remove: (b, ctx) => { for (const o of orders.values()) { const i = o.lines.findIndex((x) => x.id === b.line_id); if (i >= 0) { if (o.lines[i].qty_done) throw new Err("user_error", "لا يمكن حذف سطر له حركات مخزون منتهية."); if (o.state !== "draft") log(o, "remove", o.lines[i].product.name, String(o.lines[i].qty_requested), "", b.reason, ctx.ext?.name); o.lines.splice(i, 1); o.lines.forEach((y, k) => (y.line_no = k + 1)); recompute(o); return clean(o); } } throw new Err("not_found", "السطر غير موجود."); },
  line_substitute: (b, ctx) => {
    if (!b.reason?.trim()) throw new Err("validation_error", "السبب مطلوب لاستبدال صنف.", "reason");
    for (const o of orders.values()) { const x = o.lines.find((y) => y.id === b.line_id); if (x) {
      if (x.qty_done >= x.qty_requested && !b.return_done) throw new Err("user_error", `تم تحريك كل كمية ${x.product.name} بالفعل. فعّل "أرجع أيضاً ما تم تحريكه بالفعل" لاستبداله.`);
      log(o, "substitute", x.product.name, x.product.name, P(b.product_id).name, b.reason, ctx.ext?.name);
      x.product = P(b.product_id); x.substitution_reason = b.reason; if (b.return_done) { x.qty_done = 0; x.planned_qty_hidden_or_0 = 0; }
      recompute(o); return clean(o); } }
    throw new Err("not_found", "السطر غير موجود.");
  },
  scan: (b, ctx) => {
    const o = orders.get(b.order_id); const code = (b.code ?? "").trim(); if (!code) throw new Err("validation_error", "لم يتم مسح أي شيء.", "code");
    const p = products.find((x) => x.barcode === code || x.code === code);
    if (!p) return { outcome: "unknown", message: `لا يوجد شيء لـ "${code}": باركود أو رقم تشغيلة غير معروف.`, order: clean(o) };
    const l = o.lines.find((x) => x.product.id === p.id);
    if (l) { l.qty_requested += 1; recompute(o); return { outcome: "quantity_increased", message: "", order: clean(o) }; }
    const n = line(o, p.id, 1, p.sale_price); n.planned_qty_hidden_or_0 = 0; if (o.state !== "draft") { n.origin = "added"; log(o, "add", n.product.name, "", "1", "", ctx.ext?.name); }
    recompute(o); return { outcome: "product_added", message: "", order: clean(o) };
  },
  lookup: (b) => {
    const q = (b.query ?? "").trim();
    if (b.kind === "product") return products.filter((p) => p.name.includes(q) || p.code.includes(q) || p.barcode === q);
    if (b.kind === "partner") return partners.filter((p) => p.name.includes(q) || p.ref.includes(q));
    return [];
  },
  alerts: (b) => {
    if (b.kind === "expiry") { const d = [{ id: 1, name: "LOT-A1", product: P(3), expiration_date: new Date(Date.now() + 5 * 864e5).toISOString(), alert_date: null, days_to_expiry: 5, expiry_state: "alert", qty: 120 }, { id: 2, name: "LOT-OLD", product: P(3), expiration_date: new Date(Date.now() - 2 * 864e5).toISOString(), alert_date: null, days_to_expiry: -2, expiry_state: "expired", qty: 12 }]; return { page: { total: d.length, offset: 0, limit: 200 }, data: d }; }
    const d = [{ id: 1, name: "P00012", partner: partners[1], state: "draft", receipt_status: "", is_late: false, date_planned: new Date().toISOString(), amount_total: 540, auto_source: "mto", currency: "EGP", supply_order: { id: 101, name: "SUP/2026/00101" } }];
    return { page: { total: 1, offset: 0, limit: 100 }, data: d };
  },
  reconcile_load: (b) => ({ invoices: [{ id: 1, role: "invoice", document: { id: 501, name: "INV/2026/0001" }, date: "2026-11-01", due: "2026-11-15", open_amount: 100, currency: "EGP", selected: false }, { id: 2, role: "invoice", document: { id: 502, name: "INV/2026/0002" }, date: "2026-11-02", due: "2026-11-20", open_amount: 200, currency: "EGP", selected: false }], payments: [{ id: 3, role: "payment", document: { id: 601, name: "BNK1/2026/0001" }, date: "2026-11-03", due: null, open_amount: 150, currency: "EGP", selected: true }] }),
  reconcile_run: (b) => { if (!b.invoice_ids?.length) throw new Err("nothing_to_do", "لا توجد أي من الفواتير المختارة مفتوحة في تلك الفترة.", "invoice_ids"); return { batch: "REC-20261104-1", pairs: [{ invoice: { id: 501, name: "INV/2026/0001" }, payment: { id: 601, name: "BNK1/2026/0001" }, amount: 100, invoice_left: 0 }, { invoice: { id: 502, name: "INV/2026/0002" }, payment: { id: 601, name: "BNK1/2026/0001" }, amount: 50, invoice_left: 150 }], remaining: 150 }; },
  rebate_accruals: () => { const d = [{ id: 1, name: "خصم الحجم — النور", program: "خصم الحجم الشهري", applies_to: "sale", partner: partners[0], date_from: "2026-10-01", date_to: "2026-10-31", turnover: 1000, reward_type: "percent", amount: 100, state: rebate.state, credit_note: null, free_goods_order: null }]; return { page: { total: 1, offset: 0, limit: 200 }, data: d }; },
  rebate_action: (b) => { const next = { confirm: "confirmed", settle: "settled", cancel: "cancel", reset_draft: "draft" }[b.action]; if (b.action === "settle" && rebate.state !== "confirmed") throw new Err("user_error", "كوّن مخصص الخصم قبل تسويته."); rebate.state = next; return { id: 1, state: next, amount: 100, credit_note: null }; },
};
const rebate = { state: "draft" };

http.createServer((req, res) => {
  const send = (status, body, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { name: "Unauthorized" });
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__calls") return send(200, calls);
  let m = url.pathname.match(/^\/supply_api\/print\/(\w+)\/(\w+)\/(\d+)$/);
  if (m) {
    const [, kind, fmt, id] = m;
    if (fmt === "pdf") return send(200, Buffer.from("%PDF-1.4 mock"), "application/pdf");
    if (fmt === "xlsx") return send(200, Buffer.from("PK mock"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return send(200, `<!doctype html><html lang="ar" dir="rtl"><body><h1>${kind} #${id}</h1></body></html>`, "text/html; charset=utf-8");
  }
  m = url.pathname.match(/^\/json\/2\/supply\.api\/(\w+)$/);
  if (!m || req.method !== "POST") return send(404, { name: "NotFound" });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const method = m[1];
    const key = body.idempotency_key;
    calls.push({ method, body });
    const h = handlers[method];
    if (!h) return send(404, { name: "NotFound" });
    if (key && seen.has(key)) return send(200, seen.get(key));
    const ext = body.context?.ext_user_id ? [...users.values()].find((u) => u.id === body.context.ext_user_id) : null;
    let out;
    try {
      const data = h(body, { ext });
      out = data && data.page ? { ok: true, data: data.data, ...data.page } : { ok: true, data };
      if (key) seen.set(key, out);
    } catch (e) {
      if (!(e instanceof Err)) { console.error(e); return send(500, { name: "Error", message: String(e) }); }
      out = { ok: false, error: { code: e.code, message: e.message, field: e.field ?? "" } };
    }
    send(200, out);
  });
}).listen(PORT, () => console.log(`mock odoo on :${PORT}`));
