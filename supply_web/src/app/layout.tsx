import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Cairo } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { I18nProvider } from "@/lib/i18n/client";
import { DIR } from "@/lib/i18n/core";
import { getLocale, getT } from "@/lib/i18n/server";
import "./globals.css";

const cairo = Cairo({ variable: "--font-cairo", subsets: ["arabic", "latin"], display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t("أوامر التوريد"), template: `%s · ${t("أوامر التوريد")}` },
    description: t("إدارة أوامر التوريد وربطها بأودو"),
  };
}

// Runs before the first paint so a dark (or system-dark) theme never flashes light.
const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=(light|dark|system)/);var t=m?m[1]:"system";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang={locale} dir={DIR[locale]} className={`${cairo.variable}${theme === "dark" ? " dark" : ""}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-screen antialiased">
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
