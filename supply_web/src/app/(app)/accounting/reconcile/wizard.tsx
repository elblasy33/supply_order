"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Loader2, Scale } from "lucide-react";
import { reconcileLoad, reconcileRun, type ReconcileResult } from "@/app/actions/accounting";
import { PartnerPicker } from "@/components/pickers";
import { useAction } from "@/components/use-action";
import { Field, Num, formatDate, money } from "@/components/ui";
import type { LookupPartner, OpenItem } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

export function ReconcileWizard() {
  const t = useT();
  const { run, busy } = useAction();
  const [kind, setKind] = useState<"customer" | "vendor">("customer");
  const [partner, setPartner] = useState<LookupPartner | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [order, setOrder] = useState<"due" | "invoice">("due");
  const [items, setItems] = useState<{ invoices: OpenItem[]; payments: OpenItem[] } | null>(null);
  const [inv, setInv] = useState<Set<number>>(new Set());
  const [pay, setPay] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const selectedTotal = useMemo(() => items?.invoices.filter((i) => inv.has(i.document.id)).reduce((s, i) => s + i.open_amount, 0) ?? 0, [items, inv]);
  const availableTotal = useMemo(() => items?.payments.filter((i) => pay.has(i.document.id)).reduce((s, i) => s + i.open_amount, 0) ?? 0, [items, pay]);

  async function load() {
    if (!partner) return;
    setResult(null);
    const res = await run("rec-load", () => reconcileLoad({ partner_id: partner.id, kind, date_from: from, date_to: to }), { refresh: false });
    if (res.ok) {
      setItems(res.data);
      setInv(new Set());
      setPay(new Set(res.data.payments.map((p) => p.document.id)));
    }
  }

  async function reconcile() {
    if (!partner) return;
    const res = await run(`rec-run-${partner.id}-${[...inv].sort()}-${[...pay].sort()}-${order}`, (k) =>
      reconcileRun({ partner_id: partner.id, kind, date_from: from, date_to: to, invoice_ids: [...inv], payment_ids: [...pay], allocation_order: order }, k),
      { success: t("تمت التسوية."), refresh: false });
    if (res.ok) { setResult(res.data); setItems(null); }
  }

  const toggle = (set: Set<number>, id: number, apply: (s: Set<number>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    apply(n);
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[12rem_1fr_10rem_10rem_auto]">
          <Field label={t("النوع")}>
            <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as "customer" | "vendor"); setPartner(null); setItems(null); }}>
              <option value="customer">{t("عميل")}</option><option value="vendor">{t("مورد")}</option></select></Field>
          <div><span className="label">{kind === "customer" ? t("العميل") : t("المورد")}</span>
            {partner ? <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3 py-2"><b>{partner.name}</b>
              <button className="tap px-2 text-sm font-semibold text-brand-700 hover:underline" onClick={() => { setPartner(null); setItems(null); }}>{t("تغيير")}</button></div>
              : <PartnerPicker onPick={setPartner} />}</div>
          <Field label={t("من تاريخ")}><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t("إلى تاريخ")}><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex items-end"><button className="btn-primary w-full" disabled={!partner || busy} onClick={load}>{busy && !items && <Loader2 className="size-4 animate-spin" />}  {t("تحميل")}</button></div>
        </div>
      </section>

      {result && (
        <section className="card border-green-200 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-extrabold text-ok"><CheckCircle2 className="size-5" />  {t("تمت التسوية —")} <span className="num text-sm">{result.batch}</span></h2>
          <table className="w-full"><thead className="bg-canvas/60"><tr><th className="th">{t("الفاتورة")}</th><th className="th">{t("الدفعة")}</th><th className="th">{t("المبلغ المسوّى")}</th><th className="th">{t("المتبقي على الفاتورة")}</th></tr></thead>
            <tbody className="divide-y divide-line">{result.pairs.map((p, i) => (
              <tr key={i}><td className="td font-bold">{p.invoice.name}</td><td className="td">{p.payment.name}</td>
                <td className="td"><span className="num">{money.format(p.amount)}</span></td><td className="td"><span className="num">{money.format(p.invoice_left)}</span></td></tr>))}</tbody></table>
          <p className="mt-3 text-sm">{t("المتبقي على الفواتير المحددة:")} <b className="num">{money.format(result.remaining)}</b></p>
        </section>
      )}

      {items && (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ItemsTable title={t("الفواتير (حدّد ما تريد تسويته)")} rows={items.invoices} selected={inv} onToggle={(id) => toggle(inv, id, setInv)}
              onAll={(on) => setInv(on ? new Set(items.invoices.map((i) => i.document.id)) : new Set())} empty={t("لا فواتير مفتوحة في هذه الفترة.")} />
            <ItemsTable title={t("الدفعات والإشعارات الدائنة المتاحة")} rows={items.payments} selected={pay} onToggle={(id) => toggle(pay, id, setPay)}
              onAll={(on) => setPay(on ? new Set(items.payments.map((i) => i.document.id)) : new Set())} empty={t("لا دفعات متاحة. (الدفعة بلا قيد لا تظهر هنا)")} />
          </div>
          <section className="card sticky bottom-3 z-10 flex flex-wrap items-center gap-x-8 gap-y-3 p-4 shadow-lg">
            <div><p className="text-xs text-muted">{t("إجمالي المحدد")}</p><p className="text-lg font-extrabold"><Num v={selectedTotal} dec /></p></div>
            <div><p className="text-xs text-muted">{t("إجمالي المتاح")}</p><p className="text-lg font-extrabold"><Num v={availableTotal} dec /></p></div>
            <div><p className="text-xs text-muted">{t("المتبقي بعد التسوية")}</p><p className={clsx("text-lg font-extrabold", selectedTotal > availableTotal && "text-warn")}><Num v={Math.max(selectedTotal - availableTotal, 0)} dec /></p></div>
            <div className="flex flex-wrap items-end gap-3 sm:ms-auto">
              <Field label={t("ترتيب التوزيع")}>
                <select className="input" value={order} onChange={(e) => setOrder(e.target.value as "due" | "invoice")}>
                  <option value="due">{t("الأقدم استحقاقاً")}</option><option value="invoice">{t("الأقدم فاتورةً")}</option></select></Field>
              <button className="btn-primary py-2.5" disabled={busy || inv.size === 0 || pay.size === 0} onClick={reconcile}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}  {t("تسوية")}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ItemsTable({ title, rows, selected, onToggle, onAll, empty }: {
  title: string; rows: OpenItem[]; selected: Set<number>; onToggle: (id: number) => void; onAll: (on: boolean) => void; empty: string;
}) {
  const t = useT();
  const all = rows.length > 0 && rows.every((r) => selected.has(r.document.id));
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-line px-5 py-3 font-extrabold">{title}</h2>
      {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p> : (
        <table className="w-full"><thead className="bg-canvas/60"><tr>
          <th className="th w-10"><input type="checkbox" aria-label={t("تحديد الكل")} checked={all} onChange={(e) => onAll(e.target.checked)} /></th>
          <th className="th">{t("المستند")}</th><th className="th">{t("التاريخ")}</th><th className="th">{t("الاستحقاق")}</th><th className="th">{t("المفتوح")}</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => (
            <tr key={r.id} className={clsx("cursor-pointer hover:bg-canvas/50", selected.has(r.document.id) && "bg-brand-50/50")} onClick={() => onToggle(r.document.id)}>
              <td className="td"><input type="checkbox" aria-label={t(`تحديد ${r.document.name}`)} checked={selected.has(r.document.id)} onChange={() => onToggle(r.document.id)} onClick={(e) => e.stopPropagation()} /></td>
              <td className="td font-bold">{r.document.name}</td><td className="td text-muted">{formatDate(r.date)}</td><td className="td text-muted">{formatDate(r.due)}</td>
              <td className="td font-semibold"><span className="num">{money.format(r.open_amount)}</span> <span className="text-xs text-muted">{r.currency}</span></td></tr>))}</tbody></table>
      )}
    </section>
  );
}
