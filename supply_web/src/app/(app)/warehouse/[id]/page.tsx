import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { odooData } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, ErrorBox, PageHeader, formatDate } from "@/components/ui";
import { KIND } from "@/components/labels";
import { PickingStateBadge } from "@/components/picking-ui";
import type { Picking } from "@/lib/types";
import { PickingWorkspace } from "./workspace";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  return { title: t(`إذن ${(await params).id}`) };
}

export default async function PickingPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const user = await requirePermission("warehouse.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const loaded = await attempt(() => odooData<Picking>("picking_read", { id }, { extUserId: user.odooExtId }));
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    return <><PageHeader title={t("إذن مخزني")} /><ErrorBox message={loaded.error} /></>;
  }
  const p = loaded.data;
  return (
    <>
      <Link href="/warehouse" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronRight className="size-4 ltr:rotate-180" />  {t("المخزن")}</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{p.name} <PickingStateBadge state={p.state} /></span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={p.kind === "delivery" ? "brand" : "green"}>{t(KIND[p.kind])}</Badge>
            {p.partner && <b className="text-ink">{p.partner.name}</b>}
            {p.supply_order && <span>{t("أمر التوريد")} <Link className="font-bold text-brand-700 hover:underline" href={`/orders/${p.supply_order.id}`}>{p.supply_order.name}</Link>{p.supply_order.supply_ref && <>  {t("· رقم")} <b className="num text-ink">{p.supply_order.supply_ref}</b></>}</span>}
            <span>{formatDate(p.state === "done" ? p.date_done : p.scheduled_date, true)}</span>
            {p.backorder_of && <span>{t("متبقٍ من")} <Link className="font-semibold hover:underline" href={`/warehouse/${p.backorder_of.id}`}>{p.backorder_of.name}</Link></span>}
          </span>
        }
      />
      <PickingWorkspace picking={p} can={[...user.permissions]} />
    </>
  );
}
