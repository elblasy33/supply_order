"use server";

import { z } from "zod";
import { guard, type ActionResult } from "@/lib/guard";
import { odooData } from "@/lib/odoo";
import type { CashMove, ExpenseProduct } from "@/lib/types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const amount = z.number().positive("المبلغ يجب أن يكون أكبر من صفر.");
const bad = (error: string): ActionResult<never> => ({ ok: false, code: "validation_error", error });

const entrySchema = z.object({
  journal_id: z.number().int().positive(),
  partner_id: z.number().int().positive(),
  partner_kind: z.enum(["customer", "vendor"]),
  direction: z.enum(["in", "out"]),
  amount, date, ref: z.string().max(200).optional(),
});

/** Money in (قبض) or out (صرف) for a customer or vendor — not matched to any invoice. */
export async function cashEntry(input: z.input<typeof entrySchema>, k: string): Promise<ActionResult<CashMove>> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "راجع البيانات المدخلة.");
  return guard(parsed.data.direction === "in" ? "cash.receive" : "cash.pay", (u) =>
    odooData<CashMove>("cash_entry", parsed.data, { extUserId: u.extId, idempotencyKey: k }),
    `cash.${parsed.data.direction}`);
}

const transferSchema = z.object({
  from_journal_id: z.number().int().positive(), to_journal_id: z.number().int().positive(),
  amount, date, ref: z.string().max(200).optional(),
});

export async function cashTransfer(input: z.input<typeof transferSchema>, k: string): Promise<ActionResult<CashMove>> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "راجع البيانات المدخلة.");
  if (parsed.data.from_journal_id === parsed.data.to_journal_id) return bad("اختر خزينتين مختلفتين.");
  return guard("cash.transfer", (u) =>
    odooData<CashMove>("cash_transfer", parsed.data, { extUserId: u.extId, idempotencyKey: k }), "cash.transfer");
}

const expenseSchema = z.object({
  journal_id: z.number().int().positive(), product_id: z.number().int().positive(),
  amount, date, name: z.string().max(200).optional(), notes: z.string().max(1000).optional(),
});

/** A company-paid expense (never an employee's) taken from the chosen treasury. */
export async function expenseCreate(input: z.input<typeof expenseSchema>, k: string) {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "راجع البيانات المدخلة.");
  return guard("expenses.create", (u) =>
    odooData<{ id: number; name: string; state: string; amount: number }>("expense_create", parsed.data, { extUserId: u.extId, idempotencyKey: k }),
    "expense.create");
}

export async function expenseProducts(query: string): Promise<ActionResult<ExpenseProduct[]>> {
  return guard("expenses.create", (u) => odooData("expense_products", { query: query.trim() || undefined, limit: 30 }, { extUserId: u.extId }));
}
