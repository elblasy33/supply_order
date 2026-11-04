import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, makeT, type Locale, type T } from "./core";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get("locale")?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Translator for server components, server actions and route handlers. */
export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
