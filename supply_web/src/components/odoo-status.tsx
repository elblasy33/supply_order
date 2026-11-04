"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, Gauge, Loader2, PlugZap, RefreshCw, WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { OdooStatus } from "@/app/api/odoo-status/route";

type View = OdooStatus | { state: "checking" | "offline"; ms: null; message: string; checkedAt: number };
const Ctx = createContext<{ status: View; refresh: () => void } | null>(null);

export const REFRESH_EVENT = "odoo-status-refresh";

/** One poller for the whole screen (the pill, the banner): every 30 s, every 8 s while something is wrong. */
export function OdooStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<View>({ state: "checking", ms: null, message: "", checkedAt: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const again = useRef<(fresh?: boolean) => void>(() => {});

  const refresh = useCallback(async (fresh = false) => {
    if (timer.current) clearTimeout(timer.current);
    let next: View;
    if (!navigator.onLine) next = { state: "offline", ms: null, message: "", checkedAt: Date.now() };
    else {
      try {
        const res = await fetch(fresh ? "/api/odoo-status?fresh=1" : "/api/odoo-status", { cache: "no-store" });
        next = res.ok ? ((await res.json()) as OdooStatus) : { state: "down", ms: null, message: "", checkedAt: Date.now() };
      } catch {
        next = { state: "offline", ms: null, message: "", checkedAt: Date.now() };
      }
    }
    if (!alive.current) return;
    setStatus(next);
    timer.current = setTimeout(() => again.current(false), next.state === "ok" ? 30_000 : 8_000);
  }, []);

  useEffect(() => {
    alive.current = true;
    again.current = (fresh) => { if (!document.hidden) void refresh(fresh); };
    const go = () => again.current(true);
    again.current(true); // a fresh look when the page opens
    window.addEventListener("online", go);
    window.addEventListener("offline", go);
    window.addEventListener(REFRESH_EVENT, go);
    document.addEventListener("visibilitychange", go);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", go);
      window.removeEventListener("offline", go);
      window.removeEventListener(REFRESH_EVENT, go);
      document.removeEventListener("visibilitychange", go);
    };
  }, [refresh]);

  const value = useMemo(() => ({ status, refresh: () => void refresh(true) }), [status, refresh]);
  return <Ctx value={value}>{children}</Ctx>;
}

function useStatus() {
  const c = useContext(Ctx);
  if (!c) throw new Error("OdooStatusProvider missing");
  return c;
}

const LOOK = {
  ok: { icon: CheckCircle2, dot: "text-ok", box: "border-green-200 bg-green-50 text-green-800" },
  slow: { icon: Gauge, dot: "text-warn", box: "border-amber-200 bg-amber-50 text-amber-800" },
  down: { icon: PlugZap, dot: "text-bad", box: "border-red-200 bg-red-50 text-red-800" },
  unauthorized: { icon: CircleAlert, dot: "text-bad", box: "border-red-200 bg-red-50 text-red-800" },
  unconfigured: { icon: CircleAlert, dot: "text-warn", box: "border-amber-200 bg-amber-50 text-amber-800" },
  offline: { icon: WifiOff, dot: "text-muted", box: "border-line bg-canvas text-muted" },
  checking: { icon: Loader2, dot: "text-muted", box: "border-line bg-canvas text-muted" },
} as const;

function useLabel() {
  const t = useT();
  const { status } = useStatus();
  const label = {
    ok: t("متصل بأودو"), slow: t("أودو بطيء"), down: t("أودو غير متاح"), unauthorized: t("مفتاح أودو مرفوض"),
    unconfigured: t("لم يُضبط الاتصال بأودو"), offline: t("لا يوجد إنترنت"), checking: t("جارٍ فحص أودو…"),
  }[status.state];
  const detail = status.state === "ok" || status.state === "slow"
    ? `${(status as OdooStatus).company ?? ""}${status.ms !== null ? ` · ${status.ms} ms` : ""}`
    : t(status.message || "");
  return { status, label, detail: detail.replace(/^ · /, "") };
}

/** Always-visible connection state: icon + words + response time (never colour alone). */
export function OdooStatusPill({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { status, label, detail } = useLabel();
  const look = LOOK[status.state];
  const Icon = look.icon;
  return (
    <Link href="/settings/odoo" title={`${label}${detail ? ` — ${detail}` : ""}`} aria-label={label} role="status" data-odoo-state={status.state}
      className={clsx("flex items-center gap-1.5 rounded-full text-xs font-semibold", compact ? "justify-center" : "", className)}>
      <Icon className={clsx("size-4 shrink-0", look.dot, status.state === "checking" && "animate-spin")} aria-hidden />
      {!compact && <span className="truncate">{label}{status.ms !== null && <span className="num ms-1 font-normal text-muted">{status.ms}ms</span>}</span>}
    </Link>
  );
}

/** When Odoo cannot be used, say so across the top of the page — not only in a corner. */
export function OdooStatusBanner({ canSettings }: { canSettings: boolean }) {
  const t = useT();
  const { status, label, detail } = useLabel();
  const { refresh } = useStatus();
  if (status.state === "ok" || status.state === "checking") return null;
  const look = LOOK[status.state];
  const Icon = look.icon;
  const advice = {
    slow: t("أودو يستجيب ببطء؛ قد تتأخر الشاشات."),
    down: t("تعذّر الوصول لأودو: ما تراه قد لا يكون محدّثاً، ولن تُحفظ تغييراتك حتى يعود الاتصال."),
    unauthorized: t("رفض أودو مفتاح الربط: لن تعمل الشاشات حتى يُصحَّح من إعدادات الاتصال."),
    unconfigured: t("اربط التطبيق بخادم أودو لتظهر البيانات."),
    offline: t("لا يوجد اتصال بالإنترنت على هذا الجهاز."),
  }[status.state];
  return (
    <div role="alert" className={clsx("mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm", look.box)}>
      <Icon className="size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{label}</p>
        <p className="leading-6">{advice}{detail && status.state !== "slow" ? ` ${detail}` : ""}</p>
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary px-3 py-1.5 max-lg:min-h-10" onClick={refresh}><RefreshCw className="size-4" /> {t("إعادة المحاولة")}</button>
        {canSettings && (status.state === "down" || status.state === "unauthorized" || status.state === "unconfigured") && (
          <Link href="/settings/odoo" className="btn-secondary px-3 py-1.5 max-lg:min-h-10">{t("إعدادات الاتصال")}</Link>
        )}
      </div>
    </div>
  );
}
