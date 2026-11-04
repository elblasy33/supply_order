"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/lib/i18n/client";

type Mode = "light" | "dark" | "system";
const ORDER: Mode[] = ["light", "dark", "system"];

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  // the status bar of an installed app follows the chosen theme
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = dark ? "#161c24" : "#ffffff"; });
}

/** Light / dark / follow the system. Kept in a cookie so the server can render the right theme first. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )theme=(light|dark|system)/);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode((m?.[1] as Mode) ?? "system");
  }, []);
  useEffect(() => {
    if (mode !== "system") return;
    const q = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [mode]);

  function next() {
    const n = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    document.cookie = `theme=${n}; path=/; max-age=31536000; samesite=lax`;
    apply(n);
    setMode(n);
  }

  const label = { light: t("الوضع الفاتح"), dark: t("الوضع الغامق"), system: t("حسب النظام") }[mode];
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button type="button" onClick={next} className="btn-ghost px-2" title={`${t("المظهر")}: ${label}`} aria-label={`${t("المظهر")}: ${label}`}>
      <Icon className="size-5" />
      {!compact && <span className="text-xs">{label}</span>}
    </button>
  );
}
