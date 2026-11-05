import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { odooData } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { ErrorBox, Num, PageHeader, formatDate } from "@/components/ui";
import type { Statement } from "@/lib/types";
import { PrintButton } from "./print";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("كشف الحساب") };
}

export default async function StatementPage({ params, searchParams }: {
  params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getT();
  const user = await requirePermission("accounting.ledger");
  const { kind, id } = await params;
  const sp = await searchParams;
  if ((kind !== "customer" && kind !== "vendor") || !/^\d+$/.test(id)) notFound();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && iso.test(sp.from) ? sp.from : undefined;
  const to = sp.to && iso.test(sp.to) ? sp.to : undefined;
  const loaded = await attempt(() => odooData<Statement>("partner_statement", { kind, partner_id: Number(id), date_from: from, date_to: to }, { extUserId: user.odooExtId }));
  const back = <Link href={`/accounting/balances?kind=${kind}`} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" /> {t("أرصدة العملاء والموردين")}</Link>;
  if (!loaded.ok) return <>{back}<PageHeader title={t("كشف الحساب")} /><ErrorBox message={loaded.error} /></>;
  const s = loaded.data;
  const stat = (label: string, v: number, strong = false) => <div><p className="text-xs text-muted">{label}</p><p className={strong ? "text-xl font-extrabold" : "text-lg font-bold"}><Num v={v} dec /></p></div>;
  return (
    <>
      {back}
      <PageHeader title={`${t("كشف الحساب")} — ${s.partner.name}`} subtitle={kind === "customer" ? t("الرصيد = ما يستحقه لنا العميل") : t("الرصيد = ما نستحقه نحن للمورد (علينا)")} actions={<PrintButton />} />
      <div className="space-y-5">
        <form className="card flex flex-wrap items-end gap-3 p-4 print:hidden">
          <label className="block"><span className="label">{t("من تاريخ")}</span><input type="date" name="from" defaultValue={from} className="input" /></label>
          <label className="block"><span className="label">{t("إلى تاريخ")}</span><input type="date" name="to" defaultValue={to} className="input" /></label>
          <button className="btn-secondary">{t("عرض")}</button>
        </form>
        <section className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          {stat(t("الرصيد الافتتاحي"), s.opening)}{stat(t("إجمالي مدين"), s.debit)}{stat(t("إجمالي دائن"), s.credit)}{stat(t("الرصيد الختامي"), s.closing, true)}
        </section>
        <section className="card overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="bg-canvas/60"><tr><th className="th">{t("التاريخ")}</th><th className="th">{t("المستند")}</th><th className="th">{t("اليومية")}</th><th className="th">{t("البيان")}</th>
              <th className="th">{t("مدين")}</th><th className="th">{t("دائن")}</th><th className="th">{t("الرصيد")}</th><th className="th">{t("الحالة")}</th></tr></thead>
            <tbody className="divide-y divide-line">
              <tr className="bg-canvas/40"><td className="td" colSpan={6}>{t("رصيد افتتاحي")}</td><td className="td font-bold"><Num v={s.opening} dec /></td><td className="td" /></tr>
              {s.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td text-muted">{formatDate(l.date)}</td><td className="td font-bold">{l.document.name}</td><td className="td">{l.journal}</td><td className="td text-muted">{l.label}</td>
                  <td className="td">{l.debit ? <Num v={l.debit} dec /> : ""}</td><td className="td">{l.credit ? <Num v={l.credit} dec /> : ""}</td>
                  <td className="td font-bold"><Num v={l.balance} dec /></td>
                  <td className="td text-xs">{l.reconciled ? t("مسوّى") : <>{t("مفتوح")} <Num v={l.open_amount} dec /></>}</td>
                </tr>))}
            </tbody></table></div>
          {s.truncated && <p className="border-t border-line px-5 py-2 text-xs text-warn">{t("تم عرض أول ٢٠٠٠ حركة؛ ضيّق الفترة.")}</p>}
        </section>
      </div>
    </>
  );
}
