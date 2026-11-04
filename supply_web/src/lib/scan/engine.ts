import { normalizeGtin, parseGs1 } from "./gs1";

/**
 * Counting logic of the transfer screen, free of React and of the network: every scan is applied on the
 * device at once (no round trip), and the counts are saved with the transfer. Pure functions, unit tested.
 */
export type CountMove = {
  id: number;
  name: string;
  barcode: string;
  code: string;
  tracking: "none" | "lot" | "serial";
  autoLot: boolean;
  demand: number;
};
export type CountEntry = { lot: string; qty: string };
export type CountRow = { moveId: number; tracked: boolean; qty: string; entries: CountEntry[] };

export type ScanOutcome =
  | { kind: "counted"; moveId: number; name: string; total: number; demand: number; lot?: string }
  | { kind: "need_lot"; moveId: number; name: string }
  | { kind: "duplicate_serial"; moveId: number; name: string; lot: string }
  | { kind: "no_item_for_lot"; code: string }
  | { kind: "unknown"; code: string };

export type ScanState = { rows: CountRow[]; current: number | null };

const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);
export const rowTotal = (r: CountRow) => (r.tracked ? r.entries.reduce((s, e) => s + num(e.qty), 0) : num(r.qty));

const sameCode = (a: string, b: string) => !!a && !!b && (a === b || (/^\d+$/.test(a) && /^\d+$/.test(b) && normalizeGtin(a) === normalizeGtin(b)));
const findMove = (moves: CountMove[], code: string) => moves.find((m) => sameCode(m.barcode, code) || sameCode(m.code, code));

function addUnit(rows: CountRow[], move: CountMove, lot: string | null): { rows: CountRow[]; dupSerial: boolean } {
  let dup = false;
  const next = rows.map((r) => {
    if (r.moveId !== move.id) return r;
    if (!r.tracked) return { ...r, qty: fmt(num(r.qty) + 1) };
    const i = r.entries.findIndex((e) => e.lot === (lot ?? ""));
    if (i >= 0) {
      if (move.tracking === "serial" && lot) { dup = true; return r; }
      return { ...r, entries: r.entries.map((e, j) => (j === i ? { ...e, qty: fmt(num(e.qty) + 1) } : e)) };
    }
    return { ...r, entries: [...r.entries, { lot: lot ?? "", qty: "1" }] };
  });
  return { rows: next, dupSerial: dup };
}

/** Applies one scanned code: an item barcode, a lot / serial number, or a GS1 code carrying both. */
export function applyScan(state: ScanState, moves: CountMove[], rawCode: string): { state: ScanState; outcome: ScanOutcome } {
  const code = rawCode.trim();
  const totalOf = (rows: CountRow[], id: number) => rowTotal(rows.find((r) => r.moveId === id)!);
  const counted = (rows: CountRow[], move: CountMove, lot?: string): { state: ScanState; outcome: ScanOutcome } => ({
    state: { rows, current: move.tracking !== "none" ? move.id : state.current },
    outcome: { kind: "counted", moveId: move.id, name: move.name, total: totalOf(rows, move.id), demand: move.demand, lot },
  });

  // 1. GS1: item + lot in one scan
  const gs1 = parseGs1(code);
  if (gs1) {
    const move = findMove(moves, gs1.gtin);
    if (move) {
      if (move.tracking === "none") return counted(addUnit(state.rows, move, null).rows, move);
      const lot = move.tracking === "serial" ? gs1.serial ?? gs1.lot : gs1.lot;
      if (!lot) return { state: { ...state, current: move.id }, outcome: { kind: "need_lot", moveId: move.id, name: move.name } };
      const r = addUnit(state.rows, move, lot);
      return r.dupSerial ? { state, outcome: { kind: "duplicate_serial", moveId: move.id, name: move.name, lot } } : counted(r.rows, move, lot);
    }
  }

  // 2. an item barcode
  const byItem = findMove(moves, code);
  if (byItem) {
    if (byItem.tracking === "none") return counted(addUnit(state.rows, byItem, null).rows, byItem);
    if (byItem.autoLot) return counted(addUnit(state.rows, byItem, null).rows, byItem); // lot numbered by Odoo
    return { state: { ...state, current: byItem.id }, outcome: { kind: "need_lot", moveId: byItem.id, name: byItem.name } };
  }

  // 3. a lot / serial already counted: one more unit of it
  for (const r of state.rows) {
    if (r.tracked && r.entries.some((e) => e.lot === code)) {
      const move = moves.find((m) => m.id === r.moveId)!;
      const res = addUnit(state.rows, move, code);
      return res.dupSerial ? { state, outcome: { kind: "duplicate_serial", moveId: move.id, name: move.name, lot: code } } : counted(res.rows, move, code);
    }
  }

  // 4. a new lot / serial: it belongs to the item scanned last, or to the only tracked item
  const tracked = moves.filter((m) => m.tracking !== "none");
  const target = moves.find((m) => m.id === state.current && m.tracking !== "none") ?? (tracked.length === 1 ? tracked[0] : undefined);
  if (target) return counted(addUnit(state.rows, target, code).rows, target, code);
  return { state, outcome: tracked.length ? { kind: "no_item_for_lot", code } : { kind: "unknown", code } };
}
