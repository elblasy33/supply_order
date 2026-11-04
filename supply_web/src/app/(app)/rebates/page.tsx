import { requirePermission } from "@/lib/auth";
import { odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import type { RebateAccrual } from "@/lib/types";
import { RebateTable } from "./table";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("الخصومات المؤجلة") };
}

export default async function RebatesPage({ searchParams }: { searchParams: Promise<{ state?: string; type?: string }> }) {
  const t = await getT();
  const user = await requirePermission("rebates.view");
  const sp = await searchParams;
  const loaded = await attempt(() => odooPage<RebateAccrual>("rebate_accruals", {
      state: sp.state ? [sp.state] : undefined, applies_to: sp.type || undefined, limit: 200,
    }, { extUserId: user.odooExtId }));
  if (!loaded.ok) return <><PageHeader title={t("الخصومات المؤجلة")} /><ErrorBox message={loaded.error} /></>;
  const res = loaded.data;
  {
    return (
      <>
        <PageHeader title={t("الخصومات المؤجلة")} subtitle={t("ما يستحقه كل عميل أو مورد عن كل فترة، من برامج الخصم المضبوطة في أودو")} />
        {res.data.length === 0 && !sp.state && !sp.type ? (
          <div className="card"><Empty title={t("لا توجد خصومات مستحقة بعد")} hint={t("تُحتسب تلقائياً بعد انتهاء كل فترة من البرامج المضبوطة في أودو (الخصومات ← برامج الخصم المؤجل).")} /></div>
        ) : (
          <RebateTable rows={res.data} canManage={user.permissions.has("rebates.manage")} state={sp.state ?? ""} type={sp.type ?? ""} />
        )}
      </>
    );
  }
}
