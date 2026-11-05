"use client";

import { useEffect, useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import { expenseCreate, expenseProducts } from "@/app/actions/cash";
import { useAction } from "@/components/use-action";
import { Badge } from "@/components/badge";
import { Empty, Field, formatDate, money } from "@/components/ui";
import type { CashJournal, ExpenseProduct, ExpenseRow } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

const today = () => new Date().toISOString().slice(0, 10);
const STATE: Record<string, string> = { draft: "مسودة", submitted: "مقدَّم", approved: "معتمد", posted: "مرحَّل", in_payment: "قيد الدفع", paid: "مدفوع", refused: "مرفوض" };

export function ExpenseForm({ journals, rows }: { journals: CashJournal[]; rows: ExpenseRow[] }) {
  const t = useT();
  const { run, busy } = useAction();
  const [journalId, setJournalId] = useState(journals[0]?.id ?? 0);
  const [products, setProducts] = useState<ExpenseProduct[] | null>(null);
  const [productId, setProductId] = useState(0);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [intent, setIntent] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let live = true;
    expenseProducts("").then((r) => { if (live) setProducts(r.ok ? r.data : []); });
    return () => { live = false; };
  }, []);

  async function save() {
    const res = await run(`expense-${intent}`, (k) => expenseCreate({
      journal_id: journalId, product_id: productId, amount: Number(amount), date, notes: notes || undefined }, k),
      { success: t("تم تسجيل المصروف.") });
    if (res.ok) { setAmount(""); setNotes(""); setProductId(0); setIntent(crypto.randomUUID()); }
  }
  const ready = journalId > 0 && productId > 0 && Number(amount) > 0;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t("صرف من خزينة")}><select className="input" value={journalId} onChange={(e) => setJournalId(Number(e.target.value))}>
            {journals.map((j) => <option key={j.id} value={j.id}>{j.name} — {money.format(j.balance)}</option>)}</select></Field>
          <Field label={t("بند المصروف")}>
            <select className="input" value={productId} onChange={(e) => setProductId(Number(e.target.value))} disabled={products === null}>
              <option value={0}>{products === null ? t("جارٍ التحميل…") : products.length ? t("اختر البند") : t("لا توجد منتجات مصروفات")}</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label={t("المبلغ")}><input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t("التاريخ")}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={t("ملاحظات (اختياري)")} className="min-w-64 flex-1"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <button className="btn-primary py-2.5" disabled={!ready || busy} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />} {t("تسجيل المصروف")}</button>
        </div>
        <p className="mt-3 text-xs text-muted">{t("يُصرف المصروف دائماً على الشركة (وليس من موظف) ويُعتمد ويُرحَّل فوراً.")}</p>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-extrabold">{t("آخر المصروفات")}</h2>
        {rows.length === 0 ? <Empty title={t("لا توجد مصروفات بعد")} /> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="bg-canvas/60"><tr><th className="th">{t("البند")}</th><th className="th">{t("التاريخ")}</th><th className="th">{t("الخزينة")}</th>
              <th className="th">{t("المبلغ")}</th><th className="th">{t("الحالة")}</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r) => (
              <tr key={r.id}><td className="td font-bold">{r.name}</td><td className="td text-muted">{formatDate(r.date)}</td><td className="td">{r.journal.name}</td>
                <td className="td font-semibold"><span className="num">{money.format(r.amount)}</span></td>
                <td className="td"><Badge tone={r.state === "paid" || r.state === "posted" ? "green" : "slate"}>{t(STATE[r.state] ?? r.state)}</Badge></td></tr>))}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
