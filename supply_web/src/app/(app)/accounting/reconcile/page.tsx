import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReconcileWizard } from "./wizard";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("التسوية الجماعية") };
}

export default async function ReconcilePage() {
  const t = await getT();
  await requirePermission("accounting.reconcile");
  return (
    <>
      <PageHeader title={t("التسوية الجماعية")} subtitle={t("اختر العميل أو المورد والفترة، حدّد الفواتير التي تريد تسويتها، وسنوزّع الدفعات عليها فقط.")} />
      <ReconcileWizard />
    </>
  );
}
