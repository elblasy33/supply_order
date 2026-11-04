"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Barcode, Ban, Check, CheckCheck, CircleSlash, ListChecks, Minus, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { cancelPicking, returnPicking, savePicking, scanPicking, validatePicking, type CountLine } from "@/app/actions/warehouse";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { useAction } from "@/components/use-action";
import { Badge, Num, formatDate } from "@/components/ui";
import type { Picking, PickingMove } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

type EntryDraft = { lot: string; qty: string };
type RowDraft = { moveId: number; tracked: boolean; qty: string; entries: EntryDraft[] };

const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

function initialRow(m: PickingMove): RowDraft {
  const tracked = m.product.tracking !== "none";
  return {
    moveId: m.id,
    tracked,
    qty: fmt(m.quantity),
    entries: m.entries.map((e) => ({ lot: e.lot?.name ?? e.lot_name, qty: fmt(e.quantity) })),
  };
}

const rowTotal = (r: RowDraft) => (r.tracked ? r.entries.reduce((s, e) => s + num(e.qty), 0) : num(r.qty));

function payload(rows: RowDraft[]): CountLine[] {
  return rows.map((r) =>
    r.tracked
      ? { move_id: r.moveId, entries: r.entries.filter((e) => num(e.qty) > 0).map((e) => ({ quantity: num(e.qty), lot_name: e.lot.trim() || undefined })) }
      : { move_id: r.moveId, quantity: num(r.qty) },
  );
}

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.06;
    o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => ctx.close();
  } catch { /* no audio */ }
}

