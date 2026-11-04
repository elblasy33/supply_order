"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import clsx from "clsx";

type Kind = "ok" | "error" | "info";
type Toast = { id: number; kind: Kind; text: string };
const Ctx = createContext<{ push: (kind: Kind, text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, text }].slice(-4));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 start-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3 text-sm shadow-lg",
              t.kind === "ok" && "border-green-200",
              t.kind === "error" && "border-red-200",
              t.kind === "info" && "border-brand-200",
            )}
          >
            {t.kind === "ok" && <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" />}
            {t.kind === "error" && <CircleAlert className="mt-0.5 size-5 shrink-0 text-bad" />}
            {t.kind === "info" && <Info className="mt-0.5 size-5 shrink-0 text-brand-600" />}
            <p className="flex-1 leading-6">{t.text}</p>
            <button aria-label="إغلاق" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="text-muted hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast needs <ToastProvider>");
  return ctx;
}
