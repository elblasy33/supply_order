"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function Dialog({
  open, onClose, title, children, footer, wide,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[min(94vw,${wide ? "44rem" : "30rem"})] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40`}
      style={{ width: `min(94vw, ${wide ? "44rem" : "30rem"})` }}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-extrabold">{title}</h2>
            <button className="btn-ghost px-2" aria-label={t("إغلاق")} onClick={onClose}><X className="size-5" /></button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas/50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
