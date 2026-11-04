/**
 * GS1 data (GS1-128, GS1 DataMatrix, GS1 QR): one scan carries the item (GTIN), the lot and the expiry date,
 * so receiving goods needs no typing and no separate lot scan.
 * Accepts the readable form "(01)…(10)…" and the raw form (with the FNC1 group separator, char 29).
 */
export type Gs1 = { gtin: string; lot?: string; serial?: string; expiry?: string; production?: string };

const GS = "\x1d";
const FIXED: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "13": 6, "15": 6, "17": 6, "20": 2 };
const VARIABLE = new Set(["10", "21", "22", "37", "240", "241", "400", "30"]);

/** YYMMDD → yyyy-mm-dd (day 00 means "end of month"; years 51–99 are 19xx per the GS1 rule). */
export function gs1Date(v: string): string | undefined {
  if (!/^\d{6}$/.test(v)) return undefined;
  const yy = Number(v.slice(0, 2));
  const year = yy <= 50 ? 2000 + yy : 1900 + yy;
  const month = Number(v.slice(2, 4));
  let day = Number(v.slice(4, 6));
  if (month < 1 || month > 12) return undefined;
  if (day === 0) day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseGs1(input: string): Gs1 | null {
  const text = input.trim().replace(/^\](C1|e0|d2|Q3)/, "");
  if (!text) return null;
  const out: Record<string, string> = {};
  if (text.includes("(")) {
    for (const m of text.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]] = m[2].replace(GS, "");
  } else {
    let i = 0;
    while (i < text.length) {
      const ai = [2, 3, 4].map((n) => text.slice(i, i + n)).find((a) => a in FIXED || VARIABLE.has(a));
      if (!ai) return null;
      i += ai.length;
      let value: string;
      if (ai in FIXED) {
        value = text.slice(i, i + FIXED[ai]);
        if (value.length !== FIXED[ai]) return null;
        i += value.length;
      } else {
        const end = text.indexOf(GS, i);
        value = end === -1 ? text.slice(i) : text.slice(i, end);
        i += value.length + (end === -1 ? 0 : 1);
      }
      out[ai] = value;
    }
  }
  const gtin = out["01"] ?? out["02"];
  if (!gtin || !/^\d{14}$/.test(gtin)) return null;
  return {
    gtin,
    lot: out["10"] || undefined,
    serial: out["21"] || undefined,
    expiry: out["17"] ? gs1Date(out["17"]) : undefined,
    production: out["11"] ? gs1Date(out["11"]) : undefined,
  };
}

/** EAN-13/UPC-A/EAN-8 and GTIN-14 name the same item once the leading zeros are removed. */
export const normalizeGtin = (v: string) => v.replace(/^0+/, "");
