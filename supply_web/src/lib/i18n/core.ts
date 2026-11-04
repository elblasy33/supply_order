import { EN } from "./en";

export type Locale = "ar" | "en";
export const LOCALES: Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";
export const DIR: Record<Locale, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };
/** The language Odoo is asked to answer in (record names stay as stored). */
export const ODOO_LANG: Record<Locale, string> = { ar: "ar_001", en: "en_US" };

export type T = (key: string, vars?: Record<string, string | number>) => string;

export const isLocale = (v: unknown): v is Locale => v === "ar" || v === "en";

/**
 * Texts are written in Arabic in the source and are their own keys (like gettext): Arabic shows as is,
 * English comes from the dictionary. A text that is not in the dictionary (for instance a message that
 * Odoo already translated) is shown unchanged. `{name}` placeholders are filled from `vars`.
 */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let text = key;
  if (locale === "en") text = EN[key] ?? fromPattern(key) ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

type Pattern = { re: RegExp; names: string[]; value: string };
let patterns: Pattern[] | null = null;

/** Keys with {0}, {1}… match texts built with variables: "{0} أمر" matches "12 أمر". */
function fromPattern(text: string): string | null {
  patterns ??= Object.entries(EN)
    .filter(([k]) => /\{\w+\}/.test(k))
    .map(([k, value]) => {
      const names: string[] = [];
      const source = k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, (_, n: string) => {
        names.push(n);
        return "([\\s\\S]+?)";
      });
      return { re: new RegExp(`^${source}$`), names, value };
    });
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) return p.names.reduce((acc, n, i) => acc.replaceAll(`{${n}}`, m[i + 1]), p.value);
  }
  return null;
}

export const makeT = (locale: Locale): T => (key, vars) => translate(locale, key, vars);
