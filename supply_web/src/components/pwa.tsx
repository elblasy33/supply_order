"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { useT } from "@/lib/i18n/client";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Registers the service worker (production only) and tells the user when a new version is waiting. */
export function PwaRegister() {
  const t = useT();
  const { push } = useToast();
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      const announce = () => { if (navigator.serviceWorker.controller) push("info", t("يتوفر إصدار جديد من التطبيق. أغلقه وافتحه من جديد للتحديث (لا يُحدَّث أثناء العمل حتى لا يضيع عدّك).")); };
      if (reg.waiting) announce();
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => { if (worker.state === "installed") announce(); });
      });
    }).catch(() => { /* no service worker: the app simply works online */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const DISMISS_KEY = "pwa.dismissed";
const DISMISS_DAYS = 14;

/**
 * Invites phone users to put the app on the home screen: a one-tap install where the browser allows it
 * (Android / Chrome), and the two steps for Safari on iPhone. Shown only on small screens, only when the app
 * is not already installed, and not again for two weeks after being dismissed.
 */
export function InstallPrompt() {
  const t = useT();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    const recently = Date.now() - dismissed < DISMISS_DAYS * 864e5;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIos(isIos);
    setHidden(standalone || recently);
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (hidden || (!event && !ios)) return null;

  const dismiss = () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setHidden(true); };
  async function install() {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") setHidden(true); else dismiss();
  }

  return (
    <aside className="card mb-4 flex items-start gap-3 border-brand-200 bg-brand-50 p-3 lg:hidden" role="region" aria-label={t("تثبيت التطبيق")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-extrabold">{t("ثبّت التطبيق على جوالك")}</p>
        {event ? (
          <>
            <p className="text-muted">{t("يفتح بأيقونة على الشاشة الرئيسية كتطبيق مستقل، وأسرع في الوصول للماسح.")}</p>
            <button className="btn-primary mt-2 px-3 py-1.5" onClick={install}><Download className="size-4" /> {t("تثبيت")}</button>
          </>
        ) : (
          <p className="leading-7 text-muted">
            {t("اضغط")} <Share className="inline size-4 align-text-bottom" /> <b>{t("مشاركة")}</b> {t("ثم")} <SquarePlus className="inline size-4 align-text-bottom" /> <b>{t("إضافة إلى الشاشة الرئيسية")}</b>.
          </p>
        )}
      </div>
      <button className="btn-ghost px-2" onClick={dismiss} aria-label={t("إغلاق")}><X className="size-4" /></button>
    </aside>
  );
}
