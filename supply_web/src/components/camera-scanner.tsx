"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Camera, CameraOff, FlipHorizontal2, Flashlight, FlashlightOff, Loader2, Pause, Play, ScanLine, X, Zap } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { CameraSession, classifyError, type CameraCaps, type CameraError } from "@/lib/scan/camera";
import { feedback, unlockAudio, type FeedbackKind } from "@/lib/scan/feedback";

export type ScanResult = { kind: FeedbackKind; message: string };
type Mode = "continuous" | "single";

const TONE: Record<FeedbackKind, string> = {
  ok: "bg-green-600 text-white",
  dup: "bg-amber-500 text-black",
  warn: "bg-amber-500 text-black",
  error: "bg-red-600 text-white",
};
const RING: Record<FeedbackKind, string> = { ok: "ring-green-500", dup: "ring-amber-400", warn: "ring-amber-400", error: "ring-red-500" };
const IDLE_MS = 90_000;

/**
 * Phone camera scanner. Detection is on the device (see lib/scan/camera.ts); every code goes to `onCode`,
 * whose answer decides the sound, the vibration and the colour. Continuous mode keeps reading; "one at a time"
 * pauses after each code until the next tap (for receiving / loading where a mis-scan is costly).
 */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string, format: string) => ScanResult | Promise<ScanResult>; onClose: () => void }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const onCodeRef = useRef(onCode);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<Mode>("continuous");
  const [status, setStatus] = useState<"starting" | "running" | "error" | "idle" | "waiting">("starting");
  const [error, setError] = useState<CameraError | null>(null);
  const [caps, setCaps] = useState<CameraCaps | null>(null);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Mode>("continuous");
  const [last, setLast] = useState<{ result: ScanResult; code: string } | null>(null);
  const [count, setCount] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(localStorage.getItem("scan.mode") === "single" ? "single" : "continuous");
  }, []);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { sessionRef.current?.pause(); setStatus("idle"); }, IDLE_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const session = new CameraSession({
      onDetect: ({ code, format }) => {
        armIdle();
        if (modeRef.current === "single") { session.pause(); setStatus("waiting"); }
        // answers are shown in the order the codes were read, even when the app needs a moment to reply
        queue.current = queue.current.then(async () => {
          let result: ScanResult;
          try { result = await onCodeRef.current(code, format); } catch { result = { kind: "error", message: "" }; }
          feedback(result.kind);
          setLast({ result, code });
          setCount((c) => c + 1);
        });
      },
    });
    sessionRef.current = session;
    unlockAudio();
    const video = videoRef.current;
    if (!video) return;
    session.start(video, localStorage.getItem("scan.camera") ?? undefined)
      .then((c) => { if (cancelled) { session.stop(); return; } setCaps(c); setStatus("running"); setError(null); armIdle(); })
      .catch((e) => { if (cancelled) return; setError(classifyError(e)); setStatus("error"); });

    // never keep the camera on in the background: release it, and take it back when the tab returns
    const onVisible = () => {
      if (document.hidden) { session.stop(); setStatus("idle"); }
      else { setAttempt((a) => a + 1); }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      session.stop();
    };
  }, [attempt, armIdle]);

  async function toggleTorch() {
    const next = !torch;
    try { await sessionRef.current?.setTorch(next); setTorch(next); } catch { /* the device refused */ }
  }
  async function applyZoom(z: number) {
    try { await sessionRef.current?.setZoom(z); setZoom(z); } catch { /* ignore */ }
  }
  function switchCamera() {
    if (!caps || caps.cameras.length < 2) return;
    const i = caps.cameras.findIndex((c) => c.id === caps.deviceId);
    const next = caps.cameras[(i + 1) % caps.cameras.length];
    localStorage.setItem("scan.camera", next.id);
    setTorch(false);
    setStatus("starting");
    setAttempt((a) => a + 1);
  }
  function changeMode(m: Mode) {
    setMode(m);
    localStorage.setItem("scan.mode", m);
    if (m === "continuous" && status === "waiting") next();
  }
  function next() {
    sessionRef.current?.resume();
    armIdle();
    setStatus("running");
  }

  const ERR: Record<CameraError, string> = {
    insecure: t("الكاميرا لا تعمل إلا عبر اتصال آمن (HTTPS). افتح التطبيق بعنوان https:// أو من localhost."),
    unsupported: t("هذا المتصفح لا يدعم الوصول للكاميرا."),
    denied: t("تم رفض إذن الكاميرا. اسمح بالكاميرا لهذا الموقع من إعدادات المتصفح ثم أعد المحاولة."),
    not_found: t("لم يُعثر على كاميرا في هذا الجهاز."),
    busy: t("الكاميرا مستخدمة في تطبيق آخر. أغلقه ثم أعد المحاولة."),
    failed: t("تعذّر تشغيل الكاميرا."),
  };

  const zoomSteps = caps?.zoom ? [1, 2, 3].filter((z) => z >= caps.zoom!.min && z <= caps.zoom!.max) : [];

  return (
    <section className={clsx("card sticky top-2 z-20 overflow-hidden ring-4 transition", last && status === "running" ? RING[last.result.kind] : "ring-transparent")} aria-label={t("ماسح الكاميرا")}>
      <div className="relative bg-black">
        <video ref={videoRef} className="aspect-[4/3] max-h-[40vh] w-full object-cover md:max-h-72" playsInline muted aria-label={t("بث الكاميرا")} />
        {status === "running" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative h-[50%] w-[86%] rounded-xl border-2 border-white/80">
              <div className="scan-line absolute inset-x-2 h-0.5 rounded bg-red-500/90" />
            </div>
          </div>
        )}
        {status === "starting" && <div className="absolute inset-0 grid place-items-center text-white"><Loader2 className="size-8 animate-spin" /></div>}
        {(status === "idle" || status === "waiting") && (
          <button onClick={next} className="absolute inset-0 grid place-items-center bg-black/55 text-white">
            <span className="flex flex-col items-center gap-2 text-center">
              <Play className="size-10" />
              <b>{status === "waiting" ? t("مسح التالي") : t("توقّف الماسح توفيراً للبطارية — المس للمتابعة")}</b>
            </span>
          </button>
        )}
        {status === "error" && error && (
          <div className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-white" role="alert">
            <div className="max-w-sm space-y-3">
              <CameraOff className="mx-auto size-8" />
              <p className="text-sm leading-6">{ERR[error]}</p>
              {error !== "insecure" && error !== "unsupported" && <button className="btn-primary" onClick={() => { setStatus("starting"); setAttempt((a) => a + 1); }}>{t("إعادة المحاولة")}</button>}
            </div>
          </div>
        )}
        <button onClick={onClose} aria-label={t("إغلاق الكاميرا")} className="absolute end-2 top-2 grid size-9 place-items-center rounded-full bg-black/60 text-white"><X className="size-5" /></button>
        {status === "running" && <span className="absolute start-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white"><ScanLine className="size-3.5" /> <span className="num">{count}</span></span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line p-2">
        {caps?.torch && (
          <button className={clsx("btn-secondary px-3", torch && "border-amber-400 bg-amber-100 text-black")} onClick={toggleTorch} aria-pressed={torch} aria-label={t("المصباح")}>
            {torch ? <Flashlight className="size-4" /> : <FlashlightOff className="size-4" />}
          </button>
        )}
        {zoomSteps.length > 1 && zoomSteps.map((z) => (
          <button key={z} className={clsx("btn-secondary px-3", zoom === z && "border-brand-500 text-brand-700")} onClick={() => applyZoom(z)} aria-pressed={zoom === z}><span className="num">{z}×</span></button>
        ))}
        {caps && caps.cameras.length > 1 && <button className="btn-secondary px-3" onClick={switchCamera} aria-label={t("تبديل الكاميرا")}><FlipHorizontal2 className="size-4" /></button>}
        <div className="ms-auto flex overflow-hidden rounded-xl border border-line text-xs font-bold" role="group" aria-label={t("نمط المسح")}>
          <button className={clsx("flex items-center gap-1 px-3 py-2", mode === "continuous" ? "bg-brand-500 text-white" : "bg-surface")} onClick={() => changeMode("continuous")} aria-pressed={mode === "continuous"}><Zap className="size-3.5" />{t("مستمر")}</button>
          <button className={clsx("flex items-center gap-1 px-3 py-2", mode === "single" ? "bg-brand-500 text-white" : "bg-surface")} onClick={() => changeMode("single")} aria-pressed={mode === "single"}><Pause className="size-3.5" />{t("واحد بواحد")}</button>
        </div>
      </div>

      <div role="status" aria-live="polite" className={clsx("flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm font-bold", last ? TONE[last.result.kind] : "bg-canvas text-muted")}>
        {last ? (<><span className="min-w-0 truncate">{last.result.message || last.code}</span><span dir="ltr" className="shrink-0 font-mono text-xs opacity-80">{last.code}</span></>)
          : <span className="flex items-center gap-2"><Camera className="size-4" />{t("وجّه الكاميرا نحو الباركود")}</span>}
      </div>
    </section>
  );
}
