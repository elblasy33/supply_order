# Supply Order (`supply_order`)

The supply order is the **starting point and operational hub**: every real-world event (delivery before
any document, receipt before the purchase order, item swaps, changes after confirmation, invoicing the
real quantities) starts from it or is recorded in it. Quotations, sales/purchase orders, transfers and
invoices are generated from it at any time, or linked to it afterwards.

## What it does
- `supply.order` / `supply.order.line`, free-text **Supply Order No.** (`supply_ref`) copied to every related document.
- **Prepare delivery/receipt** at any time; a sales/purchase order can be created *after* the stock moved, from the real quantities, without a second transfer (see "Odoo 20 detail" below).
- **Create Supply Order** button on existing sales/purchase orders (adopts their transfers and invoices).
- Invoice from what was really delivered/received, per actual item; the original request is kept.
- Substitution before validation, or after it (the done move is returned, never edited).
- Items added or changed in a transfer appear in the order; adding items creates a new transfer automatically.
- Original / current / change quantities, append-only **change log**, edits after confirmation limited to managers.
- Print a **Quotation** straight from the supply order (no sales order needed).
- `external.user` + `ext_user_id` context stamp: the real app user is recorded when the integration account acts.

## Odoo 20 detail the module depends on
`sale_stock` counts a move as the procurement of a sale line only if the move carries the delivery route rule
(`rule_id`) — see `sale_stock/models/sale_order_line.py:_get_outgoing_incoming_moves`. When moves are linked to a
sale line after the fact, the module also writes `rule_id` and `warehouse_id`. Tests `test_02*` guard this.

## Groups
`Supply Orders / User` and `Supply Orders / Manager` (only managers edit a confirmed order).

## Tests
`odoo-bin -c odoo.conf -d supply_dev -u supply_order --test-tags /supply_order --stop-after-init`

## Not yet covered
Lot generation, barcode, alerts, invoice grouping, Commercial Bill, discounts/rebates, mass reconciliation
(see the project concept document).
