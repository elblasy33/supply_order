"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLocale } from "@/app/actions/locale";
import { useLocale } from "@/lib/i18n/client";

/** Switches between Arabic (RTL) and English (LTR); the label is the language you would switch to. */
export function LocaleToggle({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const target = locale === "ar" ? "en" : "ar";
  const label = target === "en" ? "English" : "العربية";
  return (
    <button type="button" className="btn-ghost px-2" disabled={pending} title={label} aria-label={label}
      onClick={() => start(async () => { await setLocale(target); router.refresh(); })}>
      <Languages className="size-5" />
      {!compact && <span className="text-xs">{label}</span>}
    </button>
  );
}
