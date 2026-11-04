import { requirePermission } from "@/lib/auth";
import { db, listRoles } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { RolesManager } from "./manager";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("الأدوار والصلاحيات") };
}

export default async function RolesPage() {
  const t = await getT();
  await requirePermission("settings.roles");
  const counts = db().prepare("SELECT role_id, COUNT(*) AS n FROM users GROUP BY role_id").all() as { role_id: number; n: number }[];
  const roles = listRoles().map((r) => ({ ...r, users: counts.find((c) => c.role_id === r.id)?.n ?? 0 }));
  return (
    <>
      <PageHeader title={t("الأدوار والصلاحيات")} subtitle={t("الصلاحيات تُحدَّد هنا فقط. التعديل يسري فوراً على المستخدمين المسجّلين.")} />
      <RolesManager roles={roles} />
    </>
  );
}
