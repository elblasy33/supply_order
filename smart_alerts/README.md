# Smart Alerts (`smart_alerts`)

- **Expiry alerts** (on top of `product_expiry`): default alert period per product category (used when the product has none), `Expiry Alerts` menu with filters (alert reached / expired / within 7-30-60 days), and an activity for every stock manager (in addition to the product's responsible) the first time a lot reaches its alert date.

- **Automatic purchase orders** (replenish on order or reordering rule) are flagged, announced to the purchase managers, linked to the supply order that caused them, tracked until received (`Automatic Purchases` menu), and a daily cron warns once when one is late.
