import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import clsx from "clsx";
import { requirePermission } from "@/lib/auth";
import { odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, Empty, ErrorBox, Fulfillment, InvoiceBadge, PageHeader, StateBadge, TYPE, formatDate, money } from "@/components/ui";
import type { OrderSummary } from "@/lib/types";

export const metadata = { title: "أوامر التوريد" };
const PAGE = 25;

const STATES = [["", "الكل"], ["draft", "مسودة"], ["confirmed", "مؤكد"], ["closed", "مغلق"], ["cancel", "ملغي"]] as const;
const TYPES = [["", "الكل"], ["sale", "توريد لعميل"], ["purchase", "شراء من مورد"]] as const;
const INVOICES = [["", "الكل"], ["to_invoice", "جاهز للفوترة"], ["invoiced", "مفوتر"], ["nothing", "لا شيء للفوترة"]] as const;

type SP = { q?: string; state?: string; type?: string; invoice?: string; page?: string };

function href(sp: SP, patch: Partial<SP>) {
  const merged = { ...sp, page: undefined, ...patch };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]);
  return `/orders${qs.size ? `?${qs}` : ""}`;
}

function Chips({ label, options, current, sp, field }: { label: string; options: readonly (readonly [string, string])[]; current?: string; sp: SP; field: keyof SP }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-xs font-bold text-muted">{label}</span>
      {options.map(([v, t]) => (
        <Link key={v} href={href(sp, { [field]: v })} aria-current={(current ?? "") === v ? "true" : undefined}
          className={clsx("rounded-full border px-3 py-1 text-xs font-semibold transition",
            (current ?? "") === v ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-surface hover:border-brand-200")}>
          {t}
        </Link>
      ))}
    </div>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("orders.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const loaded = await attempt(() => odooPage<OrderSummary>("order_search", {
      query: sp.q || undefined, state: sp.state ? [sp.state] : undefined, order_type: sp.type || undefined,
      invoice_state: sp.invoice || undefined, offset: (page - 1) * PAGE, limit: PAGE,
    }, { extUserId: user.odooExtId }));
  if (!loaded.ok) return <><PageHeader title="أوامر التوريد" /><ErrorBox message={loaded.error} /></>;
  const res = loaded.data;
  {
    const pages = Math.max(1, Math.ceil(res.total / PAGE));
    return (
      <>
        <PageHeader
          title="أوامر التوريد"
          subtitle={`${res.total} أمر`}
          actions={user.permissions.has("orders.create") && <Link href="/orders/new" className="btn-primary"><Plus className="size-4" /> أمر توريد جديد</Link>}
        />
        <div className="card mb-4 space-y-3 p-4">
          <form action="/orders" className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={sp.q} className="input ps-9" placeholder="ابحث برقم الأمر أو رقم التوريد أو الشريك أو الصنف…" aria-label="بحث" />
            {sp.state && <input type="hidden" name="state" value={sp.state} />}
            {sp.type && <input type="hidden" name="type" value={sp.type} />}
            {sp.invoice && <input type="hidden" name="invoice" value={sp.invoice} />}
          </form>
          <Chips label="الحالة" options={STATES} current={sp.state} sp={sp} field="state" />
          <Chips label="النوع" options={TYPES} current={sp.type} sp={sp} field="type" />
          <Chips label="الفوترة" options={INVOICES} current={sp.invoice} sp={sp} field="invoice" />
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas/60"><tr>
                <th className="th">الأمر</th><th className="th">الشريك</th><th className="th">النوع</th><th className="th">الأصناف</th>
                <th className="th">الحالة</th><th className="th">التنفيذ</th><th className="th">الفوترة</th><th className="th">الإجمالي</th><th className="th">التاريخ</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {res.data.map((o) => (
                  <tr key={o.id} className="hover:bg-canvas/50">
                    <td className="td whitespace-nowrap"><Link href={`/orders/${o.id}`} className="font-bold text-brand-700 hover:underline">{o.name}</Link>
                      {o.supply_ref && <div className="text-xs text-muted">رقم التوريد <span className="num">{o.supply_ref}</span></div>}</td>
                    <td className="td">{o.partner.name}</td>
                    <td className="td"><Badge>{TYPE[o.order_type]}</Badge></td>
                    <td className="td"><span className="num">{o.line_count}</span></td>
                    <td className="td"><StateBadge state={o.state} /></td>
                    <td className="td"><Fulfillment s={o.fulfillment_state} /></td>
                    <td className="td"><InvoiceBadge s={o.invoice_state} /></td>
                    <td className="td whitespace-nowrap font-semibold"><span className="num">{money.format(o.amount_total)}</span> <span className="text-xs text-muted">{o.currency}</span></td>
                    <td className="td whitespace-nowrap text-muted">{formatDate(o.date_order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {res.data.length === 0 && <Empty title="لا توجد أوامر مطابقة" hint="غيّر البحث أو المرشحات." />}
          {pages > 1 && (
            <nav className="flex items-center justify-between border-t border-line px-4 py-3 text-sm" aria-label="الصفحات">
              {page > 1 ? <Link className="btn-secondary" href={href(sp, { page: String(page - 1) })}><ChevronRight className="size-4" /> السابق</Link> : <span />}
              <span className="text-muted">صفحة <span className="num">{page}</span> من <span className="num">{pages}</span></span>
              {page < pages ? <Link className="btn-secondary" href={href(sp, { page: String(page + 1) })}>التالي <ChevronLeft className="size-4" /></Link> : <span />}
            </nav>
          )}
        </div>
      </>
    );
  }
}
