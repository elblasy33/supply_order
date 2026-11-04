import type { MetadataRoute } from "next";
import { DIR } from "@/lib/i18n/core";
import { getLocale, getT } from "@/lib/i18n/server";

/** Makes the app installable: it opens from the home screen as its own app, without the browser bars. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getT();
  const locale = await getLocale();
  return {
    id: "/",
    name: t("أوامر التوريد"),
    short_name: t("التوريد"),
    description: t("إدارة أوامر التوريد وربطها بأودو"),
    lang: locale,
    dir: DIR[locale],
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f6f9",
    theme_color: "#0d8f99",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // long-press the icon: straight to the two most used screens
    shortcuts: [
      { name: t("المخزن (تسليم/استلام)"), short_name: t("المخزن"), url: "/warehouse", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: t("أمر توريد جديد"), short_name: t("أمر جديد"), url: "/orders/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
