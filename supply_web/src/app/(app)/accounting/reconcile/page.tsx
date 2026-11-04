import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReconcileWizard } from "./wizard";

export const metadata = { title: "التسوية الجماعية" };

export default async function ReconcilePage() {
  await requirePermission("accounting.reconcile");
  return (
    <>
      <PageHeader title="التسوية الجماعية" subtitle="اختر العميل أو المورد والفترة، حدّد الفواتير التي تريد تسويتها، وسنوزّع الدفعات عليها فقط." />
      <ReconcileWizard />
    </>
  );
}
