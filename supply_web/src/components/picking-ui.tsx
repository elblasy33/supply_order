"use client";

import { Badge } from "@/components/badge";
import { useT } from "@/lib/i18n/client";
import type { PickingState } from "@/lib/types";

export const PICKING_STATE: Record<PickingState, [string, "slate" | "amber" | "brand" | "green" | "red"]> = {
  draft: ["مسودة", "slate"], waiting: ["بانتظار", "amber"], confirmed: ["بانتظار التوفر", "amber"],
  assigned: ["جاهز", "brand"], done: ["منفّذ", "green"], cancel: ["ملغي", "red"],
};
export { KIND } from "./labels";

export function PickingStateBadge({ state }: { state: PickingState }) {
  const t = useT();
  const [label, tone] = PICKING_STATE[state] ?? [state, "slate"];
  return <Badge tone={tone}>{t(label)}</Badge>;
}
