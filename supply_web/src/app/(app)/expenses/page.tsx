import { requirePermission } from "@/lib/auth";
import { odooData, odooPage } from "@/lib/odoo";
import { attempt } from "@/lib/safe";
import { ErrorBox, PageHeader } from "@/components/ui";
import type { CashJournal, ExpenseRow } from "@/lib/types";
import { ExpenseForm } from "./form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("المصروفات") };
}

export default async function ExpensesPage() {
  const t = await getT();
  const user = await requirePermission("expenses.create");
  const loaded = await attempt(async () => {
    const opt = { extUserId: user.odooExtId };
    const [journals, rows] = await Promise.all([
      odooData<CashJournal[]>("cash_journals", {}, opt),
      odooPage<ExpenseRow>("expense_search", { limit: 100 }, opt),
    ]);
    return { journals, rows: rows.data };
  });
  const head = <PageHeader title={t("المصروفات")} subtitle={t("مصروف على الشركة من خزينة محددة، يُسجَّل في وحدة النفقات بأودو ولا يُنسب لأي موظف.")} />;
  if (!loaded.ok) return <>{head}<ErrorBox message={loaded.error} /></>;
  return <>{head}<ExpenseForm journals={loaded.data.journals} rows={loaded.data.rows} /></>;
}
