import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { odooData } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { ErrorBox, PageHeader } from "@/components/ui";
import type { DashboardData } from "@/lib/types";
import { DashboardView } from "./dashboard-view";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("لوحة التحكم") };
}

const PERIODS = [7, 30, 90, 365];
const TZ = process.env.APP_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const t = await getT();
  const user = await requirePermission("orders.view");
  const asked = Number((await searchParams).days);
  const days = PERIODS.includes(asked) ? asked : 30;
  // each chart family is asked for only when this user may see it
  const sections = ["orders", ...(user.permissions.has("warehouse.view") ? ["warehouse"] : []), ...(user.permissions.has("alerts.view") ? ["expiry"] : []), ...(user.permissions.has("rebates.view") ? ["rebates"] : [])];
  const loaded = await attempt(() => odooData<DashboardData>("dashboard", { days, sections }, { extUserId: user.odooExtId, tz: TZ }));
  if (!loaded.ok) return <><PageHeader title={t("لوحة التحكم")} /><ErrorBox message={loaded.error} /></>;
  return (
    <>
      <PageHeader
        title={t("أهلاً {0}", { 0: user.name })}
        subtitle={t("نظرة سريعة على التوريد اليوم")}
        actions={user.permissions.has("orders.create") && <Link href="/orders/new" className="btn-primary"><Plus className="size-4" /> {t("أمر توريد جديد")}</Link>}
      />
      <DashboardView data={loaded.data} days={days} />
    </>
  );
}
