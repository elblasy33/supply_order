"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, PermissionError } from "@/lib/auth";
import { audit, db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { OdooError, odooData } from "@/lib/odoo";
import { diagnose, normalizeUrl, type CheckResult } from "@/lib/odoo-check";
import { getConnection, saveConnection } from "@/lib/settings";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

async function wrap(perm: "settings.users" | "settings.roles" | "settings.odoo", fn: (userId: number) => Promise<Result> | Result): Promise<Result> {
  try {
    const user = await assertPermission(perm);
    return await fn(user.id);
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, error: e.message };
    if (e instanceof OdooError) return { ok: false, error: e.message };
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return { ok: false, error: "الاسم مستخدم من قبل." };
    console.error("[settings]", e);
    return { ok: false, error: "حدث خطأ غير متوقع." };
  }
}

/** Someone must always be able to manage users and roles. */
function adminsLeft(): number {
  const rows = db().prepare(
    "SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1",
  ).all() as { permissions: string }[];
  return rows.filter((r) => {
    const p = JSON.parse(r.permissions) as string[];
    return p.includes("settings.users") && p.includes("settings.roles");
  }).length;
}

/** Runs the changes in one transaction and undoes them if nobody could manage users/roles afterwards. */
function guarded(fn: () => Result): Result {
  db().exec("BEGIN");
  try {
    const res = fn();
    if (res.ok && adminsLeft() === 0) {
      db().exec("ROLLBACK");
      return { ok: false, error: "يجب أن يبقى مستخدم نشط واحد على الأقل بصلاحية إدارة المستخدمين والأدوار. لم يُحفظ التعديل." };
    }
    db().exec(res.ok ? "COMMIT" : "ROLLBACK");
    return res;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}

const username = z.string().trim().min(3, "اسم المستخدم 3 أحرف على الأقل.").regex(/^[\w.@-]+$/, "اسم المستخدم: حروف إنجليزية وأرقام ونقطة وشرطة فقط.");

export async function saveUser(input: { id?: number; name: string; username: string; password?: string; roleId: number; active: boolean }): Promise<Result> {
  return wrap("settings.users", async (me) => {
    const name = z.string().trim().min(2, "اكتب الاسم.").safeParse(input.name);
    const login = username.safeParse(input.username);
    if (!name.success) return { ok: false, error: name.error.issues[0].message };
    if (!login.success) return { ok: false, error: login.error.issues[0].message };
    if (!db().prepare("SELECT 1 FROM roles WHERE id = ?").get(input.roleId)) return { ok: false, error: "الدور غير موجود." };
    const hash = input.password ? await hashPassword(input.password) : null;
    if (input.id === undefined) {
      if (!hash || input.password!.length < 8) return { ok: false, error: "كلمة المرور 8 أحرف على الأقل." };
      const info = db().prepare("INSERT INTO users (username, name, password_hash, role_id, active) VALUES (?, ?, ?, ?, ?)")
        .run(login.data, name.data, hash, input.roleId, input.active ? 1 : 0);
      audit(me, "user.create", { id: Number(info.lastInsertRowid), username: login.data });
    } else {
      if (input.id === me && !input.active) return { ok: false, error: "لا يمكنك تعطيل حسابك." };
      if (input.password && input.password.length < 8) return { ok: false, error: "كلمة المرور 8 أحرف على الأقل." };
      const id = input.id;
      const res = guarded(() => {
        db().prepare("UPDATE users SET username = ?, name = ?, role_id = ?, active = ?, odoo_ext_id = CASE WHEN username <> ? OR name <> ? THEN NULL ELSE odoo_ext_id END WHERE id = ?")
          .run(login.data, name.data, input.roleId, input.active ? 1 : 0, login.data, name.data, id);
        if (hash) db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
        return { ok: true };
      });
      if (!res.ok) return res;
      audit(me, "user.update", { id });
    }
    revalidatePath("/settings/users");
    return { ok: true };
  });
}

export async function saveRole(input: { id?: number; name: string; permissions: string[] }): Promise<Result> {
  return wrap("settings.roles", async (me) => {
    const name = z.string().trim().min(2, "اكتب اسم الدور.").safeParse(input.name);
    if (!name.success) return { ok: false, error: name.error.issues[0].message };
    const perms = input.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
    if (input.id === undefined) {
      db().prepare("INSERT INTO roles (name, permissions) VALUES (?, ?)").run(name.data, JSON.stringify(perms));
    } else {
      const id = input.id;
      const res = guarded(() => {
        db().prepare("UPDATE roles SET name = ?, permissions = ? WHERE id = ?").run(name.data, JSON.stringify(perms), id);
        return { ok: true };
      });
      if (!res.ok) return res;
    }
    audit(me, "role.save", { id: input.id, name: name.data });
    revalidatePath("/settings/roles");
    return { ok: true };
  });
}

export async function deleteRole(id: number): Promise<Result> {
  return wrap("settings.roles", (me) => {
    const used = db().prepare("SELECT COUNT(*) AS n FROM users WHERE role_id = ?").get(id) as { n: number };
    if (used.n > 0) return { ok: false, error: "لا يمكن حذف دور يستخدمه مستخدمون. انقلهم لدور آخر أولاً." };
    db().prepare("DELETE FROM roles WHERE id = ?").run(id);
    audit(me, "role.delete", { id });
    revalidatePath("/settings/roles");
    return { ok: true };
  });
}

export type ConnectionInput = { url: string; database: string; apiKey: string };
export type ConnectionResult = { ok: boolean; saved?: boolean; error?: string; check?: CheckResult };

/** Fills in the saved key when the form left it empty ("keep the current key"). */
function withSavedKey(input: ConnectionInput): ConnectionInput {
  return { ...input, apiKey: input.apiKey.trim() || getConnection().apiKey };
}

export async function testConnection(input: ConnectionInput): Promise<ConnectionResult> {
  try {
    await assertPermission("settings.odoo");
    const check = await diagnose(withSavedKey(input));
    return { ok: check.ok, check };
  } catch (e) {
    return { ok: false, error: e instanceof PermissionError ? e.message : "حدث خطأ غير متوقع أثناء الفحص." };
  }
}

/** Saves only a connection that passes every check, so the app is never pointed at something unusable. */
export async function saveConnectionAction(input: ConnectionInput): Promise<ConnectionResult> {
  try {
    const user = await assertPermission("settings.odoo");
    const full = withSavedKey(input);
    const check = await diagnose(full);
    if (!check.ok) return { ok: false, check, error: "لم يُحفظ الاتصال: أصلح الخطوات الفاشلة ثم أعد المحاولة." };
    saveConnection({ url: normalizeUrl(full.url)!, database: full.database.trim(), apiKey: full.apiKey });
    audit(user.id, "odoo.connection.save", { url: full.url, database: full.database });
    revalidatePath("/", "layout");
    return { ok: true, saved: true, check };
  } catch (e) {
    return { ok: false, error: e instanceof PermissionError ? e.message : "حدث خطأ غير متوقع أثناء الحفظ." };
  }
}

/** Re-sends every active app user to Odoo (e.g. after Odoo was restored from a backup). */
export async function resyncUsers(): Promise<Result> {
  return wrap("settings.odoo", async () => {
    const users = db().prepare("SELECT id, username, name FROM users WHERE active = 1").all() as { id: number; username: string; name: string }[];
    for (const u of users) {
      const r = await odooData<{ id: number }>("ext_user_sync", { login: u.username, name: u.name, role: "manager", external_id: `web:${u.id}`, active: true });
      db().prepare("UPDATE users SET odoo_ext_id = ? WHERE id = ?").run(r.id, u.id);
    }
    return { ok: true, message: `تمت مزامنة ${users.length} مستخدم.` };
  });
}
