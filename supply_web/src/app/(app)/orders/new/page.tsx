import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NewOrderForm } from "./form";

export const metadata = { title: "أمر توريد جديد" };

export default async function NewOrderPage() {
  await requirePermission("orders.create");
  return (
    <>
      <PageHeader title="أمر توريد جديد" subtitle="ابدأ من هنا: عرض السعر والتسليم والفاتورة تُنشأ من الأمر في أي وقت." />
      <NewOrderForm />
    </>
  );
}
