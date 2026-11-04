import { requirePermission } from "@/lib/auth";
import { db, listRoles, type UserRow } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { UsersManager } from "./manager";

export const metadata = { title: "المستخدمون" };

export default async function UsersPage() {
  const me = await requirePermission("settings.users");
  const users = (db().prepare("SELECT id, username, name, role_id, active, odoo_ext_id FROM users ORDER BY id").all() as Pick<UserRow, "id" | "username" | "name" | "role_id" | "active" | "odoo_ext_id">[])
    .map((u) => ({ id: u.id, username: u.username, name: u.name, roleId: u.role_id, active: !!u.active, synced: !!u.odoo_ext_id }));
  return (
    <>
      <PageHeader title="المستخدمون" subtitle="حسابات التطبيق. هذه الحسابات موجودة هنا فقط؛ أودو يعرف الاسم عند أول إجراء." />
      <UsersManager users={users} roles={listRoles().map((r) => ({ id: r.id, name: r.name }))} meId={me.id} />
    </>
  );
}
