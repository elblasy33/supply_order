import { Badge } from "@/components/ui";
import type { PickingKind, PickingState } from "@/lib/types";

export const PICKING_STATE: Record<PickingState, [string, "slate" | "amber" | "brand" | "green" | "red"]> = {
  draft: ["مسودة", "slate"], waiting: ["بانتظار", "amber"], confirmed: ["بانتظار التوفر", "amber"],
  assigned: ["جاهز", "brand"], done: ["منفّذ", "green"], cancel: ["ملغي", "red"],
};
export const KIND: Record<PickingKind, string> = { delivery: "تسليم", receipt: "استلام", internal: "داخلي" };

export function PickingStateBadge({ state }: { state: PickingState }) {
  const [label, tone] = PICKING_STATE[state] ?? [state, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}
