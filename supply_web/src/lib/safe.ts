import "server-only";
import { OdooError } from "./odoo";

/** Server pages load Odoo data through this so a failure becomes a message on screen, not a crash. */
export async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof OdooError) return { ok: false, error: e.message, code: e.code };
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect()/notFound() must pass through
    console.error("[page]", e);
    return { ok: false, error: "حدث خطأ غير متوقع." };
  }
}
