import { requirePermission } from "@/lib/auth";
import { getConnection } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { OdooPanel } from "./panel";

export const metadata = { title: "الاتصال بأودو" };
export const dynamic = "force-dynamic";

export default async function OdooSettings() {
  await requirePermission("settings.odoo");
  const c = getConnection();
  return (
    <>
      <PageHeader title="الاتصال بأودو" subtitle="اربط التطبيق بأي خادم أودو 20 مثبّت عليه موديولات المشروع. يُفحص الاتصال قبل الحفظ." />
      <OdooPanel initial={{ url: c.url, database: c.database, hasKey: !!c.apiKey, source: c.source }} />
    </>
  );
}
