import { requirePermission } from "@/lib/auth";
import { odooData, odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { ErrorBox, PageHeader } from "@/components/ui";
import type { CashJournal, CashMove } from "@/lib/types";
import { CashPanel } from "./panel";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("الخزائن والنقدية") };
}

export default async function CashPage({ searchParams }: { searchParams: Promise<{ kind?: string; journal?: string }> }) {
  const t = await getT();
  const user = await requirePermission("cash.view");
  const sp = await searchParams;
  const loaded = await attempt(async () => {
    const opt = { extUserId: user.odooExtId };
    const [journals, moves] = await Promise.all([
      odooData<CashJournal[]>("cash_journals", {}, opt),
      odooPage<CashMove>("cash_search", { kind: sp.kind || undefined, journal_id: sp.journal ? Number(sp.journal) : undefined, limit: 100 }, opt),
    ]);
    return { journals, moves };
  });
  const head = <PageHeader title={t("الخزائن والنقدية")} subtitle={t("قبض وصرف نقدية دون تسوية بالفواتير، وتحويل الأموال بين الخزائن.")} />;
  if (!loaded.ok) return <>{head}<ErrorBox message={loaded.error} /></>;
  const p = user.permissions;
  return (
    <>
      {head}
      <CashPanel journals={loaded.data.journals} moves={loaded.data.moves.data} kind={sp.kind ?? ""} journal={sp.journal ?? ""}
        can={{ receive: p.has("cash.receive"), pay: p.has("cash.pay"), transfer: p.has("cash.transfer") }} />
    </>
  );
}
