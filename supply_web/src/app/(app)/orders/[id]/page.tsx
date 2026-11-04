import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { odooData } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, ErrorBox, PageHeader, StateBadge, TYPE, formatDate } from "@/components/ui";
import type { SupplyOrder } from "@/lib/types";
import { OrderWorkspace } from "./workspace";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  return { title: t(`أمر توريد ${(await params).id}`) };
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const user = await requirePermission("orders.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const loaded = await attempt(() => odooData<SupplyOrder>("order_read", { id }, { extUserId: user.odooExtId }));
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    return <><PageHeader title={t("أمر توريد")} /><ErrorBox message={loaded.error} /></>;
  }
  const order = loaded.data;
  const odooUrl = (process.env.ODOO_PUBLIC_URL || process.env.ODOO_URL || "").replace(/\/+$/, "");
  return (
    <>
      <Link href="/orders" className="tap mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronRight className="size-4 ltr:rotate-180" />  {t("أوامر التوريد")}</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{order.name} <StateBadge state={order.state} /></span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <b className="text-ink">{order.partner.name}</b>
            <Badge>{t(TYPE[order.order_type])}</Badge>
            {order.supply_ref && <span>{t("رقم التوريد")} <b className="num text-ink">{order.supply_ref}</b></span>}
            <span>{formatDate(order.date_order, true)}</span>
          </span>
        }
      />
      <OrderWorkspace order={order} can={[...user.permissions]} odooUrl={odooUrl} />
    </>
  );
}
