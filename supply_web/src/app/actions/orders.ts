"use server";

import { z } from "zod";
import { guard, type ActionResult } from "@/lib/guard";
import { odooData, odooPage } from "@/lib/odoo";
import { PermissionError } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import type { Page } from "@/lib/odoo";
import type { LookupPartner, LookupProduct, OrderSummary, ScanResult, SupplyOrder } from "@/lib/types";

const key = z.string().min(8).max(80);
const id = z.number().int().positive();

const ACTION_PERMISSION: Record<string, Permission> = {
  confirm: "orders.confirm",
  cancel: "orders.cancel",
  reset_draft: "orders.cancel",
  close: "orders.close",
  prepare_transfer: "orders.prepare_transfer",
  create_sale_order: "orders.create_sale",
  create_purchase_order: "orders.create_purchase",
  create_invoice: "orders.invoice",
};

async function readOrder(orderId: number, extId: number): Promise<SupplyOrder> {
  return odooData<SupplyOrder>("order_read", { id: orderId }, { extUserId: extId });
}

/** Item edits need a different permission before and after confirmation. */
function editPermission(order: SupplyOrder): Permission {
  return order.state === "draft" ? "orders.edit_draft" : "orders.edit_confirmed";
}

function mustEdit(order: SupplyOrder, user: { permissions: Set<Permission> }) {
  if (!user.permissions.has(editPermission(order))) {
    throw new PermissionError(
      order.state === "draft" ? "ليست لديك صلاحية تعديل الأصناف." : "ليست لديك صلاحية تعديل أمر مؤكد.",
    );
  }
}

function mustOwn(order: SupplyOrder, lineId: number) {
  if (!order.lines.some((l) => l.id === lineId)) throw new PermissionError("هذا السطر لا يتبع الأمر.");
}

// ---------------------------------------------------------------- queries
export async function searchOrders(input: {
  query?: string; state?: string[]; order_type?: string; invoice_state?: string; offset?: number; limit?: number;
}): Promise<ActionResult<Page<OrderSummary>>> {
  return guard("orders.view", (u) => odooPage<OrderSummary>("order_search", input, { extUserId: u.extId }));
}

export async function lookup(kind: "product" | "partner" | "lot", query: string): Promise<ActionResult<(LookupProduct | LookupPartner)[]>> {
  return guard("orders.view", (u) => odooData("lookup", { kind, query, limit: 15 }, { extUserId: u.extId }));
}

// ---------------------------------------------------------------- orders
const lineValues = z.object({
  product_id: id,
  qty_requested: z.number().positive(),
  price_unit: z.number().min(0).optional(),
  discount: z.number().min(0).max(100).optional(),
  note: z.string().max(500).optional(),
  invoice_group: z.string().max(120).optional(),
});

const createSchema = z.object({
  key,
  partner_id: id,
  order_type: z.enum(["sale", "purchase"]),
  supply_ref: z.string().max(120).optional(),
  note: z.string().max(2000).optional(),
  lines: z.array(lineValues).min(1, "أضف صنفاً واحداً على الأقل."),
});

export async function createOrder(input: z.input<typeof createSchema>): Promise<ActionResult<SupplyOrder>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "validation_error", error: parsed.error.issues[0].message };
  const { key: idem, ...body } = parsed.data;
  return guard("orders.create", (u) =>
    odooData<SupplyOrder>("order_create", body, { extUserId: u.extId, idempotencyKey: idem }), "order.create");
}

export async function orderFromDocument(model: "sale.order" | "purchase.order", docId: number, k: string): Promise<ActionResult<SupplyOrder>> {
  return guard("orders.from_document", (u) =>
    odooData<SupplyOrder>("order_from_document", { model, id: docId }, { extUserId: u.extId, idempotencyKey: k }));
}

export async function orderAction(orderId: number, action: string, k: string): Promise<ActionResult<SupplyOrder>> {
  const perm = ACTION_PERMISSION[action];
  if (!perm || !key.safeParse(k).success) return { ok: false, code: "validation_error", error: "إجراء غير معروف." };
  return guard(perm, (u) =>
    odooData<SupplyOrder>("order_action", { id: orderId, action }, { extUserId: u.extId, idempotencyKey: k }), `order.${action}`);
}

// ---------------------------------------------------------------- lines
export async function addLine(orderId: number, line: z.input<typeof lineValues>, reason: string, k: string): Promise<ActionResult<SupplyOrder>> {
  const parsed = lineValues.safeParse(line);
  if (!parsed.success) return { ok: false, code: "validation_error", error: parsed.error.issues[0].message };
  return guard(null, async (u) => {
    mustEdit(await readOrder(orderId, u.extId), u);
    return odooData<SupplyOrder>("line_add", { order_id: orderId, line: parsed.data, reason }, { extUserId: u.extId, idempotencyKey: k });
  });
}

const patch = z.object({
  qty_requested: z.number().positive().optional(),
  price_unit: z.number().min(0).optional(),
  discount: z.number().min(0).max(100).optional(),
  note: z.string().max(500).optional(),
  invoice_group: z.string().max(120).optional(),
});

export async function updateLine(
  orderId: number, lineId: number, values: z.input<typeof patch>, opts: { line_no?: number; reason?: string }, k: string,
): Promise<ActionResult<SupplyOrder>> {
  const parsed = patch.safeParse(values);
  if (!parsed.success) return { ok: false, code: "validation_error", error: parsed.error.issues[0].message };
  return guard(null, async (u) => {
    const order = await readOrder(orderId, u.extId);
    mustEdit(order, u);
    mustOwn(order, lineId);
    return odooData<SupplyOrder>(
      "line_update",
      { line_id: lineId, values: parsed.data, line_no: opts.line_no, reason: opts.reason },
      { extUserId: u.extId, idempotencyKey: k },
    );
  });
}

export async function removeLine(orderId: number, lineId: number, reason: string, k: string): Promise<ActionResult<SupplyOrder>> {
  return guard(null, async (u) => {
    const order = await readOrder(orderId, u.extId);
    mustEdit(order, u);
    mustOwn(order, lineId);
    return odooData<SupplyOrder>("line_remove", { line_id: lineId, reason }, { extUserId: u.extId, idempotencyKey: k });
  });
}

export async function substituteLine(
  orderId: number, lineId: number, productId: number, reason: string, returnDone: boolean, k: string,
): Promise<ActionResult<SupplyOrder>> {
  return guard("orders.substitute", async (u) => {
    mustOwn(await readOrder(orderId, u.extId), lineId);
    return odooData<SupplyOrder>(
      "line_substitute",
      { line_id: lineId, product_id: productId, reason, return_done: returnDone },
      { extUserId: u.extId, idempotencyKey: k },
    );
  });
}

export async function scan(orderId: number, code: string, k: string): Promise<ActionResult<ScanResult>> {
  return guard("orders.scan", async (u) => {
    const order = await readOrder(orderId, u.extId);
    if (order.state !== "draft" && !u.permissions.has("orders.edit_confirmed")) {
      throw new PermissionError("المسح على أمر مؤكد يحتاج صلاحية تعديل أمر مؤكد.");
    }
    if (order.state === "draft" && !u.permissions.has("orders.edit_draft")) {
      throw new PermissionError("ليست لديك صلاحية تعديل الأصناف.");
    }
    return odooData<ScanResult>("scan", { order_id: orderId, code }, { extUserId: u.extId, idempotencyKey: k });
  });
}
