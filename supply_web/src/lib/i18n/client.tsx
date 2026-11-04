"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type T } from "./core";

const Ctx = createContext<{ locale: Locale; t: T } | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <Ctx value={value}>{children}</Ctx>;
}

function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT needs <I18nProvider>");
  return ctx;
}

export const useT = (): T => useI18n().t;
export const useLocale = (): Locale => useI18n().locale;
