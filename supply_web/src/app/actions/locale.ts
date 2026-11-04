"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n/core";

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set("locale", locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  revalidatePath("/", "layout");
}
