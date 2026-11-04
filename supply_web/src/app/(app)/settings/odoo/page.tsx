import { requirePermission } from "@/lib/auth";
import { getConnection } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { OdooPanel } from "./panel";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("الاتصال بأودو") };
}
export const dynamic = "force-dynamic";

export default async function OdooSettings() {
  const t = await getT();
  await requirePermission("settings.odoo");
  const c = getConnection();
  return (
    <>
      <PageHeader title={t("الاتصال بأودو")} subtitle={t("اربط التطبيق بأي خادم أودو 20 مثبّت عليه موديولات المشروع. يُفحص الاتصال قبل الحفظ.")} />
      <OdooPanel initial={{ url: c.url, database: c.database, hasKey: !!c.apiKey, source: c.source }} />
    </>
  );
}
