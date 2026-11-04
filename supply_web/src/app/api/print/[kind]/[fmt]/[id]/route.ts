import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { OdooError, odooLang, odooPrint } from "@/lib/odoo";
import { getT } from "@/lib/i18n/server";

const KINDS = new Set(["quotation", "commercial_bill", "invoice"]);
const FORMATS = new Set(["html", "pdf", "xlsx"]);

/** Streams an Odoo document to the browser; the Odoo key never leaves the server. */
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; fmt: string; id: string }> }) {
  const { kind, fmt, id } = await ctx.params;
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new NextResponse(t("غير مسجّل"), { status: 401 });
  if (!user.permissions.has("orders.print")) return new NextResponse(t("ليست لديك صلاحية الطباعة"), { status: 403 });
  const rid = Number(id);
  if (!KINDS.has(kind) || !FORMATS.has(fmt) || !Number.isInteger(rid) || rid <= 0) {
    return new NextResponse(t("طلب غير صالح"), { status: 400 });
  }
  try {
    const upstream = await odooPrint(kind, fmt, rid, await odooLang());
    if (upstream.status === 404) return new NextResponse(t("المستند غير موجود"), { status: 404 });
    const headers = new Headers();
    for (const h of ["content-type", "content-disposition"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set("cache-control", "private, no-store");
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    const message = e instanceof OdooError ? e.message : t("تعذّر تحميل المستند.");
    return new NextResponse(message, { status: 502 });
  }
}
