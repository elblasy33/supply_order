export type Partner = { id: number; name: string };
export type Product = { id: number; name: string; barcode: string; code?: string; tracking: "lot" | "serial" | "none"; uom: string };

export type SupplyLine = {
  id: number;
  line_no: number;
  product: Product;
  requested_product: Product | null;
  substitution_reason: string;
  origin: "requested" | "added";
  note: string;
  qty_initial: number;
  qty_requested: number;
  qty_change: number;
  qty_done: number;
  qty_invoiced: number;
  qty_unplanned: number;
  uom: string;
  price_unit: number;
  discount: number;
  taxes: string[];
  invoice_group: string;
  lot: { id: number; name: string; expiration_date: string | null } | null;
  lot_name: string;
  subtotal: number;
};

export type LinkedDocument = {
  model: "sale.order" | "purchase.order" | "stock.picking" | "account.move";
  id: number;
  name: string;
  state: string;
  kind: string;
};

export type ChangeLogEntry = {
  date: string;
  type: "add" | "remove" | "substitute" | "qty" | "price";
  item: string;
  old: string;
  new: string;
  reason: string;
  user: string;
  app_user: string;
};

export type OrderState = "draft" | "confirmed" | "closed" | "cancel";

export type OrderSummary = {
  id: number;
  name: string;
  supply_ref: string;
  order_type: "sale" | "purchase";
  state: OrderState;
  fulfillment_state: "none" | "partial" | "done";
  invoice_state: "nothing" | "to_invoice" | "invoiced";
  partner: Partner;
  currency: string;
  date_order: string;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  note: string;
  line_count: number;
  linked_supply_id: number | null;
};

export type SupplyOrder = OrderSummary & {
  lines: SupplyLine[];
  documents: LinkedDocument[];
  change_log: ChangeLogEntry[];
  allowed_actions: string[];
  grouping_warning: string;
  created?: { model: string; id: number; name: string };
};

export type ScanResult = {
  outcome:
    | "product_added"
    | "quantity_increased"
    | "lot_attached"
    | "lot_added"
    | "new_lot_name"
    | "unknown"
    | "ambiguous"
    | "rejected";
  message: string;
  order: SupplyOrder;
};

export type ExpiryAlert = {
  id: number;
  name: string;
  product: Product;
  expiration_date: string;
  alert_date: string | null;
  days_to_expiry: number;
  expiry_state: "ok" | "alert" | "expired";
  qty: number;
};

export type AutoPurchase = {
  id: number;
  name: string;
  partner: Partner;
  state: string;
  receipt_status: string;
  is_late: boolean;
  date_planned: string | null;
  amount_total: number;
  auto_source: string;
  currency: string;
  supply_order: { id: number; name: string } | null;
};

export type OpenItem = {
  id: number;
  role: "invoice" | "payment";
  document: { id: number; name: string };
  date: string;
  due: string | null;
  open_amount: number;
  currency: string;
  selected: boolean;
};

export type RebateAccrual = {
  id: number;
  name: string;
  program: string;
  applies_to: "sale" | "purchase";
  partner: Partner;
  date_from: string;
  date_to: string;
  turnover: number;
  reward_type: string;
  amount: number;
  state: "draft" | "confirmed" | "settled" | "cancel";
  credit_note: { id: number; name: string } | null;
  free_goods_order: { id: number; name: string } | null;
};

export type LookupProduct = Product & { code: string; sale_price: number; cost: number };
export type LookupPartner = { id: number; name: string; ref: string; phone: string };

export type PickingKind = "delivery" | "receipt" | "internal";
export type PickingState = "draft" | "waiting" | "confirmed" | "assigned" | "done" | "cancel";

export type MoveEntry = {
  id: number;
  quantity: number;
  lot_name: string;
  lot: { id: number; name: string; expiration_date: string | null } | null;
};

