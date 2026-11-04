"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { lookup } from "@/app/actions/orders";
import type { LookupPartner, LookupProduct } from "@/lib/types";

type Kind = "product" | "partner";

/** Type-ahead search against Odoo (products by name/code/barcode, partners by name/ref/phone). */
function Picker<T extends { id: number; name: string }>({
  kind, placeholder, onPick, render, autoFocus, clearOnPick, initial,
}: {
  kind: Kind; placeholder: string; onPick: (item: T) => void; render: (item: T) => React.ReactNode;
  autoFocus?: boolean; clearOnPick?: boolean; initial?: string;
}) {
  const [q, setQ] = useState(initial ?? "");
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState(initial ?? "");
  const seq = useRef(0);
  const listId = useId();
  const searching = q.trim().length >= 2 && q !== picked;
  const shown = searching ? items : [];

  useEffect(() => {
    if (q.trim().length < 2 || q === picked) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await lookup(kind, q.trim());
      if (mine !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setItems(res.data as unknown as T[]);
        setError("");
        setCursor(0);
        setOpen(true);
      } else setError(res.error);
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, picked]);

  function choose(item: T) {
    setPicked(clearOnPick ? "" : item.name);
    setQ(clearOnPick ? "" : item.name);
    setItems([]);
    setOpen(false);
    onPick(item);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        className="input ps-9 pe-9"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => shown.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open && shown[cursor]) { e.preventDefault(); choose(shown[cursor]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
      {open && (shown.length > 0 || error) && (
        <ul id={listId} role="listbox" className="card absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto p-1 shadow-lg">
          {error && <li className="px-3 py-2 text-sm text-bad">{error}</li>}
          {shown.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === cursor}
              onMouseDown={(e) => { e.preventDefault(); choose(item); }}
              onMouseEnter={() => setCursor(i)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${i === cursor ? "bg-brand-50" : ""}`}>
              {render(item)}
            </li>
          ))}
        </ul>
      )}
      {open && !loading && !error && searching && shown.length === 0 && (
        <div className="card absolute inset-x-0 top-full z-20 mt-1 px-3 py-3 text-sm text-muted">لا نتائج</div>
      )}
    </div>
  );
}

export function ProductPicker(props: { onPick: (p: LookupProduct) => void; autoFocus?: boolean; clearOnPick?: boolean; placeholder?: string }) {
  return (
    <Picker<LookupProduct>
      kind="product"
      placeholder={props.placeholder ?? "ابحث عن صنف بالاسم أو الكود أو الباركود…"}
      onPick={props.onPick}
      autoFocus={props.autoFocus}
      clearOnPick={props.clearOnPick}
      render={(p) => (
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{p.name}</span>
          <span className="num text-xs text-muted">{p.code || p.barcode}</span>
        </div>
      )}
    />
  );
}

export function PartnerPicker(props: { onPick: (p: LookupPartner) => void; placeholder?: string }) {
  return (
    <Picker<LookupPartner>
      kind="partner"
      placeholder={props.placeholder ?? "ابحث عن عميل أو مورد…"}
      onPick={props.onPick}
      render={(p) => (
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{p.name}</span>
          <span className="num text-xs text-muted">{p.ref || p.phone}</span>
        </div>
      )}
    />
  );
}
