import clsx from "clsx";

export function Badge({ children, tone = "slate", className }: { children: React.ReactNode; tone?: "slate" | "brand" | "green" | "amber" | "red"; className?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700", brand: "bg-brand-50 text-brand-700", green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700",
  };
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold", tones[tone], className)}>{children}</span>;
}

