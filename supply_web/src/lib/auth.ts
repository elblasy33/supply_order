import "server-only";
import { redirect } from "next/navigation";
import { db, type RoleRow, type UserRow } from "./db";
import { readSession } from "./session";
import { odooData } from "./odoo";
import { ALL_PERMISSIONS, type Permission } from "./permissions";

export type CurrentUser = {
  id: number;
  username: string;
  name: string;
  roleId: number;
  roleName: string;
  permissions: Set<Permission>;
  odooExtId: number | null;
};

export function hasUsers(): boolean {
  return (db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n > 0;
}

export function loadUser(id: number): CurrentUser | null {
  const u = db().prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(id) as UserRow | undefined;
  if (!u) return null;
  const role = db().prepare("SELECT id, name, permissions FROM roles WHERE id = ?").get(u.role_id) as
    | { id: number; name: string; permissions: string }
    | undefined;
  const perms = new Set<Permission>(
    ((role ? (JSON.parse(role.permissions) as string[]) : []) as Permission[]).filter((p) => ALL_PERMISSIONS.includes(p)),
  );
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    roleId: u.role_id,
    roleName: role?.name ?? "",
    permissions: perms,
    odooExtId: u.odoo_ext_id,
  };
}

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const id = await readSession();
  return id ? loadUser(id) : null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Page guard: signed in and allowed, otherwise sent away. */
export async function requirePermission(perm: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.permissions.has(perm)) redirect("/forbidden");
  return user;
}

export class PermissionError extends Error {}

/** Server-action guard: throws instead of redirecting. */
export async function assertPermission(perm: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new PermissionError("انتهت الجلسة، سجّل الدخول من جديد.");
  if (!user.permissions.has(perm)) throw new PermissionError("ليست لديك صلاحية لهذا الإجراء.");
  return user;
}

/**
 * Odoo records the real person behind the integration account. Every app user is mirrored as an
 * `external.user` (role "manager": the permissions are decided here, not in Odoo).
 */
export async function ensureOdooUser(user: { id: number; username: string; name: string; odooExtId: number | null }) {
  if (user.odooExtId) return user.odooExtId;
  const synced = await odooData<{ id: number }>("ext_user_sync", {
    login: user.username,
    name: user.name,
    role: "manager",
    external_id: `web:${user.id}`,
    active: true,
  });
  db().prepare("UPDATE users SET odoo_ext_id = ? WHERE id = ?").run(synced.id, user.id);
  return synced.id;
}

export function roleOf(id: number): RoleRow | null {
  const r = db().prepare("SELECT id, name, permissions FROM roles WHERE id = ?").get(id) as
    | { id: number; name: string; permissions: string }
    | undefined;
  return r ? { ...r, permissions: JSON.parse(r.permissions) } : null;
}
