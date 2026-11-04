import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const cairo = Cairo({ variable: "--font-cairo", subsets: ["arabic", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "أوامر التوريد", template: "%s · أوامر التوريد" },
  description: "إدارة أوامر التوريد وربطها بأودو",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="min-h-screen antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
