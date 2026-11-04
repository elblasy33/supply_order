import Link from "next/link";
import { AlertTriangle, ClipboardCheck, FileText, PackageCheck, Plus, Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, ErrorBox, Fulfillment, InvoiceBadge, Num, PageHeader, StateBadge, TYPE, formatDate, money } from "@/components/ui";
import type { AutoPurchase, ExpiryAlert, OrderSummary } from "@/lib/types";

export const metadata = { title: "لوحة التحكم" };

export default async function Dashboard() {
  const user = await requirePermission("orders.view");
  const ext = { extUserId: user.odooExtId };
  const canAlerts = user.permissions.has("alerts.view");
  const loaded = await attempt(() => Promise.all([
      odooPage<OrderSummary>("order_search", { limit: 8 }, ext),
      odooPage<OrderSummary>("order_search", { state: ["draft"], limit: 1 }, ext),
      odooPage<OrderSummary>("order_search", { state: ["confirmed"], limit: 1 }, ext),
      odooPage<OrderSummary>("order_search", { state: ["confirmed"], invoice_state: "to_invoice", limit: 1 }, ext),
      canAlerts ? odooPage<ExpiryAlert>("alerts", { kind: "expiry", limit: 1 }, ext) : null,
      canAlerts ? odooPage<AutoPurchase>("alerts", { kind: "auto_purchase", filter: "to_confirm", limit: 1 }, ext) : null,
  ]));
  if (!loaded.ok) return <><PageHeader title="لوحة التحكم" /><ErrorBox message={loaded.error} /></>;
  const [recent, drafts, open, toInvoice, expiry, autos] = loaded.data;
  {
    const cards = [
      { href: "/orders?state=draft", label: "مسودات تنتظر التأكيد", value: drafts.total, icon: <FileText className="size-5" />, tone: "text-slate-600 bg-slate-100" },
      { href: "/orders?state=confirmed", label: "أوامر قيد التنفيذ", value: open.total, icon: <Truck className="size-5" />, tone: "text-brand-700 bg-brand-50" },
      { href: "/orders?state=confirmed&invoice=to_invoice", label: "جاهزة للفوترة", value: toInvoice.total, icon: <ClipboardCheck className="size-5" />, tone: "text-amber-700 bg-amber-50" },
      ...(expiry ? [{ href: "/alerts", label: "تشغيلات تنبّه صلاحيتها", value: expiry.total, icon: <AlertTriangle className="size-5" />, tone: "text-red-700 bg-red-50" }] : []),
      ...(autos ? [{ href: "/alerts?tab=purchases", label: "مشتريات تلقائية للتأكيد", value: autos.total, icon: <PackageCheck className="size-5" />, tone: "text-green-700 bg-green-50" }] : []),
    ];
    return (
      <>
        <PageHeader
          title={`أهلاً ${user.name}`}
          subtitle="نظرة سريعة على التوريد اليوم"
          actions={user.permissions.has("orders.create") && <Link href="/orders/new" className="btn-primary"><Plus className="size-4" /> أمر توريد جديد</Link>}
        />
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((c) => (
            <Link key={c.href} href={c.href} className="card group p-4 transition hover:border-brand-200 hover:shadow-md">
              <div className={`mb-3 grid size-10 place-items-center rounded-xl ${c.tone}`}>{c.icon}</div>
              <p className="text-3xl font-extrabold"><Num v={c.value} /></p>
              <p className="mt-1 text-sm text-muted group-hover:text-ink">{c.label}</p>
            </Link>
          ))}
        </div>
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-extrabold">آخر الأوامر</h2>
            <Link href="/orders" className="text-sm font-semibold text-brand-600 hover:underline">عرض الكل</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas/60"><tr>
                <th className="th">الأمر</th><th className="th">الشريك</th><th className="th">النوع</th><th className="th">الحالة</th>
                <th className="th">التنفيذ</th><th className="th">الفوترة</th><th className="th">الإجمالي</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {recent.data.map((o) => (
                  <tr key={o.id} className="hover:bg-canvas/50">
                    <td className="td"><Link href={`/orders/${o.id}`} className="font-bold text-brand-700 hover:underline">{o.name}</Link>
                      {o.supply_ref && <span className="ms-2 text-xs text-muted">#{o.supply_ref}</span>}</td>
                    <td className="td">{o.partner.name}</td>
                    <td className="td"><Badge>{TYPE[o.order_type]}</Badge></td>
                    <td className="td"><StateBadge state={o.state} /></td>
                    <td className="td"><Fulfillment s={o.fulfillment_state} /></td>
                    <td className="td"><InvoiceBadge s={o.invoice_state} /></td>
                    <td className="td font-semibold"><span className="num">{money.format(o.amount_total)}</span> <span className="text-xs text-muted">{o.currency}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recent.data.length === 0 && <p className="px-6 py-12 text-center text-muted">لا توجد أوامر بعد. أنشئ أول أمر توريد.</p>}
          </div>
        </section>
        <p className="mt-4 text-xs text-muted">آخر تحديث {formatDate(new Date().toISOString(), true)}</p>
      </>
    );
  }
}
