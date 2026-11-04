"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, Plug } from "lucide-react";
import { resyncUsers, testOdoo } from "@/app/actions/settings";
import { useToast } from "@/components/toast";

export function OdooPanel({ url, hasKey }: { url: string; hasKey: boolean }) {
  const { push } = useToast();
  const [state, setState] = useState<{ ok: boolean; text: string; details?: unknown } | null>(null);
  const [busy, setBusy] = useState("");

  async function test() {
    setBusy("test");
    const r = await testOdoo();
    setBusy("");
    setState({ ok: r.ok, text: r.ok ? (r.message ?? "الاتصال سليم.") : r.error, details: "details" in r ? r.details : undefined });
  }
  async function resync() {
    setBusy("sync");
    const r = await resyncUsers();
    setBusy("");
    push(r.ok ? "ok" : "error", r.ok ? (r.message ?? "تمت المزامنة.") : r.error);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card p-5">
        <h2 className="mb-4 font-extrabold">الإعدادات الحالية</h2>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-xs font-bold text-muted">عنوان أودو (ODOO_URL)</dt><dd className="num font-mono" dir="ltr">{url || "—"}</dd></div>
          <div><dt className="text-xs font-bold text-muted">مفتاح API (ODOO_API_KEY)</dt><dd>{hasKey ? "مضبوط ✓ (لا يُعرض)" : <span className="text-bad">غير مضبوط</span>}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={test} disabled={!!busy}>{busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} اختبار الاتصال</button>
          <button className="btn-secondary" onClick={resync} disabled={!!busy}>{busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} إعادة مزامنة المستخدمين</button>
        </div>
        {state && (
          <div role="status" className={`mt-4 rounded-xl p-4 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            <p className="flex items-center gap-2 font-bold">{state.ok ? <CheckCircle2 className="size-5" /> : <CircleAlert className="size-5" />}{state.text}</p>
            {state.ok && state.details != null && <pre dir="ltr" className="mt-2 overflow-auto text-xs">{JSON.stringify(state.details, null, 2)}</pre>}
          </div>
        )}
      </section>
      <section className="card p-5 text-sm leading-7">
        <h2 className="mb-3 font-extrabold">كيف أربط أودو؟</h2>
        <ol className="list-decimal space-y-2 ps-5">
          <li>ثبّت موديول <b>supply_api</b> في أودو.</li>
          <li>أنشئ مستخدماً داخلياً للتكامل (مجموعة <b>Supply Orders / Manager</b> مع صلاحيات المحاسبة والمخزون).</li>
          <li>من ملفه الشخصي ← <b>Account Security</b> ← <b>New API Key</b>، وانسخ المفتاح.</li>
          <li>اضبط المعامل <span className="num font-mono" dir="ltr">supply_order.service_user_id</span> برقم هذا المستخدم.</li>
          <li>ضع <span className="font-mono" dir="ltr">ODOO_URL</span> و<span className="font-mono" dir="ltr">ODOO_API_KEY</span> في ملف البيئة ثم أعد تشغيل التطبيق.</li>
        </ol>
        <p className="mt-3 text-muted">الصلاحيات تُحدَّد في هذا التطبيق، وكل مستخدم يظهر في أودو باسمه الحقيقي (بواسطة أحمد عبر التطبيق).</p>
      </section>
    </div>
  );
}
