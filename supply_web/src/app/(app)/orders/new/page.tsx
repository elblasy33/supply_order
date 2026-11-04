import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NewOrderForm } from "./form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("أمر توريد جديد") };
}

export default async function NewOrderPage() {
  const t = await getT();
  await requirePermission("orders.create");
  return (
    <>
      <PageHeader title={t("أمر توريد جديد")} subtitle={t("ابدأ من هنا: عرض السعر والتسليم والفاتورة تُنشأ من الأمر في أي وقت.")} />
      <NewOrderForm />
    </>
  );
}
