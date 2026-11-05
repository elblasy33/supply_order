import Link from "next/link";
import { Banknote, Landmark } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { odooData, odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Empty, ErrorBox, Num, PageHeader } from "@/components/ui";
import type { CashJournal, PartnerBalance } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("أرصدة العملاء والموردين") };
}

export default async function BalancesPage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; zero?: string }> }) {
  const t = await getT();
  const user = await requirePermission("accounting.ledger");
  const sp = await searchParams;
  const kind = sp.kind === "vendor" ? "vendor" : "customer";
  const opt = { extUserId: user.odooExtId };
  const [loaded, journals] = await Promise.all([
    attempt(() => odooPage<PartnerBalance>("partner_balances", { kind, query: sp.q || undefined, include_zero: sp.zero === "1", limit: 200 }, opt)),
    user.permissions.has("cash.view") ? attempt(() => odooData<CashJournal[]>("cash_journals", {}, opt)) : Promise.resolve(null),
  ]);
  const head = <PageHeader title={t("أرصدة العملاء والموردين")} subtitle={t("الرصيد المفتوح لكل عميل أو مورد من القيود المرحَّلة، ومنه كشف الحساب التفصيلي.")} />;
  if (!loaded.ok) return <>{head}<ErrorBox message={loaded.error} /></>;
  const { data: rows, balance_total: total, total: count } = loaded.data;
  const tab = (k: string, label: string) => (
    <Link href={`/accounting/balances?kind=${k}`} aria-current={kind === k ? "page" : undefined}
      className={`rounded-xl px-4 py-2 text-sm font-bold ${kind === k ? "bg-brand-50 text-brand-700" : "text-ink/70 hover:bg-canvas"}`}>{label}</Link>
  );
  return (
    <>
      {head}
      <div className="space-y-5">
        {journals?.ok && journals.data.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {journals.data.map((j) => (
              <div key={j.id} className="card p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-muted">{j.type === "cash" ? <Banknote className="size-4" /> : <Landmark className="size-4" />}{j.name}</p>
                <p className="mt-1 text-xl font-extrabold"><Num v={j.balance} dec /> <span className="text-xs font-semibold text-muted">{j.currency}</span></p>
              </div>))}
          </div>
        )}
        <section className="card overflow-hidden">
          <form className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3" action="/accounting/balances">
            <div className="flex gap-1" role="group">{tab("customer", t("العملاء"))}{tab("vendor", t("الموردون"))}</div>
            <input type="hidden" name="kind" value={kind} />
            <input name="q" defaultValue={sp.q ?? ""} placeholder={t("بحث بالاسم…")} className="input w-auto min-w-48" aria-label={t("بحث بالاسم…")} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="zero" value="1" defaultChecked={sp.zero === "1"} /> {t("إظهار الأرصدة الصفرية")}</label>
            <button className="btn-secondary">{t("بحث")}</button>
            <p className="ms-auto text-sm text-muted">{kind === "customer" ? t("إجمالي المستحق لنا") : t("إجمالي المستحق علينا")}:{" "}
              <b className="text-ink"><Num v={total ?? 0} dec /></b></p>
          </form>
          {rows.length === 0 ? <Empty title={t("لا توجد أرصدة")} /> : (
            <div className="overflow-x-auto"><table className="w-full">
              <thead className="bg-canvas/60"><tr><th className="th">{kind === "customer" ? t("العميل") : t("المورد")}</th><th className="th">{t("مدين")}</th>
                <th className="th">{t("دائن")}</th><th className="th">{t("الرصيد")}</th><th className="th">{t("آخر حركة")}</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-line">{rows.map((r) => (
                <tr key={r.partner.id}>
                  <td className="td font-bold">{r.partner.name}</td>
                  <td className="td"><Num v={r.debit} dec /></td><td className="td"><Num v={r.credit} dec /></td>
                  <td className="td font-extrabold"><Num v={r.balance} dec /></td><td className="td text-muted">{r.last_date}</td>
                  <td className="td"><Link className="font-semibold text-brand-700 hover:underline" href={`/accounting/balances/${kind}/${r.partner.id}`}>{t("كشف الحساب")}</Link></td>
                </tr>))}</tbody></table></div>
          )}
          {count > rows.length && <p className="border-t border-line px-5 py-2 text-xs text-muted">{t("يُعرض أكبر ٢٠٠ رصيد؛ استخدم البحث للباقي.")}</p>}
        </section>
      </div>
    </>
  );
}
