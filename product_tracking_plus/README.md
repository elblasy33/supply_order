# Product Tracking Plus (`product_tracking_plus`)

- **Automatic lot numbers**: per product, `Auto-generate Lot Numbers` + a pattern (`{code}-{date}-{seq}` by default;
  tokens `{code}`, `{date}`, `{vendor}`, `{seq}` / `{seq:4}`). Numbers are given at receipt validation, never repeat, and
  the lot records its vendor and receipt date. The expiry date still comes from `product_expiry`.
- **Scan field** on supply orders, sales orders and purchase orders: scan a barcode (keyboard-wedge scanner + Enter),
  the product is added or its quantity raised (setting `Increase quantity on repeated scan`, Inventory settings, Barcode),
  the field is cleared and stays focused.
- **Lot scanning** on supply orders: after a product, scan its lot (delivery: the move reserves that lot; receipt: an unknown
  code becomes the new lot name); a lot scanned alone adds its product. The line shows the lot expiry date. A lot of another
  product is refused.
- Transfers (pickings) keep using Odoo's own Barcode app (`stock_barcode`, Enterprise).

Browser test: `tests/test_scan_tour.py` (Chrome headless).
