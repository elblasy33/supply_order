import { expect, test } from "@playwright/test";
import { gs1Date, parseGs1, normalizeGtin } from "../src/lib/scan/gs1";
import { applyScan, rowTotal, type CountMove, type CountRow } from "../src/lib/scan/engine";

const plain: CountMove = { id: 1, name: "Chips", barcode: "6221000000010", code: "CH-1", tracking: "none", autoLot: false, demand: 3 };
const juice: CountMove = { id: 2, name: "Juice", barcode: "6221000000034", code: "", tracking: "lot", autoLot: false, demand: 10 };
const milk: CountMove = { id: 3, name: "Milk", barcode: "6221000000041", code: "", tracking: "serial", autoLot: false, demand: 2 };
const moves = [plain, juice, milk];
const rows = (): CountRow[] => [
  { moveId: 1, tracked: false, qty: "0", entries: [] },
  { moveId: 2, tracked: true, qty: "0", entries: [] },
  { moveId: 3, tracked: true, qty: "0", entries: [] },
];
const scan = (state: { rows: CountRow[]; current: number | null }, code: string) => applyScan(state, moves, code);

test("GS1 codes: readable and raw forms, expiry dates", () => {
  expect(parseGs1("(01)06221000000034(10)LOT-7(17)261231")).toEqual({ gtin: "06221000000034", lot: "LOT-7", serial: undefined, expiry: "2026-12-31", production: undefined });
  expect(parseGs1("0106221000000034" + "10AB12\x1d" + "17270200")?.expiry).toBe("2027-02-28"); // day 00 = end of month
  expect(parseGs1("0106221000000034" + "10AB12")?.lot).toBe("AB12"); // no separator: lot runs to the end
  expect(parseGs1("]C10106221000000034211234")?.serial).toBe("1234");
  expect(parseGs1("6221000000010")).toBeNull(); // a plain EAN-13 is not GS1
  expect(parseGs1("LOT-7")).toBeNull();
  expect(gs1Date("991301")).toBeUndefined();
  expect(normalizeGtin("06221000000034")).toBe("6221000000034");
});

test("an item barcode counts one unit per scan, by barcode or by code", () => {
  let s = { rows: rows(), current: null as number | null };
  for (let i = 0; i < 3; i++) s = scan(s, "6221000000010").state;
  const r = scan(s, "CH-1");
  expect(rowTotal(r.state.rows[0])).toBe(4);
  expect(r.outcome).toMatchObject({ kind: "counted", total: 4, demand: 3 }); // over the request: the screen warns
});

test("a tracked item asks for its lot, then lots count per lot; serial numbers refuse duplicates", () => {
  let s = { rows: rows(), current: null as number | null };
  let r = scan(s, "6221000000034");
  expect(r.outcome).toMatchObject({ kind: "need_lot", name: "Juice" });
  s = r.state;
  s = scan(s, "L1").state;
  s = scan(s, "L1").state;
  r = scan(s, "L2");
  expect(r.state.rows[1].entries).toEqual([{ lot: "L1", qty: "2" }, { lot: "L2", qty: "1" }]);
  expect(rowTotal(r.state.rows[1])).toBe(3);

  s = scan(r.state, "6221000000041").state; // milk is serial
  s = scan(s, "SN-1").state;
  const dup = scan(s, "SN-1");
  expect(dup.outcome).toMatchObject({ kind: "duplicate_serial", lot: "SN-1" });
  expect(rowTotal(dup.state.rows[2])).toBe(1);
});

test("a GS1 scan gives item and lot at once; a lot with no item to attach to is refused", () => {
  const s = { rows: rows(), current: null as number | null };
  const r = scan(s, "(01)06221000000034(10)LOT-9");
  expect(r.outcome).toMatchObject({ kind: "counted", name: "Juice", lot: "LOT-9" });
  expect(r.state.rows[1].entries).toEqual([{ lot: "LOT-9", qty: "1" }]);
  const lost = scan(s, "SOME-LOT"); // two tracked items and no item scanned first
  expect(lost.outcome).toMatchObject({ kind: "no_item_for_lot" });
  expect(scan(s, "999").outcome.kind).toBe("no_item_for_lot");
  expect(applyScan(s, [plain], "999").outcome.kind).toBe("unknown");
});

test("the only tracked item takes a lot without scanning the item first; auto-numbered lots count by item", () => {
  const only = [plain, juice];
  const s = { rows: rows().slice(0, 2), current: null as number | null };
  const r = applyScan(s, only, "L-5");
  expect(r.outcome).toMatchObject({ kind: "counted", lot: "L-5", name: "Juice" });
  const auto = { ...juice, autoLot: true };
  const a = applyScan(s, [plain, auto], "6221000000034");
  expect(a.outcome).toMatchObject({ kind: "counted", total: 1 });
  expect(a.state.rows[1].entries).toEqual([{ lot: "", qty: "1" }]);
  expect(expect).toBeTruthy();
});
