import { requirePermission } from "@/lib/auth";
import { odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import type { RebateAccrual } from "@/lib/types";
import { RebateTable } from "./table";

export const metadata = { title: "الخصومات المؤجلة" };

export default async function RebatesPage({ searchParams }: { searchParams: Promise<{ state?: string; type?: string }> }) {
  const user = await requirePermission("rebates.view");
  const sp = await searchParams;
  const loaded = await attempt(() => odooPage<RebateAccrual>("rebate_accruals", {
      state: sp.state ? [sp.state] : undefined, applies_to: sp.type || undefined, limit: 200,
    }, { extUserId: user.odooExtId }));
  if (!loaded.ok) return <><PageHeader title="الخصومات المؤجلة" /><ErrorBox message={loaded.error} /></>;
  const res = loaded.data;
  {
    return (
      <>
        <PageHeader title="الخصومات المؤجلة" subtitle="ما يستحقه كل عميل أو مورد عن كل فترة، من برامج الخصم المضبوطة في أودو" />
        {res.data.length === 0 && !sp.state && !sp.type ? (
          <div className="card"><Empty title="لا توجد خصومات مستحقة بعد" hint="تُحتسب تلقائياً بعد انتهاء كل فترة من البرامج المضبوطة في أودو (الخصومات ← برامج الخصم المؤجل)." /></div>
        ) : (
          <RebateTable rows={res.data} canManage={user.permissions.has("rebates.manage")} state={sp.state ?? ""} type={sp.type ?? ""} />
        )}
      </>
    );
  }
}
