"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeftRight, Ban, Barcode, Camera, Check, CheckCheck, ChevronDown, CircleSlash, FileDown, FilePlus2, FileSpreadsheet,
  Lock, Pencil, Plus, Printer, ReceiptText, RotateCcw, ShoppingCart, Trash2, Truck,
} from "lucide-react";
import { addLine, orderAction, removeLine, scan, substituteLine, updateLine } from "@/app/actions/orders";
import { CameraScanner, type ScanResult as CameraResult } from "@/components/camera-scanner";
import { Dialog } from "@/components/dialog";
import { ProductPicker } from "@/components/pickers";
import { useToast } from "@/components/toast";
import { useAction } from "@/components/use-action";
import { Field, Badge, Fulfillment, InvoiceBadge, Num, Progress, formatDate, money } from "@/components/ui";
import { feedback, unlockAudio, type FeedbackKind } from "@/lib/scan/feedback";
import type { LookupProduct, ScanResult, SupplyLine, SupplyOrder } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

const ACTION_UI: Record<string, { label: string; icon: React.ReactNode; tone: "primary" | "secondary" | "danger"; confirm?: string; success: string }> = {
  confirm: { label: "تأكيد الأمر", icon: <CheckCheck className="size-4" />, tone: "primary", success: "تم تأكيد الأمر." },
  prepare_transfer: { label: "تجهيز التسليم/الاستلام", icon: <Truck className="size-4" />, tone: "primary", success: "تم تجهيز الإذن. نفّذه من شاشة المخزن." },
  create_invoice: { label: "إنشاء فاتورة من الفعلي", icon: <ReceiptText className="size-4" />, tone: "primary", success: "تم إنشاء الفاتورة من الكميات الفعلية." },
  create_sale_order: { label: "إنشاء أمر بيع", icon: <FilePlus2 className="size-4" />, tone: "secondary", success: "تم إنشاء أمر البيع." },
  create_purchase_order: { label: "إنشاء أمر شراء", icon: <ShoppingCart className="size-4" />, tone: "secondary", success: "تم إنشاء أمر الشراء." },
  close: { label: "إغلاق", icon: <Lock className="size-4" />, tone: "secondary", confirm: "إغلاق الأمر يمنع أي تعديل لاحق. متابعة؟", success: "تم إغلاق الأمر." },
  cancel: { label: "إلغاء", icon: <Ban className="size-4" />, tone: "danger", confirm: "سيتم إلغاء الأمر وحركات المخزون غير المنفذة. متابعة؟", success: "تم إلغاء الأمر." },
  reset_draft: { label: "إعادته لمسودة", icon: <RotateCcw className="size-4" />, tone: "secondary", success: "عاد الأمر مسودة." },
};
const ORDER_OF_ACTIONS = ["confirm", "prepare_transfer", "create_invoice", "create_sale_order", "create_purchase_order", "reset_draft", "close", "cancel"];

const DOC_KIND: Record<string, string> = {
  sale: "أمر بيع", purchase: "أمر شراء", delivery: "تسليم", receipt: "استلام", transfer: "إذن مخزني",
  invoice: "فاتورة", vendor_bill: "فاتورة مورد", credit_note: "إشعار دائن", vendor_credit_note: "إشعار مورد دائن",
};
const LOG_LABEL: Record<string, string> = { add: "إضافة صنف", remove: "حذف صنف", substitute: "استبدال", qty: "تعديل كمية", price: "تعديل سعر/خصم" };

