"use client";

import { Printer } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function PrintButton() {
  const t = useT();
  return <button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer className="size-4" /> {t("طباعة")}</button>;
}
