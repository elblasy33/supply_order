# Supply Orders API (`supply_api`)

The only door the Next.js app uses. It adds no business rule: every method calls the service methods of the
other modules and only converts records to JSON, checks the app role and turns errors into a clear answer.

## How it is called

`POST /json/2/supply.api/<method>` (Odoo's own JSON-2 endpoint) with `Authorization: Bearer <API key>` and a
JSON body of named arguments. The key belongs to the *integration user* and stays on the Next.js server. The app
user who really acts travels in `context.ext_user_id`; Odoo records it on the order, the lines, the change log and
the chatter, and honours it only for the integration user.

Every method answers HTTP 200 with `{ok: true, data}` or `{ok: false, error: {code, message, field}}` where
`code` is `user_error`, `validation_error`, `access_denied`, `not_found`, `conflict` or
`nothing_to_do`. The part of the call that failed is rolled back. Malformed calls and bad keys are plain HTTP
errors (401, 404, 422) produced by Odoo itself. Lists return `total`, `offset` and `limit` (200 at most).

## Idempotent writes

Every write accepts `idempotency_key`. Repeating a successful call with the same key returns the first answer and
repeats nothing; using the key for another operation is a `conflict`. Failed calls are not remembered, so they
can be retried. Keys are kept seven days.

## Methods

* Orders: `order_search`, `order_read`, `order_create`, `order_from_document`, `order_action`
  (confirm, cancel, close, reset_draft, prepare_transfer, create_sale_order, create_purchase_order, create_invoice)
* Lines: `line_add`, `line_update`, `line_remove`, `line_substitute`, `scan`
* Printing: `document_links`
* Alerts and lookups: `alerts` (expiry, automatic purchases), `lookup` (product, partner, lot)
* Accounting: `reconcile_load`, `reconcile_run`, `rebate_accruals`, `rebate_action`
* Users: `ext_user_sync`, `whoami`

## Printing with the key

`GET /supply_api/print/<kind>/<html|pdf|xlsx>/<id>` with the same Bearer key (`kind`: `quotation`,
`commercial_bill` for supply orders, `invoice` for invoices). The Next.js server fetches the file and streams it
to the browser, so the key is never exposed. `?lang=ar_001` selects the language.

## Roles

Roles are those of `external.user` (sales, warehouse, accountant, manager). They are checked again here,
only when the caller is the integration user (a normal Odoo user keeps the access rights of Odoo). The table is
`ROLE_MATRIX` in `models/supply_api.py`; it is a **proposal** to confirm with the business:

* sales: create orders, confirm / cancel, create sale or purchase orders, edit items **while the order is a draft**
* warehouse: prepare transfers, add / change / remove / substitute items on confirmed orders, scan
* accountant: invoices, reconciliation, rebates
* manager: everything, including closing an order

`order_read` returns `allowed_actions` already filtered by the role of the acting app user.

## Setup

1. Create a user for the integration (internal user in the group *Supply Orders / Manager*, plus the accounting and
   stock rights it needs) and generate an API key for it.
2. Set the system parameter `supply_order.service_user_id` to that user's id.
3. Create the app users (`ext_user_sync` or *Supply Orders → Configuration → App Users*).

## Tests

`odoo-bin -c odoo.conf -d supply_dev -u supply_api --test-tags /supply_api --stop-after-init`

They call the service as the integration user, go through the real JSON-2 and print routes over HTTP, and render
real PDFs (needs `wkhtmltopdf` and `pdftotext`; skipped otherwise).
