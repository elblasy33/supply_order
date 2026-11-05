"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, Landmark, Loader2 } from "lucide-react";
import { cashEntry, cashTransfer } from "@/app/actions/cash";
import { PartnerPicker } from "@/components/pickers";
import { Dialog } from "@/components/dialog";
import { useAction } from "@/components/use-action";
import { Badge } from "@/components/badge";
import { Empty, Field, Num, formatDate, money } from "@/components/ui";
import type { CashJournal, CashMove, LookupPartner } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

type Mode = "receipt" | "payment" | "transfer";
const today = () => new Date().toISOString().slice(0, 10);
const KIND = { receipt: "قبض", payment: "صرف", transfer: "تحويل", expense: "مصروف" } as const;
const TONE = { receipt: "green", payment: "amber", transfer: "slate", expense: "red" } as const;

export function CashPanel({ journals, moves, kind, journal, can }: {
  journals: CashJournal[]; moves: CashMove[]; kind: string; journal: string;
  can: { receive: boolean; pay: boolean; transfer: boolean };
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const filter = (k: string, j: string) => router.push(`/cash?${new URLSearchParams({ ...(k && { kind: k }), ...(j && { journal: j }) })}`);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {journals.map((j) => (
          <div key={j.id} className="card p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-muted">
              {j.type === "cash" ? <Banknote className="size-4" /> : <Landmark className="size-4" />}{j.name}</p>
            <p className="mt-1 text-2xl font-extrabold"><Num v={j.balance} dec /> <span className="text-xs font-semibold text-muted">{j.currency}</span></p>
          </div>
        ))}
        {journals.length === 0 && <p className="card p-4 text-sm text-muted sm:col-span-2 xl:col-span-4">{t("لا توجد يوميات نقدية أو بنكية في أودو.")}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {can.receive && <button className="btn-primary" onClick={() => setMode("receipt")}><ArrowDownToLine className="size-4" /> {t("قبض نقدية")}</button>}
        {can.pay && <button className="btn-secondary" onClick={() => setMode("payment")}><ArrowUpFromLine className="size-4" /> {t("صرف نقدية")}</button>}
        {can.transfer && <button className="btn-secondary" onClick={() => setMode("transfer")}><ArrowLeftRight className="size-4" /> {t("تحويل بين الخزائن")}</button>}
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="font-extrabold">{t("آخر الحركات")}</h2>
          <select className="input ms-auto w-auto" aria-label={t("النوع")} value={kind} onChange={(e) => filter(e.target.value, journal)}>
            <option value="">{t("كل الأنواع")}</option>
            {(["receipt", "payment", "transfer"] as const).map((k) => <option key={k} value={k}>{t(KIND[k])}</option>)}
          </select>
          <select className="input w-auto" aria-label={t("الخزينة")} value={journal} onChange={(e) => filter(kind, e.target.value)}>
            <option value="">{t("كل الخزائن")}</option>
            {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>
        {moves.length === 0 ? <Empty title={t("لا توجد حركات بعد")} /> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="bg-canvas/60"><tr><th className="th">{t("النوع")}</th><th className="th">{t("الرقم")}</th><th className="th">{t("التاريخ")}</th>
              <th className="th">{t("الخزينة")}</th><th className="th">{t("الطرف")}</th><th className="th">{t("المبلغ")}</th><th className="th">{t("البيان")}</th></tr></thead>
            <tbody className="divide-y divide-line">{moves.map((m) => (
              <tr key={m.id}>
                <td className="td"><Badge tone={TONE[m.kind]}>{t(KIND[m.kind])}</Badge></td>
                <td className="td font-bold">{m.name}</td><td className="td text-muted">{formatDate(m.date)}</td>
                <td className="td">{m.journal.name}</td><td className="td">{m.partner?.name ?? (m.counter_journal ? `${m.direction === "outbound" ? "→" : "←"} ${m.counter_journal.name}` : "")}</td>
                <td className="td font-semibold"><span className="num">{money.format(m.amount)}</span></td><td className="td text-muted">{m.ref}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>

      <VoucherDialog key={mode ?? "none"} mode={mode} journals={journals} onClose={() => setMode(null)} />
    </div>
  );
}

function VoucherDialog({ mode, journals, onClose }: { mode: Mode | null; journals: CashJournal[]; onClose: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const [journalId, setJournalId] = useState(journals[0]?.id ?? 0);
  const [toId, setToId] = useState(journals[1]?.id ?? 0);
  const [kind, setKind] = useState<"customer" | "vendor">("customer");
  const [partner, setPartner] = useState<LookupPartner | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [ref, setRef] = useState("");
  const [intent] = useState(() => crypto.randomUUID());

  async function save() {
    if (!mode) return;
    const common = { amount: Number(amount), date, ref: ref || undefined };
    const res = await run(`cash-${intent}`, (k) => mode === "transfer"
      ? cashTransfer({ ...common, from_journal_id: journalId, to_journal_id: toId }, k)
      : cashEntry({ ...common, journal_id: journalId, partner_id: partner?.id ?? 0, partner_kind: kind, direction: mode === "receipt" ? "in" : "out" }, k),
      { success: t("تم تسجيل الحركة.") });
    if (res.ok) onClose();
  }
  const ready = Number(amount) > 0 && journalId > 0 && (mode === "transfer" ? toId > 0 && toId !== journalId : !!partner);
  const title = mode === "receipt" ? t("قبض نقدية") : mode === "payment" ? t("صرف نقدية") : t("تحويل بين الخزائن");
  const journalSelect = (value: number, set: (n: number) => void, label: string) => (
    <Field label={label}><select className="input" value={value} onChange={(e) => set(Number(e.target.value))}>
      {journals.map((j) => <option key={j.id} value={j.id}>{j.name} — {money.format(j.balance)}</option>)}</select></Field>
  );

  return (
    <Dialog open={mode !== null} onClose={onClose} title={title} footer={
      <><button className="btn-ghost" onClick={onClose}>{t("إلغاء")}</button>
        <button className="btn-primary" disabled={!ready || busy} onClick={save}>{busy && <Loader2 className="size-4 animate-spin" />} {t("حفظ")}</button></>}>
      <div className="space-y-4">
        {journalSelect(journalId, setJournalId, mode === "transfer" ? t("من خزينة") : t("الخزينة / اليومية"))}
        {mode === "transfer" ? journalSelect(toId, setToId, t("إلى خزينة")) : (
          <>
            <Field label={t("النوع")}>
              <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as "customer" | "vendor"); setPartner(null); }}>
                <option value="customer">{t("عميل")}</option><option value="vendor">{t("مورد")}</option></select></Field>
            <div><span className="label">{kind === "customer" ? t("العميل") : t("المورد")}</span>
              {partner ? <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3 py-2"><b>{partner.name}</b>
                <button className="tap px-2 text-sm font-semibold text-brand-700 hover:underline" onClick={() => setPartner(null)}>{t("تغيير")}</button></div>
                : <PartnerPicker onPick={setPartner} />}</div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("المبلغ")}><input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t("التاريخ")}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label={t("البيان (اختياري)")}><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        {mode !== "transfer" && <p className="text-xs text-muted">{t("تُسجَّل الحركة على حساب الطرف دون تسويتها بأي فاتورة؛ يمكن تسويتها لاحقاً.")}</p>}
      </div>
    </Dialog>
  );
}
