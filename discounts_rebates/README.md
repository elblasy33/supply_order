# Discounts & Rebates (`discounts_rebates`)

**Conditional discount** (menu *Discounts → Conditional Discounts*): "unit price above X → discount Y" (percentage or amount per
unit), optional product/category scope, dates, sales/purchases/both. Applied automatically on sale, purchase and supply order
lines; a discount that already comes from a price list is never stacked; a manual change is kept.

**Rebate programs** (deferred discount, kept apart from the instant invoice discount):

- per program: sales *or* purchases, period (daily, weekly, monthly, custom), partners/products/categories, tiers (percentage, fixed amount or free products). The highest tier reached applies to the whole turnover of the period.

- turnover = net untaxed amount of posted invoices minus credit notes in the period; a daily cron computes every closed period once (re-running never duplicates); *Rebates Entitled* lists what each customer/vendor is owed (list + pivot).

- **Provision** books it (customer: expense / accrued payable; vendor: accrued receivable / rebate income). **Issue credit note** creates the customer credit note (or vendor credit note) against the *accrued* account, so revenue/purchases are not reduced a second time and the accrued account returns to zero.

- free products: a zero-price draft supply order for the partner.

**Accounts**: Company → *Discounts & Rebates* has the four accounts and the journal. The button creates a *proposal*
(codes RBT01…RBT04, journal REB) to review with the accountant; taxes on rebate notes are not applied by default.

Tests: `odoo-bin -c odoo.conf -d supply_dev -u discounts_rebates --test-tags /discounts_rebates --stop-after-init`
