"use server";

import { z } from "zod";
import { guard, type ActionResult } from "@/lib/guard";
import { odooData } from "@/lib/odoo";
import type { Picking, PickingScan } from "@/lib/types";

const idem = z.string().min(8).max(80);

const entry = z.object({
  quantity: z.number().min(0),
  lot_name: z.string().max(120).optional(),
  lot_id: z.number().int().positive().optional(),
});
const countLine = z.object({
  move_id: z.number().int().positive(),
  entries: z.array(entry).max(500).optional(),
  quantity: z.number().min(0).optional(),
});
export type CountLine = z.input<typeof countLine>;

export async function savePicking(id: number, lines: CountLine[], k: string): Promise<ActionResult<Picking>> {
  const parsed = z.array(countLine).safeParse(lines);
  if (!parsed.success || !idem.safeParse(k).success) return { ok: false, code: "validation_error", error: "كميات غير صالحة." };
  return guard("warehouse.process", (u) =>
    odooData<Picking>("picking_save", { id, lines: parsed.data }, { extUserId: u.extId, idempotencyKey: k }), "picking.save");
}

export async function scanPicking(id: number, code: string, k: string): Promise<ActionResult<PickingScan>> {
  return guard("warehouse.process", (u) =>
    odooData<PickingScan>("picking_scan", { id, code }, { extUserId: u.extId, idempotencyKey: k }));
}

/** `backorder` is required when something is short; `allowExpired` after the user confirmed expired lots. */
export async function validatePicking(
  id: number, backorder: "create" | "none" | null, allowExpired: boolean, k: string,
): Promise<ActionResult<Picking>> {
  return guard("warehouse.validate", (u) =>
    odooData<Picking>("picking_validate", { id, backorder, allow_expired: allowExpired }, { extUserId: u.extId, idempotencyKey: k }),
    "picking.validate");
}

export async function cancelPicking(id: number, k: string): Promise<ActionResult<Picking>> {
  return guard("warehouse.cancel", (u) =>
    odooData<Picking>("picking_cancel", { id }, { extUserId: u.extId, idempotencyKey: k }), "picking.cancel");
}

export async function returnPicking(id: number, lines: { move_id: number; quantity: number }[], k: string): Promise<ActionResult<Picking>> {
  const parsed = z.array(z.object({ move_id: z.number().int().positive(), quantity: z.number().positive() })).safeParse(lines);
  if (!parsed.success || parsed.data.length === 0) return { ok: false, code: "validation_error", error: "حدد كمية المرتجع." };
  return guard("warehouse.return", (u) =>
    odooData<Picking>("picking_return", { id, lines: parsed.data }, { extUserId: u.extId, idempotencyKey: k }), "picking.return");
}
