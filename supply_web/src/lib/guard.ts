import "server-only";
import { assertPermission, ensureOdooUser, getCurrentUser, PermissionError, type CurrentUser } from "./auth";
import { audit } from "./db";
import { OdooError } from "./odoo";
import type { Permission } from "./permissions";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; field?: string };

export type Actor = CurrentUser & { extId: number };

/**
 * Runs a server action for the signed-in user: checks the permission, makes sure Odoo knows the
 * person, and turns every failure into a message the screen can show (never a stack trace).
 */
export async function guard<T>(
  perm: Permission | Permission[] | null,
  fn: (actor: Actor) => Promise<T>,
  audited?: string,
): Promise<ActionResult<T>> {
  try {
    let user: CurrentUser | null;
    if (perm === null) {
      user = await getCurrentUser();
      if (!user) throw new PermissionError("انتهت الجلسة، سجّل الدخول من جديد.");
    } else {
      const needed = Array.isArray(perm) ? perm : [perm];
      user = await assertPermission(needed[0]);
      for (const p of needed.slice(1)) if (!user.permissions.has(p)) throw new PermissionError("ليست لديك صلاحية لهذا الإجراء.");
    }
    const extId = await ensureOdooUser(user);
    const data = await fn({ ...user, extId });
    if (audited) audit(user.id, audited);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, code: "forbidden", error: e.message };
    if (e instanceof OdooError) return { ok: false, code: e.code, error: e.message, field: e.field };
    console.error("[action]", e);
    return { ok: false, code: "server_error", error: "حدث خطأ غير متوقع. حاول مجدداً." };
  }
}