export function PickingWorkspace({ picking, can }: { picking: Picking; can: string[] }) {
  const t = useT();
  const { run, busy } = useAction();
  const { push } = useToast();
  const open = picking.moves.filter((m) => m.state !== "done" && m.state !== "cancel");
  const [rows, setRows] = useState<RowDraft[]>(() => open.map(initialRow));
  // When Odoo's numbers change (after a save, scan or validation) the counting form restarts from them.
  // Done while rendering, not by remounting, so the scan field keeps its text and focus between scans.
  const fingerprint = `${picking.id}-${picking.state}-${picking.moves.map((m) => `${m.id}:${m.quantity}:${m.entries.map((e) => `${e.lot?.id ?? e.lot_name}=${e.quantity}`).join(",")}`).join("|")}`;
  const [seen, setSeen] = useState(fingerprint);
  if (seen !== fingerprint) {
    setSeen(fingerprint);
    setRows(open.map(initialRow));
  }
  const [ask, setAsk] = useState<null | "backorder" | "expired" | "cancel" | "return">(null);
  const [backorder, setBackorder] = useState<"create" | "none">("create");
  const editable = picking.can_edit && can.includes("warehouse.process");

  const original = useMemo(() => JSON.stringify(payload(open.map(initialRow))), [open]);
  const dirty = JSON.stringify(payload(rows)) !== original;
  const rowOf = (id: number) => rows.find((r) => r.moveId === id);
  const patch = (id: number, f: (r: RowDraft) => RowDraft) => setRows((rs) => rs.map((r) => (r.moveId === id ? f(r) : r)));

  const short = open.filter((m) => rowTotal(rowOf(m.id)!) < m.demand - 1e-9);
  const counted = rows.some((r) => rowTotal(r) > 0);

  async function persist(): Promise<boolean> {
    if (!dirty) return true;
    const res = await run(`save-${JSON.stringify(payload(rows))}`, (k) => savePicking(picking.id, payload(rows), k), { refresh: false });
    return res.ok;
  }

  async function save() {
    const res = await run(`save-${JSON.stringify(payload(rows))}`, (k) => savePicking(picking.id, payload(rows), k), { success: t("تم حفظ الكميات.") });
    return res.ok;
  }

  async function validate(choice: "create" | "none" | null, allowExpired = false) {
    if (!(await persist())) return;
    const res = await run(`validate-${choice}-${allowExpired}`, (k) => validatePicking(picking.id, choice, allowExpired, k), { success: t("تم التنفيذ.") });
    setAsk(null);
    if (!res.ok && res.code === "conflict") setAsk("expired");
    if (res.ok && res.data.created_backorders?.length) push("info", t(`أُنشئ إذن للمتبقي: ${res.data.created_backorders.map((b) => b.name).join("، ")}`));
  }

  function startValidate() {
    if (short.length > 0) { setBackorder("create"); setAsk("backorder"); } else validate(null);
  }

  function fillAll() {
    setRows((rs) => rs.map((r) => {
      const m = open.find((x) => x.id === r.moveId)!;
      if (!r.tracked) return { ...r, qty: fmt(m.demand) };
      if (r.entries.length <= 1) return { ...r, entries: [{ lot: r.entries[0]?.lot ?? "", qty: fmt(m.demand) }] };
      const rest = m.demand - rowTotal(r);
      return rest > 0 ? { ...r, entries: [...r.entries, { lot: "", qty: fmt(rest) }] } : r;
    }));
  }

  return (
    <div className="space-y-5">
      {picking.state !== "done" && picking.state !== "cancel" && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          {can.includes("warehouse.validate") && picking.can_validate && (
            <button className="btn-primary" disabled={busy || !counted} onClick={startValidate}><CheckCheck className="size-4" />  {t("تأكيد")} {picking.kind === "delivery" ? t("التسليم") : t("الاستلام")}</button>
          )}
          {editable && <button className="btn-secondary" disabled={busy || !dirty} onClick={save}><Save className="size-4" />  {t("حفظ الكميات")}</button>}
          {editable && <button className="btn-secondary" disabled={busy} onClick={fillAll}><ListChecks className="size-4" />  {t("تعبئة كل المطلوب")}</button>}
          {dirty && <Badge tone="amber">{t("تعديلات غير محفوظة")}</Badge>}
          {can.includes("warehouse.cancel") && picking.can_cancel && (
            <button className="btn-ghost ms-auto text-bad hover:bg-red-50" disabled={busy} onClick={() => setAsk("cancel")}><Ban className="size-4" />  {t("إلغاء الإذن")}</button>
          )}
        </div>
      )}
      {picking.state === "done" && can.includes("warehouse.return") && picking.can_return && (
        <div className="card flex items-center gap-2 p-3">
          <button className="btn-secondary" disabled={busy} onClick={() => setAsk("return")}><Undo2 className="size-4" />  {t("إنشاء مرتجع")}</button>
          <span className="text-sm text-muted">{t("يعيد الكميات للمخزن ويخصمها من المنفّذ في أمر التوريد.")}</span>
        </div>
      )}

      {editable && <ScanBar picking={picking} persist={persist} />}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-extrabold">{t("الأصناف")} <span className="num ms-1 text-sm font-semibold text-muted">({picking.moves.length})</span></h2>
          {short.length > 0 && editable && <Badge tone="amber">{short.length}  {t("صنف ناقص عن المطلوب")}</Badge>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead className="bg-canvas/60"><tr>
              <th className="th w-10">#</th><th className="th">{t("الصنف")}</th><th className="th w-28">{t("المطلوب")}</th>
              <th className="th w-72">{picking.state === "done" ? t("المنفّذ") : t("المنفّذ فعلاً (العدّ)")}</th><th className="th w-32">{t("الفرق")}</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {picking.moves.map((m) => {
                const draft = rowOf(m.id);
                const isOpen = !!draft;
                const total = isOpen ? rowTotal(draft) : m.quantity;
                return (
                  <tr key={m.id} className="align-top hover:bg-canvas/40">
                    <td className="td num text-muted">{m.line_no || ""}</td>
                    <td className="td">
                      <p className="font-bold">{m.product.name}</p>
                      <p className="text-xs text-muted">{m.product.uom}{m.product.tracking !== "none" && <> · {m.product.tracking === "serial" ? t("رقم تسلسلي") : t("بالتشغيلات")}</>}{m.note && <> · 📝 {m.note}</>}</p>
                    </td>
                    <td className="td font-semibold"><Num v={m.demand} /></td>
                    <td className="td">
                      {isOpen && editable ? <Counter draft={draft} move={m} onChange={(f) => patch(m.id, f)} receipt={picking.kind === "receipt"} />
                        : <ReadCount move={m} total={total} />}
                    </td>
                    <td className="td"><Diff demand={m.demand} total={total} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {picking.backorders.length > 0 && (
        <section className="card p-4 text-sm">
          <b>{t("أذونات المتبقي:")}</b> {picking.backorders.map((b) => <Link key={b.id} href={`/warehouse/${b.id}`} className="me-3 font-bold text-brand-700 hover:underline">{b.name}</Link>)}
        </section>
      )}

      <Dialog open={ask === "backorder"} onClose={() => setAsk(null)} title={t("بعض الكميات ناقصة")}
        footer={<><button className="btn-secondary" onClick={() => setAsk(null)}>{t("رجوع للعدّ")}</button>
          <button className="btn-primary" disabled={busy} onClick={() => validate(backorder)}>{t("تأكيد")}</button></>}>
        <div className="space-y-3 text-sm">
          <p>{t("الأصناف الناقصة:")} {short.map((m) => m.product.name).join(t("، "))}.</p>
          {([["create", t("إنشاء إذن للمتبقي"), t("يبقى المتبقي مفتوحاً لتنفيذه لاحقاً.")], ["none", t("إسقاط المتبقي"), t("لن يُنفَّذ المتبقي ولن يُنشأ له إذن.")]] as const).map(([v, title, desc]) => (
            <label key={v} className={clsx("flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3", backorder === v ? "border-brand-500 bg-brand-50" : "border-line")}>
              <input type="radio" name="bo" className="mt-1" checked={backorder === v} onChange={() => setBackorder(v)} />
              <span><b>{t(title)}</b><br /><span className="text-muted">{t(desc)}</span></span>
            </label>
          ))}
        </div>
      </Dialog>
      <Dialog open={ask === "expired"} onClose={() => setAsk(null)} title={t("تشغيلات منتهية الصلاحية")}
        footer={<><button className="btn-secondary" onClick={() => setAsk(null)}>{t("تراجع")}</button>
          <button className="btn-danger" disabled={busy} onClick={() => validate(short.length ? backorder : null, true)}>{t("تأكيد على أي حال")}</button></>}>
        <p className="text-sm leading-7">{t("بعض التشغيلات في هذا الإذن منتهية الصلاحية. هل تريد المتابعة؟")}</p>
      </Dialog>
      <Dialog open={ask === "cancel"} onClose={() => setAsk(null)} title={t("إلغاء الإذن")}
        footer={<><button className="btn-secondary" onClick={() => setAsk(null)}>{t("تراجع")}</button>
          <button className="btn-danger" disabled={busy} onClick={async () => { const r = await run("cancel-picking", (k) => cancelPicking(picking.id, k), { success: t("أُلغي الإذن.") }); if (r.ok) setAsk(null); }}>{t("نعم، ألغِ")}</button></>}>
        <p className="text-sm leading-7">{t("سيُلغى الإذن ويرجع المطلوب غير مخطَّط في أمر التوريد، فتستطيع تجهيز إذن جديد.")}</p>
      </Dialog>
      <ReturnDialog open={ask === "return"} onClose={() => setAsk(null)} picking={picking} />
    </div>
  );
}

function Diff({ demand, total }: { demand: number; total: number }) {
  const t = useT();
  const d = Math.round((total - demand) * 10000) / 10000;
  if (d === 0) return <Badge tone="green"><Check className="size-3" />  {t("مطابق")}</Badge>;
  return d < 0 ? <Badge tone="amber">{t("ناقص")} <Num v={Math.abs(d)} /></Badge> : <Badge tone="brand">{t("زيادة")} <Num v={d} /></Badge>;
}

function ReadCount({ move, total }: { move: PickingMove; total: number }) {
  const t = useT();
  return (
    <div>
      <p className="font-bold"><Num v={total} /> <span className="text-xs font-normal text-muted">{move.uom}</span></p>
      {move.entries.filter((e) => e.lot || e.lot_name).map((e) => (
        <p key={e.id} className="text-xs text-muted">{t("تشغيلة")} <span className="num font-semibold text-ink">{e.lot?.name ?? e.lot_name}</span> × <Num v={e.quantity} />{e.lot?.expiration_date && <>  {t("· تنتهي")} {formatDate(e.lot.expiration_date)}</>}</p>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const t = useT();
  const step = (d: number) => onChange(fmt(Math.max(0, num(value) + d)));
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn-secondary px-2 py-1.5" aria-label={t(`إنقاص ${label}`)} onClick={() => step(-1)}><Minus className="size-4" /></button>
      <input aria-label={label} className="input num w-24 text-center font-bold" type="number" min={0} step="any" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn-secondary px-2 py-1.5" aria-label={t(`زيادة ${label}`)} onClick={() => step(1)}><Plus className="size-4" /></button>
    </div>
  );
}

function Counter({ draft, move, onChange, receipt }: { draft: RowDraft; move: PickingMove; onChange: (f: (r: RowDraft) => RowDraft) => void; receipt: boolean }) {
  const t = useT();
  if (!draft.tracked) {
    return <Stepper label={t(`كمية ${move.product.name}`)} value={draft.qty} onChange={(v) => onChange((r) => ({ ...r, qty: v }))} />;
  }
  const setEntry = (i: number, f: Partial<EntryDraft>) => onChange((r) => ({ ...r, entries: r.entries.map((e, j) => (j === i ? { ...e, ...f } : e)) }));
  return (
    <div className="space-y-2">
      {draft.entries.map((e, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input dir="ltr" aria-label={t(`رقم التشغيلة ${move.product.name}`)} className="input font-mono" value={e.lot} onChange={(ev) => setEntry(i, { lot: ev.target.value })}
            placeholder={move.auto_lot && receipt ? t("تلقائي") : t("رقم التشغيلة")} />
          <input aria-label={t(`كمية التشغيلة ${move.product.name}`)} className="input num w-20 text-center font-bold" type="number" min={0} step="any" value={e.qty} onChange={(ev) => setEntry(i, { qty: ev.target.value })} />
          <button type="button" className="btn-ghost px-2 hover:text-bad" aria-label={t("حذف التشغيلة")} onClick={() => onChange((r) => ({ ...r, entries: r.entries.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></button>
        </div>
      ))}
      <button type="button" className="btn-ghost -ms-2 px-2 py-1 text-xs text-brand-700" onClick={() => onChange((r) => ({ ...r, entries: [...r.entries, { lot: "", qty: "" }] }))}><Plus className="size-3.5" /> {receipt ? t("تشغيلة جديدة") : t("تشغيلة")}</button>
    </div>
  );
}

function ScanBar({ picking, persist }: { picking: Picking; persist: () => Promise<boolean> }) {
  const t = useT();
  const { run, busy } = useAction();
  const { push } = useToast();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  async function submit() {
    const code = value.trim();
    if (!code || busy) return;
    setValue("");
    if (!(await persist())) return; // keep the counts typed so far before the scan reads them from Odoo
    const res = await run(`pscan-${Date.now()}`, (k) => scanPicking(picking.id, code, k), { refresh: true });
    if (!res.ok) { beep(false); return; }
    const good = !["unknown", "ambiguous", "rejected", "need_lot"].includes(res.data.outcome);
    beep(good);
    push(good ? "ok" : "error", good ? t(`تم العدّ — ${code}`) : res.data.message);
    ref.current?.focus();
  }

  return (
    <div className="card p-4">
      <label htmlFor="pscan" className="label flex items-center gap-1.5"><Barcode className="size-4" />  {t("امسح باركود الصنف أو رقم التشغيلة (كل مسح = وحدة)")}</label>
      <div className="flex gap-2">
        <input id="pscan" ref={ref} dir="ltr" value={value} disabled={busy} autoComplete="off" onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} className="input font-mono text-base" placeholder={t("امسح أو اكتب ثم Enter")} />
        <button className="btn-primary" onClick={submit} disabled={busy || !value.trim()}>{t("عدّ")}</button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><CircleSlash className="hidden" />{t("الصنف المتتبَّع بالتشغيلات: امسح رقم التشغيلة. في الاستلام، رقم غير معروف بعد صنف متتبَّع يُسجَّل كتشغيلة جديدة.")}</p>
    </div>
  );
}

function ReturnDialog({ open, onClose, picking }: { open: boolean; onClose: () => void; picking: Picking }) {
  const t = useT();
  const { run, busy } = useAction();
  const done = picking.moves.filter((m) => m.state === "done");
  const [qty, setQty] = useState<Record<number, string>>({});
  const lines = done.map((m) => ({ move_id: m.id, quantity: num(qty[m.id] ?? "") })).filter((l) => l.quantity > 0);
  async function submit() {
    const res = await run(`return-${JSON.stringify(lines)}`, (k) => returnPicking(picking.id, lines, k), { success: t("تم إنشاء المرتجع وتنفيذه.") });
    if (res.ok) onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title={t("مرتجع من هذا الإذن")}
      footer={<><button className="btn-secondary" onClick={onClose}>{t("إلغاء")}</button><button className="btn-primary" disabled={busy || lines.length === 0} onClick={submit}>{t("إنشاء المرتجع")}</button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t("اكتب الكمية المرتجعة لكل صنف (اتركها فارغة لما لا يُرجَع).")}</p>
        {done.map((m) => (
          <label key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-canvas/70 px-3 py-2 text-sm">
            <span><b>{m.product.name}</b> <span className="text-muted">{t("— منفّذ")} <Num v={m.quantity} /></span></span>
            <input aria-label={t(`مرتجع ${m.product.name}`)} className="input num w-24 text-center" type="number" min={0} max={m.quantity} step="any" value={qty[m.id] ?? ""}
              onChange={(e) => setQty((q) => ({ ...q, [m.id]: e.target.value }))} />
          </label>
        ))}
      </div>
    </Dialog>
  );
}
