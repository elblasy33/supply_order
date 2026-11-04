import Link from "next/link";
import clsx from "clsx";
import { requirePermission } from "@/lib/auth";
import { odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, Empty, ErrorBox, Num, PageHeader, formatDate, money } from "@/components/ui";
import type { AutoPurchase, ExpiryAlert } from "@/lib/types";

export const metadata = { title: "التنبيهات" };

const EXPIRY_FILTERS = [["", "وصلت لتنبيه الصلاحية"], ["expired", "منتهية"], ["within_7", "خلال 7 أيام"], ["within_30", "خلال 30 يوماً"], ["within_60", "خلال 60 يوماً"]] as const;
const PURCHASE_FILTERS = [["", "الكل"], ["to_confirm", "تنتظر التأكيد"], ["to_receive", "تنتظر الاستلام"], ["late", "متأخرة"]] as const;
const PURCHASE_STATE: Record<string, string> = { draft: "مسودة", sent: "مُرسل", "to approve": "بانتظار الموافقة", purchase: "مؤكد", done: "مقفل", cancel: "ملغي" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string; f?: string }> }) {
  const user = await requirePermission("alerts.view");
  const { tab = "expiry", f = "" } = await searchParams;
  const tabs = [["expiry", "الصلاحية"], ["purchases", "المشتريات التلقائية"]] as const;
  const filters = tab === "purchases" ? PURCHASE_FILTERS : EXPIRY_FILTERS;
  const ext = { extUserId: user.odooExtId };
  const loaded = await attempt(async () =>
    tab === "purchases"
      ? ({ kind: "purchases", res: await odooPage<AutoPurchase>("alerts", { kind: "auto_purchase", filter: f || undefined, limit: 100 }, ext) } as const)
      : ({ kind: "expiry", res: await odooPage<ExpiryAlert>("alerts", { kind: "expiry", filter: f || undefined, limit: 200 }, ext) } as const));
  let body: React.ReactNode;
  if (!loaded.ok) body = <div className="p-5"><ErrorBox message={loaded.error} /></div>;
  else if (loaded.data.kind === "purchases") body = <PurchasesTable rows={loaded.data.res.data} />;
  else body = <ExpiryTable rows={loaded.data.res.data} />;
  return (
    <>
      <PageHeader title="التنبيهات" subtitle="الصلاحية والمشتريات التي أنشأها النظام تلقائياً" />
      <div className="mb-4 flex flex-wrap gap-2 border-b border-line">
        {tabs.map(([v, t]) => (
          <Link key={v} href={`/alerts?tab=${v}`} className={clsx("-mb-px border-b-2 px-4 py-2.5 text-sm font-bold", tab === v ? "border-brand-500 text-brand-700" : "border-transparent text-muted hover:text-ink")}>{t}</Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map(([v, t]) => (
          <Link key={v} href={`/alerts?tab=${tab}${v ? `&f=${v}` : ""}`}
            className={clsx("rounded-full border px-3 py-1 text-xs font-semibold", f === v ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-surface hover:border-brand-200")}>{t}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">{body}</div>
    </>
  );
}

function PurchasesTable({ rows }: { rows: AutoPurchase[] }) {
  if (rows.length === 0) return <Empty title="لا مشتريات تلقائية مطابقة" />;
  return (
    <table className="w-full"><thead className="bg-canvas/60"><tr>
      <th className="th">أمر الشراء</th><th className="th">المورد</th><th className="th">المصدر</th><th className="th">الحالة</th><th className="th">الاستلام المتوقع</th><th className="th">الإجمالي</th><th className="th">أمر التوريد</th>
    </tr></thead><tbody className="divide-y divide-line">
      {rows.map((p) => (
        <tr key={p.id} className="hover:bg-canvas/50">
          <td className="td font-bold">{p.name} {p.is_late && <Badge tone="red">متأخر</Badge>}</td>
          <td className="td">{p.partner.name}</td>
          <td className="td"><Badge>{p.auto_source === "mto" ? "عند الطلب" : "قاعدة إعادة الطلب"}</Badge></td>
          <td className="td">{PURCHASE_STATE[p.state] ?? p.state}</td>
          <td className="td text-muted">{formatDate(p.date_planned)}</td>
          <td className="td font-semibold"><span className="num">{money.format(p.amount_total)}</span> <span className="text-xs text-muted">{p.currency}</span></td>
          <td className="td">{p.supply_order ? <Link className="font-semibold text-brand-700 hover:underline" href={`/orders/${p.supply_order.id}`}>{p.supply_order.name}</Link> : "—"}</td>
        </tr>
      ))}
    </tbody></table>
  );
}

function ExpiryTable({ rows }: { rows: ExpiryAlert[] }) {
  if (rows.length === 0) return <Empty title="لا تشغيلات تنبّه صلاحيتها" hint="كل التشغيلات سليمة ضمن هذا المرشح." />;
  return (
    <table className="w-full"><thead className="bg-canvas/60"><tr>
      <th className="th">التشغيلة</th><th className="th">الصنف</th><th className="th">الكمية</th><th className="th">تاريخ التنبيه</th><th className="th">تاريخ الانتهاء</th><th className="th">المتبقي</th>
    </tr></thead><tbody className="divide-y divide-line">
      {rows.map((l) => (
        <tr key={l.id} className="hover:bg-canvas/50">
          <td className="td font-bold"><span className="num">{l.name}</span></td>
          <td className="td">{l.product.name}</td>
          <td className="td"><Num v={l.qty} /></td>
          <td className="td text-muted">{formatDate(l.alert_date)}</td>
          <td className="td">{formatDate(l.expiration_date)}</td>
          <td className="td">{l.expiry_state === "expired" ? <Badge tone="red">منتهية منذ <span className="num">{Math.abs(l.days_to_expiry)}</span> يوم</Badge>
            : <Badge tone={l.days_to_expiry <= 7 ? "red" : "amber"}>باقي <span className="num">{l.days_to_expiry}</span> يوم</Badge>}</td>
        </tr>
      ))}
    </tbody></table>
  );
}
