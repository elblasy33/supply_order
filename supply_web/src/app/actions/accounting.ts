"use server";

import { z } from "zod";
import { guard, type ActionResult } from "@/lib/guard";
import { odooData } from "@/lib/odoo";
import type { OpenItem } from "@/lib/types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = z.object({
  partner_id: z.number().int().positive(),
  kind: z.enum(["customer", "vendor"]),
  date_from: date,
  date_to: date,
});

export async function reconcileLoad(input: z.input<typeof base>): Promise<ActionResult<{ invoices: OpenItem[]; payments: OpenItem[] }>> {
  const parsed = base.safeParse(input);
  if (!parsed.success) return { ok: false, code: "validation_error", error: "اختر العميل أو المورد والفترة." };
  if (parsed.data.date_from > parsed.data.date_to) return { ok: false, code: "validation_error", error: "تاريخ البداية بعد تاريخ النهاية." };
  return guard("accounting.reconcile", (u) =>
    odooData("reconcile_load", parsed.data, { extUserId: u.extId, idempotencyKey: crypto.randomUUID() }));
}

export type ReconcileResult = {
  batch: string;
  pairs: { invoice: { id: number; name: string }; payment: { id: number; name: string }; amount: number; invoice_left: number }[];
  remaining: number;
};

export async function reconcileRun(
  input: z.input<typeof base> & { invoice_ids: number[]; payment_ids: number[]; allocation_order: "due" | "invoice" },
  k: string,
): Promise<ActionResult<ReconcileResult>> {
  const parsed = base.safeParse(input);
  if (!parsed.success || !input.invoice_ids.length) {
    return { ok: false, code: "validation_error", error: "حدد فاتورة واحدة على الأقل." };
  }
  if (!input.payment_ids.length) return { ok: false, code: "validation_error", error: "حدد دفعة أو إشعاراً دائناً واحداً على الأقل." };
  return guard("accounting.reconcile", (u) =>
    odooData<ReconcileResult>(
      "reconcile_run",
      { ...parsed.data, invoice_ids: input.invoice_ids, payment_ids: input.payment_ids, allocation_order: input.allocation_order },
      { extUserId: u.extId, idempotencyKey: k },
    ), "reconcile.run");
}

export async function rebateAction(accrualId: number, action: "confirm" | "settle" | "cancel" | "reset_draft", k: string) {
  return guard("rebates.manage", (u) =>
    odooData<{ id: number; state: string; amount: number }>("rebate_action", { id: accrualId, action }, { extUserId: u.extId, idempotencyKey: k }),
    `rebate.${action}`);
}
