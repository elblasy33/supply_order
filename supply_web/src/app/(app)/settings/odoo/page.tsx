import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { OdooPanel } from "./panel";

export const metadata = { title: "الاتصال بأودو" };

export default async function OdooSettings() {
  await requirePermission("settings.odoo");
  const url = process.env.ODOO_URL ?? "";
  return (
    <>
      <PageHeader title="الاتصال بأودو" subtitle="إعدادات الاتصال تُضبط في ملف البيئة على الخادم (لا تظهر للمتصفح)." />
      <OdooPanel url={url} hasKey={!!process.env.ODOO_API_KEY} />
    </>
  );
}
