import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import clsx from "clsx";
import { requirePermission } from "@/lib/auth";
import { odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, Empty, ErrorBox, PageHeader, formatDate } from "@/components/ui";
import { KIND } from "@/components/labels";
import { PickingStateBadge } from "@/components/picking-ui";
import type { PickingSummary } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("المخزن") };
}
const PAGE = 25;

const KINDS = [["", "الكل"], ["delivery", "تسليم"], ["receipt", "استلام"]] as const;
const STATES = [["ready", "جاهزة للتنفيذ"], ["done", "منفّذة"], ["cancel", "ملغاة"], ["all", "الكل"]] as const;
const STATE_FILTER: Record<string, string[] | undefined> = {
  ready: ["assigned", "confirmed", "waiting"], done: ["done"], cancel: ["cancel"], all: undefined,
};

type SP = { q?: string; kind?: string; state?: string; page?: string };
function href(sp: SP, patch: Partial<SP>) {
  const merged = { ...sp, page: undefined, ...patch };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]);
  return `/warehouse${qs.size ? `?${qs}` : ""}`;
}

async function Chips({ label, options, current, sp, field }: { label: string; options: readonly (readonly [string, string])[]; current: string; sp: SP; field: keyof SP }) {
  const t = await getT();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-xs font-bold text-muted">{t(label)}</span>
      {options.map(([v, text]) => (
        <Link key={v} href={href(sp, { [field]: v })} aria-current={current === v ? "true" : undefined}
          className={clsx("chip",
            current === v ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-surface hover:border-brand-200")}>{t(text)}</Link>
      ))}
    </div>
  );
}

export default async function WarehousePage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  const user = await requirePermission("warehouse.view");
  const sp = await searchParams;
  const state = sp.state && sp.state in STATE_FILTER ? sp.state : "ready";
  const page = Math.max(1, Number(sp.page) || 1);
  const loaded = await attempt(() => odooPage<PickingSummary>("picking_search", {
    query: sp.q || undefined, kind: sp.kind || undefined, state: STATE_FILTER[state], offset: (page - 1) * PAGE, limit: PAGE,
  }, { extUserId: user.odooExtId }));
  if (!loaded.ok) return <><PageHeader title={t("المخزن")} /><ErrorBox message={loaded.error} /></>;
  const res = loaded.data;
  const pages = Math.max(1, Math.ceil(res.total / PAGE));
  return (
    <>
      <PageHeader title={t("المخزن")} subtitle={t("أذونات التسليم والاستلام: عدّ ما تحرّك فعلاً ثم أكّد")} />
      <div className="card mb-4 space-y-3 p-4">
        <form action="/warehouse" className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={sp.q} className="input ps-9" placeholder={t("ابحث برقم الإذن أو أمر التوريد أو الشريك…")} aria-label={t("بحث")} />
          {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
          <input type="hidden" name="state" value={state} />
        </form>
        <Chips label={t("النوع")} options={KINDS} current={sp.kind ?? ""} sp={sp} field="kind" />
        <Chips label={t("الحالة")} options={STATES} current={state} sp={sp} field="state" />
      </div>
      {/* phones: one card per transfer */}
      <ul className="space-y-3 md:hidden" aria-label={t("المخزن")}>
        {res.data.map((p) => (
          <li key={p.id}>
            <Link href={`/warehouse/${p.id}`} className="card block p-4 transition active:bg-canvas">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold text-brand-700">{p.name}</p>
                  <p className="truncate text-sm font-semibold">{p.partner?.name ?? "—"}</p>
                  {p.backorder_of && <p className="text-xs text-muted">{t("متبقٍ من")} {p.backorder_of.name}</p>}
                </div>
                <PickingStateBadge state={p.state} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge tone={p.kind === "delivery" ? "brand" : "green"}>{t(KIND[p.kind])}</Badge>
                {p.supply_order && <Badge>{p.supply_order.name}</Badge>}
              </div>
              <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-xs text-muted">
                <span><span className="num">{p.move_count}</span> {t("الأصناف")}</span>
                <span>{formatDate(p.state === "done" ? p.date_done : p.scheduled_date)}</span>
              </div>
            </Link>
          </li>
        ))}
        {res.data.length === 0 && <li className="card"><Empty title={t("لا توجد أذونات مطابقة")} hint={t("تُنشأ الأذونات من أمر التوريد بزر «تجهيز التسليم/الاستلام».")} /></li>}
      </ul>
      <div className="card hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-canvas/60"><tr>
              <th className="th">{t("الإذن")}</th><th className="th">{t("النوع")}</th><th className="th">{t("الشريك")}</th><th className="th">{t("أمر التوريد")}</th>
              <th className="th">{t("الأصناف")}</th><th className="th">{t("الموعد")}</th><th className="th">{t("الحالة")}</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {res.data.map((p) => (
                <tr key={p.id} className="hover:bg-canvas/50">
                  <td className="td whitespace-nowrap"><Link href={`/warehouse/${p.id}`} className="font-bold text-brand-700 hover:underline">{p.name}</Link>
                    {p.backorder_of && <div className="text-xs text-muted">{t("متبقٍ من")} {p.backorder_of.name}</div>}</td>
                  <td className="td"><Badge tone={p.kind === "delivery" ? "brand" : "green"}>{t(KIND[p.kind])}</Badge></td>
                  <td className="td">{p.partner?.name ?? "—"}</td>
                  <td className="td">{p.supply_order ? <Link href={`/orders/${p.supply_order.id}`} className="font-semibold hover:underline">{p.supply_order.name}</Link> : <span className="text-muted">{p.origin || "—"}</span>}</td>
                  <td className="td"><span className="num">{p.move_count}</span></td>
                  <td className="td whitespace-nowrap text-muted">{formatDate(p.state === "done" ? p.date_done : p.scheduled_date)}</td>
                  <td className="td"><PickingStateBadge state={p.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {res.data.length === 0 && <Empty title={t("لا توجد أذونات مطابقة")} hint={t("تُنشأ الأذونات من أمر التوريد بزر «تجهيز التسليم/الاستلام».")} />}
      </div>
      {pages > 1 && (
          <nav className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm" aria-label={t("الصفحات")}>
            {page > 1 ? <Link className="btn-secondary" href={href(sp, { page: String(page - 1) })}><ChevronRight className="size-4 ltr:rotate-180" />  {t("السابق")}</Link> : <span />}
            <span className="text-muted">{t("صفحة")} <span className="num">{page}</span>  {t("من")} <span className="num">{pages}</span></span>
            {page < pages ? <Link className="btn-secondary" href={href(sp, { page: String(page + 1) })}>{t("التالي")} <ChevronLeft className="size-4 ltr:rotate-180" /></Link> : <span />}
          </nav>
        )}
    </>
  );
}
