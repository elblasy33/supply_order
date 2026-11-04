# Smart Reconciliation (`smart_reconciliation`)

*Accounting → Reconciliation → Reconcile Invoices*: pick a customer or vendor and a period, load their open invoices, payments and
credit notes, **tick the invoices you want**, press *Reconcile*. Payments are applied to the ticked invoices only (oldest due
date first, or oldest invoice first), partially when needed, never beyond what is available, using Odoo's own reconciliation
(currency differences included). The screen shows what is left; every pairing is written to an append-only log
(*Reconciliation Log*). If anything fails, nothing is reconciled.

Note: with Accounting installed, Odoo books a payment only when it is matched with the bank statement; a payment without a
journal entry has nothing to reconcile and is not listed.
