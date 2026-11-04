"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, CircleDashed, Loader2, MinusCircle, Plug, RefreshCw, Save } from "lucide-react";
import { resyncUsers, saveConnectionAction, testConnection, type ConnectionResult } from "@/app/actions/settings";
import { useToast } from "@/components/toast";
import { Badge, Field } from "@/components/ui";
import type { CheckStep } from "@/lib/odoo-check";

type Initial = { url: string; database: string; hasKey: boolean; source: "saved" | "env" | "none" };

const ICON: Record<CheckStep["status"], React.ReactNode> = {
  ok: <CheckCircle2 className="size-5 shrink-0 text-ok" />,
  warn: <CircleAlert className="size-5 shrink-0 text-warn" />,
  fail: <CircleAlert className="size-5 shrink-0 text-bad" />,
  skip: <MinusCircle className="size-5 shrink-0 text-muted/60" />,
};

export function OdooPanel({ initial }: { initial: Initial }) {
  const router = useRouter();
  const { push } = useToast();
  const [url, setUrl] = useState(initial.url);
  const [database, setDatabase] = useState(initial.database);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"" | "test" | "save" | "sync">("");
  const [result, setResult] = useState<ConnectionResult | null>(null);

  const input = { url, database, apiKey };
  const canTry = url.trim() !== "" && (apiKey.trim() !== "" || initial.hasKey);

  async function test() {
    setBusy("test");
    setResult(await testConnection(input));
    setBusy("");
  }
  async function save() {
    setBusy("save");
    const res = await saveConnectionAction(input);
    setResult(res);
    setBusy("");
    if (res.saved) {
      push("ok", "تم حفظ الاتصال. التطبيق يعمل الآن مع هذا الخادم.");
      setApiKey("");
      router.refresh();
    } else if (res.error) push("error", res.error);
  }
  async function resync() {
    setBusy("sync");
    const r = await resyncUsers();
    setBusy("");
    push(r.ok ? "ok" : "error", r.ok ? (r.message ?? "تمت المزامنة.") : r.error);
  }

  const info = result?.check?.info;
  return (
    <div className="grid gap-5 xl:grid-cols-[26rem_1fr]">
      <section className="card h-fit p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-extrabold">بيانات الاتصال</h2>
          <Badge tone={initial.source === "none" ? "amber" : "green"}>
            {initial.source === "saved" ? "محفوظ في التطبيق" : initial.source === "env" ? "من ملف البيئة" : "غير مضبوط"}
          </Badge>
        </div>
        <div className="space-y-4">
          <Field label="عنوان خادم أودو">
            <input dir="ltr" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://odoo.example.com" autoComplete="off" />
          </Field>
          <Field label="اسم قاعدة البيانات (اختياري، مطلوب إن كان للخادم أكثر من قاعدة)">
            <input dir="ltr" className="input" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="مثال: supply_prod" autoComplete="off" />
          </Field>
          <Field label="مفتاح API لمستخدم التكامل">
            <input dir="ltr" type="password" className="input font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password"
              placeholder={initial.hasKey ? "•••••••• محفوظ — اتركه فارغاً للإبقاء عليه" : "الصق المفتاح هنا"} />
          </Field>
          <p className="text-xs leading-6 text-muted">يُحفظ المفتاح مشفّراً على خادم التطبيق ولا يعود للمتصفح أبداً.</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={test} disabled={!canTry || !!busy}>
            {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} فحص الاتصال
          </button>
          <button className="btn-primary" onClick={save} disabled={!canTry || !!busy}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} فحص وحفظ
          </button>
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <button className="btn-ghost -ms-2" onClick={resync} disabled={!!busy || initial.source === "none"}>
            {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} إعادة مزامنة المستخدمين مع أودو
          </button>
        </div>
      </section>

      <section className="space-y-5">
        <div className="card p-5">
          <h2 className="mb-3 font-extrabold">نتيجة الفحص</h2>
          {!result ? (
            <p className="flex items-center gap-2 text-sm text-muted"><CircleDashed className="size-5" /> لم يُجرَ فحص بعد. اضغط «فحص الاتصال».</p>
          ) : result.error && !result.check ? (
            <p role="alert" className="text-sm text-bad">{result.error}</p>
          ) : (
            <>
              <ol className="space-y-3" aria-live="polite">
                {result.check!.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-3">
                    {ICON[s.status]}
                    <div className="min-w-0">
                      <p className={clsx("text-sm font-bold", s.status === "skip" && "text-muted")}>{s.label}</p>
                      <p className={clsx("text-sm leading-6", s.status === "fail" ? "text-bad" : s.status === "warn" ? "text-warn" : "text-muted")}>{s.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p role="status" className={clsx("mt-4 rounded-xl px-4 py-3 text-sm font-bold", result.check!.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
                {result.saved ? "تم الحفظ — الاتصال سليم." : result.check!.ok ? "الاتصال سليم." : "الاتصال غير جاهز بعد."}
              </p>
            </>
          )}
        </div>

        {info && (
          <div className="card p-5">
            <h2 className="mb-3 font-extrabold">الموديولات على هذا الخادم</h2>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(info.modules).map(([name, m]) => (
                <li key={name} className="flex items-center justify-between border-b border-line/60 py-1.5 text-sm">
                  <span dir="ltr" className="font-mono text-xs">{name}</span>
                  {m.state === "installed" ? <Badge tone="green">مثبّت <span className="num">{m.version.split(".").slice(2).join(".") || ""}</span></Badge> : <Badge tone="red">{m.state === "missing" ? "غير موجود" : m.state}</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card p-5 text-sm leading-7">
          <h2 className="mb-2 font-extrabold">تجهيز أي خادم أودو 20</h2>
          <ol className="list-decimal space-y-1.5 ps-5">
            <li>ثبّت موديولات المشروع، والأساسي منها <b dir="ltr">supply_order</b> و<b dir="ltr">supply_api</b>.</li>
            <li>أنشئ مستخدماً داخلياً للتكامل (مجموعة <b>Supply Orders / Manager</b> مع صلاحيات المحاسبة والمخزون).</li>
            <li>من ملفه الشخصي ← <b>Account Security</b> ← <b>New API Key</b> وانسخ المفتاح.</li>
            <li>في أودو: الإعدادات ← تقني ← معاملات النظام، اضبط <b dir="ltr">supply_order.service_user_id</b> برقم هذا المستخدم (يخبرك الفحص برقمه).</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
