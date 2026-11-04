import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { odooData } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Badge, ErrorBox, PageHeader, formatDate } from "@/components/ui";
import { KIND, PickingStateBadge } from "@/components/picking-ui";
import type { Picking } from "@/lib/types";
import { PickingWorkspace } from "./workspace";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `إذن ${(await params).id}` };
}

export default async function PickingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("warehouse.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const loaded = await attempt(() => odooData<Picking>("picking_read", { id }, { extUserId: user.odooExtId }));
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    return <><PageHeader title="إذن مخزني" /><ErrorBox message={loaded.error} /></>;
  }
  const p = loaded.data;
  // a new key whenever the server's numbers change, so the counting form starts from what Odoo now holds
  const fingerprint = `${p.id}-${p.state}-${p.moves.map((m) => `${m.id}:${m.quantity}:${m.entries.map((e) => `${e.lot?.id ?? e.lot_name}=${e.quantity}`).join(",")}`).join("|")}`;
  return (
    <>
      <Link href="/warehouse" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronRight className="size-4" /> المخزن</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{p.name} <PickingStateBadge state={p.state} /></span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={p.kind === "delivery" ? "brand" : "green"}>{KIND[p.kind]}</Badge>
            {p.partner && <b className="text-ink">{p.partner.name}</b>}
            {p.supply_order && <span>أمر التوريد <Link className="font-bold text-brand-700 hover:underline" href={`/orders/${p.supply_order.id}`}>{p.supply_order.name}</Link>{p.supply_order.supply_ref && <> · رقم <b className="num text-ink">{p.supply_order.supply_ref}</b></>}</span>}
            <span>{formatDate(p.state === "done" ? p.date_done : p.scheduled_date, true)}</span>
            {p.backorder_of && <span>متبقٍ من <Link className="font-semibold hover:underline" href={`/warehouse/${p.backorder_of.id}`}>{p.backorder_of.name}</Link></span>}
          </span>
        }
      />
      <PickingWorkspace key={fingerprint} picking={p} can={[...user.permissions]} />
    </>
  );
}
