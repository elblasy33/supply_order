import type { PickingKind } from "@/lib/types";

/** Source (Arabic) labels; screens translate them with t() where they show them. */
export const KIND: Record<PickingKind, string> = { delivery: "تسليم", receipt: "استلام", internal: "داخلي" };