export function OrderWorkspace({ order, can, odooUrl }: { order: SupplyOrder; can: string[]; odooUrl: string }) {
  const allowed = useMemo(() => new Set(order.allowed_actions), [order.allowed_actions]);
  const has = (p: string) => can.includes(p);
  const editPerm = order.state === "draft" ? "orders.edit_draft" : "orders.edit_confirmed";
  const canEdit = has(editPerm) && allowed.has("edit") && (order.state === "draft" || order.state === "confirmed");
  const showMoved = order.state !== "draft";

  return (
    <div className="grid gap-6 2xl:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-5">
        <ActionBar order={order} allowed={allowed} can={can} />
        {canEdit && has("orders.scan") && <ScanBar order={order} />}
        <LinesCard order={order} canEdit={canEdit} canSubstitute={has("orders.substitute") && allowed.has("substitute") && order.state === "confirmed"} showMoved={showMoved} />
        {canEdit && allowed.has("add_line") && <AddLine order={order} />}
      </div>
      <aside className="space-y-5">
        <Totals order={order} />
        <Documents order={order} odooUrl={odooUrl} canPrint={has("orders.print")} can={can} />
        <ChangeLog order={order} />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- actions
function ActionBar({ order, allowed, can }: { order: SupplyOrder; allowed: Set<string>; can: string[] }) {
  const t = useT();
  const { run, busy } = useAction();
  const [ask, setAsk] = useState<string | null>(null);
  const perms: Record<string, string> = {
    confirm: "orders.confirm", cancel: "orders.cancel", reset_draft: "orders.cancel", close: "orders.close",
    prepare_transfer: "orders.prepare_transfer", create_sale_order: "orders.create_sale",
    create_purchase_order: "orders.create_purchase", create_invoice: "orders.invoice",
  };
  const actions = ORDER_OF_ACTIONS.filter((a) => allowed.has(a) && can.includes(perms[a]));

  const router = useRouter();
  async function go(action: string) {
    const ui = ACTION_UI[action];
    const res = await run(`order-${action}`, (k) => orderAction(order.id, action, k), { success: t(ui.success) });
    // the new transfer is where the next step happens: counting what really moves
    if (res.ok && res.data.created?.model === "stock.picking" && can.includes("warehouse.view")) router.push(`/warehouse/${res.data.created.id}`);
    return res;
  }

  return (
    <div className="card flex flex-wrap items-center gap-2 p-3">
      {actions.map((a) => {
        const ui = ACTION_UI[a];
        return (
          <button key={a} disabled={busy} className={ui.tone === "primary" ? "btn-primary" : ui.tone === "danger" ? "btn-danger" : "btn-secondary"}
            onClick={() => (ui.confirm ? setAsk(a) : go(a))}>
            {ui.icon} {t(ui.label)}
          </button>
        );
      })}
      {actions.length === 0 && <span className="px-2 text-sm text-muted">{t("لا توجد إجراءات متاحة لك على هذا الأمر الآن.")}</span>}
      <div className="ms-auto"><PrintMenu order={order} can={can.includes("orders.print")} /></div>
      <Dialog open={!!ask} onClose={() => setAsk(null)} title={ask ? t(ACTION_UI[ask].label) : ""}
        footer={<>
          <button className="btn-secondary" onClick={() => setAsk(null)}>{t("تراجع")}</button>
          <button className={ask && ACTION_UI[ask].tone === "danger" ? "btn-danger" : "btn-primary"} disabled={busy}
            onClick={async () => { const a = ask!; setAsk(null); await go(a); }}>{t("نعم، تابع")}</button>
        </>}>
        <p className="text-sm leading-7">{ask ? t(ACTION_UI[ask].confirm ?? "") : ""}</p>
      </Dialog>
    </div>
  );
}

function PrintMenu({ order, can }: { order: SupplyOrder; can: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!can) return null;
  const items = [
    { kind: "quotation", label: t("عرض السعر") },
    { kind: "commercial_bill", label: t("الفاتورة التجارية") },
  ];
  return (
    <div className="relative">
      <button className="btn-secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Printer className="size-4" />  {t("طباعة")} <ChevronDown className="size-4" />
      </button>
      {open && (
        <>
          <button aria-label={t("إغلاق")} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="card absolute end-0 top-full z-20 mt-1 w-64 p-2 shadow-lg">
            {items.map((i) => (
              <div key={i.kind} className="px-2 py-1.5">
                <p className="mb-1 text-xs font-bold text-muted">{i.label}</p>
                <div className="flex gap-1.5">
                  <a className="btn-secondary flex-1 px-2 py-1.5 text-xs" target="_blank" rel="noreferrer" href={`/api/print/${i.kind}/html/${order.id}`}><Printer className="size-3.5" />  {t("معاينة")}</a>
                  <a className="btn-secondary flex-1 px-2 py-1.5 text-xs" href={`/api/print/${i.kind}/pdf/${order.id}`}><FileDown className="size-3.5" /> PDF</a>
                  <a className="btn-secondary flex-1 px-2 py-1.5 text-xs" href={`/api/print/${i.kind}/xlsx/${order.id}`}><FileSpreadsheet className="size-3.5" /> XLSX</a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- scan
function ScanBar({ order }: { order: SupplyOrder }) {
  const t = useT();
  const { run, busy } = useAction();
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [msg, setMsg] = useState<{ kind: FeedbackKind; text: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const TEXT: Record<ScanResult["outcome"], string> = {
    product_added: t("أُضيف الصنف"), quantity_increased: t("زادت الكمية"), lot_attached: t("رُبطت التشغيلة بالصنف"),
    lot_added: t("أُضيفت التشغيلة كسطر"), new_lot_name: t("سُجّل رقم التشغيلة الجديد"), unknown: "", ambiguous: "", rejected: "",
  };

  // one scan = one request, each with its own key (scanning the same code twice means two units)
  const process = useCallback(async (code: string): Promise<CameraResult> => {
    const res = await run(`scan-${Date.now()}-${code}`, (k) => scan(order.id, code, k));
    if (!res.ok) return { kind: "error", message: t(res.error) };
    const good = !["unknown", "ambiguous", "rejected"].includes(res.data.outcome);
    return { kind: good ? "ok" : "error", message: good ? `${TEXT[res.data.outcome]} — ${code}` : t(res.data.message) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, run, t]);

  async function submit() {
    const code = value.trim();
    if (!code || busy) return;
    setValue("");
    const r = await process(code);
    feedback(r.kind);
    setMsg({ kind: r.kind, text: r.message });
    ref.current?.focus();
  }

  useEffect(() => { if (!camera) ref.current?.focus(); }, [camera]);

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <label htmlFor="scan" className="label flex items-center gap-1.5"><Barcode className="size-4" />  {t("مسح باركود صنف أو رقم تشغيلة")}</label>
        <div className="flex gap-2">
          <input id="scan" ref={ref} dir="ltr" value={value} disabled={busy} autoComplete="off" inputMode="text" onFocus={unlockAudio}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            className="input font-mono text-base" placeholder={t("امسح أو اكتب ثم Enter")} />
          <button className="btn-primary" onClick={submit} disabled={busy || !value.trim()}>{t("إضافة")}</button>
          <button className={clsx("btn-secondary", camera && "border-brand-500 text-brand-700")} onClick={() => { unlockAudio(); setCamera((v) => !v); }} aria-pressed={camera} aria-label={t("كاميرا الجوال")}>
            <Camera className="size-4" /><span className="hidden sm:inline">{t("الكاميرا")}</span>
          </button>
        </div>
        <div className="mt-2 min-h-6 text-sm" aria-live="polite">
          {msg && !camera && (
            <p className={clsx("flex items-center gap-1.5 font-semibold", msg.kind === "ok" ? "text-ok" : "text-bad")}>
              {msg.kind === "ok" ? <Check className="size-4" /> : <CircleSlash className="size-4" />} {msg.text}
            </p>
          )}
        </div>
      </div>
      {camera && <CameraScanner onCode={process} onClose={() => setCamera(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- lines
function LinesCard({ order, canEdit, canSubstitute, showMoved }: { order: SupplyOrder; canEdit: boolean; canSubstitute: boolean; showMoved: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState<number | null>(null);
  const [subFor, setSubFor] = useState<SupplyLine | null>(null);
  const [removeFor, setRemoveFor] = useState<SupplyLine | null>(null);
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-extrabold">{t("الأصناف")} <span className="num ms-1 text-sm font-semibold text-muted">({order.lines.length})</span></h2>
        {order.grouping_warning && <Badge tone="amber">{t("تنبيه تجميع الأصناف")}</Badge>}
      </div>
      {order.grouping_warning && <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">{order.grouping_warning}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem]">
          <thead className="bg-canvas/60">
            <tr>
              <th className="th w-10">#</th>
              <th className="th">{t("الصنف")}</th>
              <th className="th">{t("الكمية")}</th>
              {showMoved && <th className="th w-40">{t("المنفّذ / المفوتر")}</th>}
              <th className="th">{t("السعر")}</th>
              <th className="th">{t("الإجمالي")}</th>
              <th className="th w-28"><span className="sr-only">{t("إجراءات")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {order.lines.map((l) => (
              <LineRows key={l.id} line={l} order={order} showMoved={showMoved} editing={editing === l.id}
                canEdit={canEdit} canSubstitute={canSubstitute}
                onEdit={() => setEditing(editing === l.id ? null : l.id)} onDone={() => setEditing(null)}
                onSubstitute={() => setSubFor(l)} onRemove={() => setRemoveFor(l)} />
            ))}
          </tbody>
        </table>
        {order.lines.length === 0 && <p className="px-6 py-12 text-center text-muted">{t("لا توجد أصناف بعد. امسح باركود أو ابحث عن صنف بالأسفل.")}</p>}
      </div>
      <SubstituteDialog key={`s${subFor?.id ?? 0}`} order={order} line={subFor} onClose={() => setSubFor(null)} />
      <RemoveDialog key={`r${removeFor?.id ?? 0}`} order={order} line={removeFor} onClose={() => setRemoveFor(null)} />
    </section>
  );
}

function LineRows({
  line: l, order, showMoved, editing, canEdit, canSubstitute, onEdit, onDone, onSubstitute, onRemove,
}: {
  line: SupplyLine; order: SupplyOrder; showMoved: boolean; editing: boolean; canEdit: boolean; canSubstitute: boolean;
  onEdit: () => void; onDone: () => void; onSubstitute: () => void; onRemove: () => void;
}) {
  const t = useT();
  const substituted = l.requested_product && l.requested_product.id !== l.product.id;
  const cols = showMoved ? 7 : 6;
  return (
    <>
      <tr className={clsx("hover:bg-canvas/40", editing && "bg-brand-50/40")}>
        <td className="td num text-muted">{l.line_no}</td>
        <td className="td">
          <p className="font-bold">{l.product.name}</p>
          {substituted && (
            <p className="text-xs text-amber-700">
              
              {t("المطلوب أصلاً:")} <span className="line-through">{l.requested_product!.name}</span>
              {l.substitution_reason && <span className="text-muted"> — {l.substitution_reason}</span>}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {l.origin === "added" && order.state !== "draft" && <Badge tone="brand">{t("مضاف")}</Badge>}
            {l.lot && <span>{t("تشغيلة")} <span className="num font-semibold text-ink">{l.lot.name}</span>{l.lot.expiration_date && <>  {t("· تنتهي")} {formatDate(l.lot.expiration_date)}</>}</span>}
            {!l.lot && l.lot_name && <span>{t("تشغيلة جديدة")} <span className="num font-semibold text-ink">{l.lot_name}</span></span>}
            {l.invoice_group && <Badge>{t("مجموعة:")} {l.invoice_group}</Badge>}
            {l.note && <span className="text-ink/70">📝 {l.note}</span>}
          </div>
        </td>
        <td className="td">
          <p className="font-bold"><Num v={l.qty_requested} /> <span className="text-xs font-normal text-muted">{l.uom}</span></p>
          {showMoved && (
            <p className="text-xs text-muted">
              
              {t("الأصلي")} <Num v={l.qty_initial} />
              {l.qty_change !== 0 && <span className={clsx("ms-1 font-bold", l.qty_change > 0 ? "text-ok" : "text-bad")}><span className="num">{l.qty_change > 0 ? "+" : ""}{l.qty_change}</span></span>}
            </p>
          )}
        </td>
        {showMoved && (
          <td className="td">
            <div className="mb-1 flex items-baseline justify-between text-sm"><span><Num v={l.qty_done} /> <span className="text-xs text-muted">{t("منفّذ")}</span></span>
              <span className="text-xs text-muted"><Num v={l.qty_invoiced} />  {t("مفوتر")}</span></div>
            <Progress done={l.qty_done} total={l.qty_requested} />
          </td>
        )}
        <td className="td"><span className="num">{money.format(l.price_unit)}</span>
          {l.discount > 0 && <p className="text-xs text-muted">{t("خصم")} <Num v={l.discount} />%</p>}</td>
        <td className="td font-semibold"><span className="num">{money.format(l.subtotal)}</span></td>
        <td className="td">
          <div className="flex items-center justify-end gap-0.5">
            {canEdit && <button className="btn-ghost px-2 py-1.5" aria-label={t("تعديل")} title={t("تعديل")} onClick={onEdit}><Pencil className="size-4" /></button>}
            {canSubstitute && <button className="btn-ghost px-2 py-1.5" aria-label={t("استبدال")} title={t("استبدال")} onClick={onSubstitute}><ArrowLeftRight className="size-4" /></button>}
            {canEdit && l.qty_done === 0 && <button className="btn-ghost px-2 py-1.5 hover:text-bad" aria-label={t("حذف")} title={t("حذف")} onClick={onRemove}><Trash2 className="size-4" /></button>}
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="bg-brand-50/40"><td colSpan={cols} className="px-4 pb-4"><EditPanel line={l} order={order} onDone={onDone} /></td></tr>
      )}
    </>
  );
}

function EditPanel({ line: l, order, onDone }: { line: SupplyLine; order: SupplyOrder; onDone: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const [qty, setQty] = useState(String(l.qty_requested));
  const [price, setPrice] = useState(String(l.price_unit));
  const [disc, setDisc] = useState(String(l.discount));
  const [no, setNo] = useState(String(l.line_no));
  const [note, setNote] = useState(l.note);
  const [group, setGroup] = useState(l.invoice_group);
  const [reason, setReason] = useState("");
  const confirmed = order.state !== "draft";

  const values: Record<string, number | string> = {};
  if (Number(qty) !== l.qty_requested) values.qty_requested = Number(qty);
  if (Number(price) !== l.price_unit) values.price_unit = Number(price);
  if (Number(disc) !== l.discount) values.discount = Number(disc);
  if (note !== l.note) values.note = note;
  if (group !== l.invoice_group) values.invoice_group = group;
  const newNo = Number(no) !== l.line_no ? Number(no) : undefined;
  const dirty = Object.keys(values).length > 0 || newNo !== undefined;
  const needsReason = confirmed && ("qty_requested" in values || "price_unit" in values || "discount" in values);
  const invalid = !(Number(qty) > 0) || Number(price) < 0 || Number(disc) < 0 || Number(disc) > 100 || (newNo !== undefined && !(newNo >= 1));

  async function save() {
    const res = await run(`line-${l.id}-${JSON.stringify([values, newNo])}`, (k) =>
      updateLine(order.id, l.id, values, { line_no: newNo, reason }, k), { success: t("تم حفظ التعديل.") });
    if (res.ok) onDone();
  }

  const field = (label: string, node: React.ReactNode, cls = "") => <Field label={label} className={cls}>{node}</Field>;
  return (
    <div role="group" aria-label={t("تعديل السطر")} className="rounded-xl border border-brand-200 bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {field(t("رقم السطر"), <input className="input num" type="number" min={1} value={no} onChange={(e) => setNo(e.target.value)} />)}
        {field(t("الكمية"), <input className="input num" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />)}
        {field(t("السعر"), <input className="input num" type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} />)}
        {field(t("خصم %"), <input className="input num" type="number" min={0} max={100} step="any" value={disc} onChange={(e) => setDisc(e.target.value)} />)}
        {field(t("مجموعة الفاتورة"), <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder={t("مثال: شيبس")} />, "lg:col-span-2")}
        {field(t("ملاحظة على الصنف"), <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />, "sm:col-span-3 lg:col-span-6")}
        {needsReason && field(t("سبب التعديل (يُسجَّل في سجل التعديلات)"), <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("مثال: العميل طلب كمية أكبر")} />, "sm:col-span-3 lg:col-span-6")}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onDone}>{t("إلغاء")}</button>
        <button className="btn-primary" disabled={busy || !dirty || invalid || (needsReason && !reason.trim())} onClick={save}>{t("حفظ")}</button>
      </div>
    </div>
  );
}

function SubstituteDialog({ order, line, onClose }: { order: SupplyOrder; line: SupplyLine | null; onClose: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const [product, setProduct] = useState<LookupProduct | null>(null);
  const [reason, setReason] = useState("");
  const [returnDone, setReturnDone] = useState(false);

  async function submit() {
    if (!line || !product) return;
    const res = await run(`sub-${line.id}-${product.id}-${returnDone}`, (k) =>
      substituteLine(order.id, line.id, product.id, reason.trim(), returnDone, k), { success: t("تم استبدال الصنف.") });
    if (res.ok) onClose();
  }

  return (
    <Dialog open={!!line} onClose={onClose} title={t("استبدال صنف")}
      footer={<><button className="btn-secondary" onClick={onClose}>{t("إلغاء")}</button>
        <button className="btn-primary" disabled={busy || !product || !reason.trim()} onClick={submit}>{t("استبدال")}</button></>}>
      {line && (
        <div className="space-y-4">
          <p className="text-sm">{t("الصنف الحالي:")} <b>{line.product.name}</b>  {t("— الكمية")} <Num v={line.qty_requested} />{t("، المنفّذ")} <Num v={line.qty_done} /></p>
          <Field label={t("الصنف البديل")}>
            <ProductPicker onPick={setProduct} autoFocus />
            {product && <p className="mt-2 text-sm text-ok">{t("اخترت:")} <b>{product.name}</b></p>}</Field>
          <Field label={t("سبب الاستبدال (مطلوب)")}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("مثال: الصنف نفد من المخزن")} /></Field>
          {line.qty_done > 0 && (
            <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={returnDone} onChange={(e) => setReturnDone(e.target.checked)} />
              <span>{t("أرجِع أيضاً ما تم تحريكه من الصنف القديم ثم خطّط الكمية كاملة بالصنف الجديد.")} <span className="text-amber-800">{t("بدونها لا يمكن استبدال صنف تحرّكت كميته كاملة.")}</span></span>
            </label>
          )}
        </div>
      )}
    </Dialog>
  );
}

function RemoveDialog({ order, line, onClose }: { order: SupplyOrder; line: SupplyLine | null; onClose: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const [reason, setReason] = useState("");
  const confirmed = order.state !== "draft";
  async function submit() {
    if (!line) return;
    const res = await run(`rm-${line.id}`, (k) => removeLine(order.id, line.id, reason, k), { success: t("تم حذف الصنف.") });
    if (res.ok) onClose();
  }
  return (
    <Dialog open={!!line} onClose={onClose} title={t("حذف صنف")}
      footer={<><button className="btn-secondary" onClick={onClose}>{t("تراجع")}</button>
        <button className="btn-danger" disabled={busy || (confirmed && !reason.trim())} onClick={submit}>{t("حذف")}</button></>}>
      {line && (<div className="space-y-3">
        <p className="text-sm">{t("سيُحذف")} <b>{line.product.name}</b>  {t("من الأمر.")}</p>
        {confirmed && <Field label={t("السبب (يُسجَّل في سجل التعديلات)")}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>}
      </div>)}
    </Dialog>
  );
}

// ---------------------------------------------------------------- add item
function AddLine({ order }: { order: SupplyOrder }) {
  const t = useT();
  const { run, busy } = useAction();
  const { push } = useToast();
  const [product, setProduct] = useState<LookupProduct | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const confirmed = order.state !== "draft";
  const isSale = order.order_type === "sale";

  function pick(p: LookupProduct) {
    setProduct(p);
    setPrice(String(isSale ? p.sale_price : p.cost));
  }

  async function submit() {
    if (!product) return;
    const res = await run(`add-${product.id}-${qty}-${price}-${note}`, (k) =>
      addLine(order.id, { product_id: product.id, qty_requested: Number(qty), price_unit: price === "" ? undefined : Number(price), note: note || undefined }, reason, k),
      { success: confirmed ? t("أُضيف الصنف، وسيُخطَّط له إذن جديد إن كان للأمر إذن.") : t("أُضيف الصنف.") });
    if (res.ok) { setProduct(null); setQty("1"); setPrice(""); setNote(""); setReason(""); }
    else if (res.code === "validation_error") push("error", res.error);
  }

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-extrabold"><Plus className="size-4" />  {t("إضافة صنف")}</h2>
      <div className="grid gap-3 md:grid-cols-[1fr_6rem_8rem]">
        <Field label={t("الصنف")}><ProductPicker onPick={pick} clearOnPick={false} /></Field>
        <Field label={t("الكمية")}><input className="input num" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label={t("السعر")}><input className="input num" type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={t("ملاحظة على الصنف (اختياري)")} className="md:col-span-3"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {confirmed && <Field label={t("سبب الإضافة (يُسجَّل في سجل التعديلات)")} className="md:col-span-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("مثال: العميل طلب صنفاً إضافياً")} /></Field>}
      </div>
      <div className="mt-3 flex justify-end">
        <button className="btn-primary" disabled={busy || !product || !(Number(qty) > 0)} onClick={submit}><Plus className="size-4" />  {t("إضافة للأمر")}</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- side panels
function Totals({ order }: { order: SupplyOrder }) {
  const t = useT();
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-extrabold">{t("الملخص")}</h2>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-muted">{t("قبل الضريبة")}</dt><dd className="num font-semibold">{money.format(order.amount_untaxed)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">{t("الضريبة")}</dt><dd className="num font-semibold">{money.format(order.amount_tax)}</dd></div>
        <div className="flex justify-between border-t border-line pt-2 text-base"><dt className="font-bold">{t("الإجمالي")}</dt>
          <dd className="font-extrabold"><span className="num">{money.format(order.amount_total)}</span> <span className="text-xs text-muted">{order.currency}</span></dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2"><Fulfillment s={order.fulfillment_state} /><InvoiceBadge s={order.invoice_state} /></div>
      {order.note && <p className="mt-4 rounded-lg bg-canvas p-3 text-sm leading-6">{order.note}</p>}
    </section>
  );
}

function Documents({ order, odooUrl, canPrint, can }: { order: SupplyOrder; odooUrl: string; canPrint: boolean; can: string[] }) {
  const t = useT();
  const open = (d: SupplyOrder["documents"][number]) => `${odooUrl}/odoo/action-${d.model}/${d.id}`;
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-extrabold">{t("المستندات المرتبطة")}</h2>
      {order.documents.length === 0 ? <p className="text-sm text-muted">{t("لم يُنشأ أي مستند بعد. تُنشأ المستندات من الأمر في أي وقت.")}</p> : (
        <ul className="space-y-2">
          {order.documents.map((d) => (
            <li key={`${d.model}-${d.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-canvas/70 px-3 py-2 text-sm">
              <div className="min-w-0"><p className="truncate font-bold">{d.name || "—"}</p><p className="text-xs text-muted">{t(DOC_KIND[d.kind] ?? d.kind)} · {d.state}</p></div>
              <div className="flex shrink-0 gap-1">
                {d.model === "stock.picking" && can.includes("warehouse.view") && <a className="btn-ghost px-2 py-1 text-xs font-bold text-brand-700" href={`/warehouse/${d.id}`}>{t("فتح")}</a>}
                {canPrint && d.model === "account.move" && <a className="btn-ghost px-2 py-1 text-xs" target="_blank" rel="noreferrer" href={`/api/print/invoice/html/${d.id}`}>{t("طباعة")}</a>}
                <a className="btn-ghost px-2 py-1 text-xs" target="_blank" rel="noreferrer" href={open(d)}>{t("أودو")}</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeLog({ order }: { order: SupplyOrder }) {
  const t = useT();
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-extrabold">{t("سجل التعديلات")}</h2>
      {order.change_log.length === 0 ? <p className="text-sm text-muted">{t("لا تعديلات بعد التأكيد.")}</p> : (
        <ol className="relative space-y-4 border-s border-line ps-4">
          {order.change_log.map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -start-[1.3rem] top-1.5 size-2.5 rounded-full bg-brand-500 ring-4 ring-surface" />
              <p className="font-bold">{t(LOG_LABEL[e.type] ?? e.type)} <span className="font-semibold text-ink/70">— {e.item}</span></p>
              {(e.old || e.new) && <p className="text-xs"><span className="text-muted line-through">{e.old || "—"}</span> ← <b>{e.new || "—"}</b></p>}
              {e.reason && <p className="text-xs text-muted">{t("السبب:")} {e.reason}</p>}
              <p className="text-xs text-muted">{e.app_user || e.user} · {formatDate(e.date, true)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