export type PickingMove = {
  id: number;
  line_no: number;
  note: string;
  state: string;
  product: Product;
  uom: string;
  demand: number;
  quantity: number;
  picked: boolean;
  entries: MoveEntry[];
  auto_lot: boolean;
  supply_line_id: number | null;
};

export type PickingSummary = {
  id: number;
  name: string;
  state: PickingState;
  kind: PickingKind;
  partner: Partner | null;
  origin: string;
  scheduled_date: string | null;
  date_done: string | null;
  supply_order: { id: number; name: string; supply_ref: string } | null;
  backorder_of: { id: number; name: string } | null;
  move_count: number;
};

export type Picking = PickingSummary & {
  moves: PickingMove[];
  backorders: { id: number; name: string; state: string }[];
  can_edit: boolean;
  can_validate: boolean;
  can_cancel: boolean;
  can_return: boolean;
  created_backorders?: { id: number; name: string }[];
  return_picking?: { id: number; name: string };
};

export type PickingScan = {
  outcome: "quantity_increased" | "lot_entry" | "new_lot_name" | "need_lot" | "unknown" | "ambiguous" | "rejected";
  message: string;
  picking: Picking;
};

// ---- dashboard (supply.api `dashboard`)
export type DashSeriesPoint = { date: string; sale: number; purchase: number; count: number };
export type DashboardData = {
  period: { days: number; start: string; end: string; granularity: "day" | "week" | "month" };
  currency: string;
  sections: string[];
  orders?: {
    kpis: {
      orders: { value: number; previous: number };
      value: { value: number; previous: number; sale: number; purchase: number };
      fill_rate: { value: number | null; previous: number | null };
      changed_share: { value: number | null };
      to_confirm: number;
      to_invoice: number;
    };
    series: DashSeriesPoint[];
    status: Record<"draft" | "confirmed" | "closed" | "cancel", number>;
    funnel: { key: "confirmed" | "moving" | "delivered" | "invoiced"; count: number }[];
    top_items: Record<"sale" | "purchase", { product: Partner; requested: number; done: number }[]>;
    top_partners: Record<"sale" | "purchase", { partner: Partner; amount: number; orders: number }[]>;
    changes: { by_type: Record<string, number>; total: number };
  };
  warehouse?: {
    series: { date: string; delivery: number; receipt: number }[];
    heat: number[][];
    totals: { delivery: number; receipt: number; units: { delivery: number; receipt: number } };
    ready: { delivery: number; receipt: number };
  };
  expiry?: { buckets: { key: "expired" | "d7" | "d30" | "d60"; lots: number; qty: number }[] };
  rebates?: { by_state: Record<"draft" | "confirmed" | "settled", number>; open_by_kind: Record<"sale" | "purchase", number> };
};

export type CashJournal = { id: number; name: string; type: "cash" | "bank"; code: string; balance: number; currency: string; has_account: boolean };
export type CashMove = {
  id: number; name: string; kind: "receipt" | "payment" | "transfer" | "expense"; date: string; ref: string; state: string;
  journal: { id: number; name: string }; partner: { id: number; name: string } | null; amount: number; direction: "inbound" | "outbound"; counter_journal: { id: number; name: string } | null;
};
export type ExpenseRow = {
  id: number; name: string; state: string; amount: number; date: string;
  product: { id: number; name: string }; journal: { id: number; name: string };
};
export type ExpenseProduct = { id: number; name: string; code: string; cost: number };

export type PartnerBalance = { partner: { id: number; name: string }; debit: number; credit: number; balance: number; last_date: string | null };
export type StatementLine = {
  id: number; date: string; due: string | null; document: { id: number; name: string }; journal: string; label: string;
  debit: number; credit: number; balance: number; open_amount: number; reconciled: boolean;
};
export type Statement = {
  partner: { id: number; name: string; phone: string; ref: string }; kind: "customer" | "vendor";
  date_from: string | null; date_to: string | null; opening: number; debit: number; credit: number; closing: number;
  currency: string; lines: StatementLine[]; truncated: boolean;
};
