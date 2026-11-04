import functools
import inspect
import json
import logging
from datetime import timedelta

from psycopg2 import IntegrityError

from odoo import api, fields, models, _
from odoo.exceptions import AccessDenied, AccessError, MissingError, UserError, ValidationError
from odoo.fields import Domain

_logger = logging.getLogger(__name__)

# Which app roles may run which operation (proposal, to be confirmed by the business).
# Applied only when the caller is the integration user: Odoo users keep their normal access rights.
ROLE_MATRIX = {
    'order_create': {'sales', 'manager'},
    'order_from_document': {'sales', 'manager'},
    'confirm': {'sales', 'manager'},
    'cancel': {'sales', 'manager'},
    'reset_draft': {'sales', 'manager'},
    'close': {'manager'},
    'create_sale_order': {'sales', 'manager'},
    'create_purchase_order': {'sales', 'manager'},
    'prepare_transfer': {'warehouse', 'manager'},
    'create_invoice': {'accountant', 'manager'},
    'line_add': {'sales', 'warehouse', 'manager'},
    'line_update': {'sales', 'warehouse', 'manager'},
    'line_remove': {'sales', 'warehouse', 'manager'},
    'line_substitute': {'warehouse', 'manager'},
    'scan': {'sales', 'warehouse', 'manager'},
    'reconcile': {'accountant', 'manager'},
    'rebate_action': {'accountant', 'manager'},
}
# After confirmation the sales role can no longer change items (warehouse and managers can).
DRAFT_ONLY_ROLES = {'sales'}
LINE_ACTIONS = ('line_add', 'line_update', 'line_remove', 'line_substitute')


class ApiError(Exception):
    """An error the app should show as such (``code`` is one of the contract's error codes)."""

    def __init__(self, code, message, field=None):
        super().__init__(message)
        self.code, self.message, self.field = code, message, field


def _error(code, message, field=None):
    return {'ok': False, 'error': {'code': code, 'message': message, 'field': field or ''}}


def endpoint(write=False):
    """Wrap a service method: business errors become ``{ok: false, error}`` (the transaction part of the
    call is rolled back), successes are ``{ok: true, data}``; writes honour ``idempotency_key``."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(self, *args, idempotency_key=None, **kwargs):
            name = func.__name__
            key = idempotency_key if write and idempotency_key else None
            if key:
                done = self.env['supply.api.request'].sudo().search(
                    [('key', '=', key), ('user_id', '=', self.env.uid)], limit=1)
                if done:
                    if done.method != name:
                        return _error('conflict', _("This idempotency key was used for another operation."))
                    return json.loads(done.response)
            try:
                with self.env.cr.savepoint():
                    result = {'ok': True, 'data': func(self, *args, **kwargs)}
                    if isinstance(result['data'], dict) and '_page' in result['data']:
                        page = result['data'].pop('_page')
                        result = dict({'ok': True, 'data': page.pop('data')}, **page)
                    if key:
                        self.env['supply.api.request'].sudo().create({
                            'key': key, 'method': name, 'response': json.dumps(result, default=str)})
            except ApiError as exc:
                return _error(exc.code, exc.message, exc.field)
            except (AccessError, AccessDenied) as exc:
                return _error('access_denied', str(exc.args[0]) if exc.args else _("Access denied."))
            except MissingError as exc:
                return _error('not_found', str(exc.args[0]) if exc.args else _("Record not found."))
            except ValidationError as exc:
                return _error('validation_error', str(exc.args[0]) if exc.args else '')
            except UserError as exc:
                return _error('user_error', str(exc.args[0]) if exc.args else '')
            except IntegrityError:
                return _error('conflict', _("The same request is already being processed."))
            return result
        if write:
            # JSON-2 checks the arguments against the signature: ``idempotency_key`` must be part of it
            params = list(inspect.signature(func).parameters.values())
            params.append(inspect.Parameter('idempotency_key', inspect.Parameter.KEYWORD_ONLY, default=None))
            wrapper.__signature__ = inspect.Signature(params)
        return wrapper
    return decorator


class SupplyApi(models.AbstractModel):
    """Thin, id-based facade over the supply order models for the Next.js server (JSON-2).

    No business rule lives here: every method delegates to the service methods of the models and only
    converts records to dictionaries, checks the app role and turns exceptions into envelopes.
    """
    _name = 'supply.api'
    _description = 'Supply Orders API'

    # ------------------------------------------------------------------
    # actor / roles
    # ------------------------------------------------------------------
    def _service_user_id(self):
        return self.env['ir.config_parameter'].sudo().get_int('supply_order.service_user_id')

    def _actor(self):
        """The app user acting through the integration account (empty for a normal Odoo user)."""
        if not self._service_user_id() or self.env.uid != self._service_user_id():
            return self.env['external.user']
        ext_id = self.env.context.get('ext_user_id')
        ext = self.env['external.user'].sudo().browse(int(ext_id)).exists() if ext_id else self.env['external.user']
        return ext if ext.active else self.env['external.user']

    def _role_allows(self, action, order=None):
        """True when the current caller may run ``action`` (always true for a normal Odoo user)."""
        if not self._service_user_id() or self.env.uid != self._service_user_id():
            return True
        ext = self._actor()
        roles = ROLE_MATRIX.get(action)
        if not ext or (roles is not None and ext.role not in roles):
            return False
        if action in LINE_ACTIONS and order is not None and order.state != 'draft' and ext.role in DRAFT_ONLY_ROLES:
            return False
        return True

    def _require(self, action, order=None):
        if self._role_allows(action, order):
            return
        if not self._actor() and self._service_user_id() == self.env.uid:
            raise ApiError('access_denied', _("The app user is missing or inactive."))
        raise ApiError('access_denied', _("Your role is not allowed to do this."))

    # ------------------------------------------------------------------
    # records
    # ------------------------------------------------------------------
    def _get(self, model, rid, field='id'):
        record = self.env[model].browse(int(rid or 0)).exists()
        if not record:
            raise ApiError('not_found', _("The record no longer exists."), field)
        record.check_access('read')
        return record

    @staticmethod
    def _iso(value):
        return value.strftime('%Y-%m-%dT%H:%M:%SZ') if value else None

    # ------------------------------------------------------------------
    # serialisation
    # ------------------------------------------------------------------
    def _product(self, product):
        if not product:
            return None
        return {'id': product.id, 'name': product.display_name, 'barcode': product.barcode or '',
                'tracking': product.tracking or 'none', 'uom': product.uom_id.name}

    def _line(self, line):
        lot = line.lot_id
        return {
            'id': line.id, 'line_no': line.line_no, 'product': self._product(line.product_id),
            'requested_product': self._product(line.requested_product_id),
            'substitution_reason': line.substitution_reason or '',
            'origin': line.line_origin, 'note': line.line_note or '',
            'qty_initial': line.qty_initial, 'qty_requested': line.qty_requested, 'qty_change': line.qty_change,
            'qty_done': line.qty_done, 'qty_invoiced': line.qty_invoiced, 'qty_unplanned': line.qty_unplanned,
            'uom': line.uom_id.name, 'price_unit': line.price_unit, 'discount': line.discount,
            'taxes': line.tax_ids.mapped('name'), 'invoice_group': line.invoice_group_name or '',
            'lot': {'id': lot.id, 'name': lot.name, 'expiration_date': self._iso(lot.expiration_date)} if lot else None,
            'lot_name': line.lot_name or '', 'subtotal': line.price_subtotal,
        }

    def _documents(self, order):
        docs = []
        for so in order.sale_order_ids:
            docs.append({'model': 'sale.order', 'id': so.id, 'name': so.name, 'state': so.state, 'kind': 'sale'})
        for po in order.purchase_order_ids:
            docs.append({'model': 'purchase.order', 'id': po.id, 'name': po.name, 'state': po.state, 'kind': 'purchase'})
        for pick in order.picking_ids:
            kind = {'outgoing': 'delivery', 'incoming': 'receipt'}.get(pick.picking_type_code, 'transfer')
            docs.append({'model': 'stock.picking', 'id': pick.id, 'name': pick.name, 'state': pick.state, 'kind': kind})
        for inv in order.invoice_ids:
            kind = {'out_invoice': 'invoice', 'in_invoice': 'vendor_bill',
                    'out_refund': 'credit_note', 'in_refund': 'vendor_credit_note'}.get(inv.move_type, 'invoice')
            docs.append({'model': 'account.move', 'id': inv.id, 'name': inv.name or '', 'state': inv.state, 'kind': kind})
        return docs

    def _change_log(self, order):
        return [{
            'date': self._iso(entry.create_date), 'type': entry.change_type, 'item': entry.line_desc or '',
            'old': entry.old_value or '', 'new': entry.new_value or '', 'reason': entry.reason or '',
            'user': entry.user_id.name or '', 'app_user': entry.ext_user_id.name or '',
        } for entry in order.change_log_ids.sorted('id', reverse=True)]

    def _allowed_actions(self, order):
        """What the UI may offer now: from the order state and Odoo's own rules, then the caller's role."""
        actions = ['print']
        live_sales = order.sale_order_ids.filtered(lambda s: s.state != 'cancel')
        live_purchases = order.purchase_order_ids.filtered(lambda p: p.state != 'cancel')
        if order.state == 'draft':
            actions += ['edit', 'add_line', 'confirm', 'cancel']
        elif order.state == 'confirmed':
            actions += ['edit', 'add_line', 'substitute', 'close']
            if any(l.qty_unplanned > 0 for l in order.line_ids):
                actions.append('prepare_transfer')
            if order.line_ids._get_invoiceable():
                actions.append('create_invoice')
            if not order.line_ids.filtered('qty_done') and not order.invoice_ids.filtered(lambda m: m.state == 'posted'):
                actions.append('cancel')
        elif order.state == 'cancel':
            actions.append('reset_draft')
        if order.state in ('draft', 'confirmed'):
            if order.order_type == 'sale' and not live_sales:
                actions.append('create_sale_order')
            if order.order_type == 'purchase' and not live_purchases:
                actions.append('create_purchase_order')
        matrix_key = {'edit': 'line_update', 'add_line': 'line_add', 'substitute': 'line_substitute', 'print': None}
        return [a for a in actions if matrix_key.get(a, a) is None
                or self._role_allows(matrix_key.get(a, a), order)]

    def _order_data(self, order, detail=True):
        data = {
            'id': order.id, 'name': order.name, 'supply_ref': order.supply_ref or '', 'order_type': order.order_type,
            'state': order.state, 'fulfillment_state': order.fulfillment_state, 'invoice_state': order.invoice_state,
            'partner': {'id': order.partner_id.id, 'name': order.partner_id.name},
            'currency': order.currency_id.name, 'date_order': self._iso(order.date_order),
            'amount_untaxed': order.amount_untaxed, 'amount_tax': order.amount_tax, 'amount_total': order.amount_total,
            'note': order.note or '', 'line_count': len(order.line_ids),
            'linked_supply_id': order.linked_supply_id.id or None,
        }
        if detail:
            data.update(
                lines=[self._line(l) for l in order.line_ids.sorted(lambda l: (l.line_no, l.id))], documents=self._documents(order),
                change_log=self._change_log(order), allowed_actions=self._allowed_actions(order),
                grouping_warning=self._grouping_warning(order))
        return data

    def _grouping_warning(self, order):
        """Same warning as the invoice: groups mixing taxes, units or discounts are not merged when printed."""
        groups = {}
        for line in order.line_ids:
            name = (line.invoice_group_name or '').strip()
            if name:
                groups.setdefault(name, set()).add((tuple(line.tax_ids.ids), line.uom_id.id, line.discount))
        clashing = sorted(name for name, kinds in groups.items() if len(kinds) > 1)
        if not clashing:
            return ''
        return _("These groups mix different taxes, units or discounts, so their items are not merged "
                 "on the printed invoice: %s", ', '.join(clashing))

    # ------------------------------------------------------------------
    # values coming from the app
    # ------------------------------------------------------------------
    LINE_FIELDS = {
        'product_id': 'product_id', 'qty_requested': 'qty_requested', 'price_unit': 'price_unit',
        'discount': 'discount', 'note': 'line_note', 'invoice_group': 'invoice_group_name',
        'lot_id': 'lot_id', 'lot_name': 'lot_name',
    }

    def _line_vals(self, values):
        unknown = set(values or {}) - set(self.LINE_FIELDS)
        if unknown:
            raise ApiError('validation_error', _("Unknown line field: %s", ', '.join(sorted(unknown))),
                           sorted(unknown)[0])
        return {self.LINE_FIELDS[k]: v for k, v in (values or {}).items()}

    def _reason(self, reason):
        return {'change_reason': reason or ''}

    # ------------------------------------------------------------------
    # orders
    # ------------------------------------------------------------------
    @api.model
    @api.readonly
    @endpoint()
    def order_search(self, query=None, state=None, order_type=None, invoice_state=None, offset=0, limit=50):
        domain = Domain.TRUE
        if query:
            domain &= (Domain('name', 'ilike', query) | Domain('supply_ref', 'ilike', query)
                       | Domain('partner_id.name', 'ilike', query) | Domain('line_ids.product_id.name', 'ilike', query))
        if state:
            domain &= Domain('state', 'in', state)
        if order_type:
            domain &= Domain('order_type', '=', order_type)
        if invoice_state:
            domain &= Domain('invoice_state', '=', invoice_state)
        Order = self.env['supply.order']
        limit = max(1, min(int(limit or 50), 200))
        orders = Order.search(domain, offset=int(offset or 0), limit=limit, order='id desc')
        return {'_page': {'data': [self._order_data(o, detail=False) for o in orders],
                          'total': Order.search_count(domain), 'offset': int(offset or 0), 'limit': limit}}

    @api.model
    @api.readonly
    @endpoint()
    def order_read(self, id):
        return self._order_data(self._get('supply.order', id))

    @api.model
    @endpoint(write=True)
    def order_create(self, partner_id, order_type, supply_ref=None, linked_supply_id=None, note=None, lines=None):
        self._require('order_create')
        if order_type not in ('sale', 'purchase'):
            raise ApiError('validation_error', _("order_type must be 'sale' or 'purchase'."), 'order_type')
        self._get('res.partner', partner_id, 'partner_id')
        vals = {'partner_id': partner_id, 'order_type': order_type, 'supply_ref': supply_ref or False,
                'note': note or False}
        if linked_supply_id:
            vals['linked_supply_id'] = self._get('supply.order', linked_supply_id, 'linked_supply_id').id
        vals['line_ids'] = [(0, 0, self._line_vals(l)) for l in (lines or [])]
        return self._order_data(self.env['supply.order'].create(vals))

    @api.model
    @endpoint(write=True)
    def order_from_document(self, model, id):
        self._require('order_from_document')
        if model not in ('sale.order', 'purchase.order'):
            raise ApiError('validation_error', _("model must be 'sale.order' or 'purchase.order'."), 'model')
        document = self._get(model, id)
        action = document.action_create_supply_order()
        return self._order_data(self.env['supply.order'].browse(action['res_id']))

    ORDER_ACTIONS = {
        'confirm': 'action_confirm', 'cancel': 'action_cancel', 'close': 'action_close',
        'reset_draft': 'action_reset_draft', 'prepare_transfer': 'action_prepare_transfer',
        'create_sale_order': 'action_create_sale_order', 'create_purchase_order': 'action_create_purchase_order',
        'create_invoice': 'action_create_invoice',
    }

    @api.model
    @endpoint(write=True)
    def order_action(self, id, action):
        if action not in self.ORDER_ACTIONS:
            raise ApiError('validation_error', _("Unknown action: %s", action), 'action')
        order = self._get('supply.order', id)
        self._require(action, order)
        result = getattr(order, self.ORDER_ACTIONS[action])()
        data = self._order_data(order)
        if isinstance(result, models.BaseModel) and result:
            data['created'] = {'model': result._name, 'id': result.id, 'name': result.display_name}
        return data

    # ------------------------------------------------------------------
    # lines
    # ------------------------------------------------------------------
    @api.model
    @endpoint(write=True)
    def line_add(self, order_id, line, reason=None):
        order = self._get('supply.order', order_id, 'order_id')
        self._require('line_add', order)
        vals = dict(self._line_vals(line), order_id=order.id)
        self.env['supply.order.line'].with_context(**self._reason(reason)).create(vals)
        return self._order_data(order)

    @api.model
    @endpoint(write=True)
    def line_update(self, line_id, values=None, line_no=None, reason=None):
        line = self._get('supply.order.line', line_id, 'line_id')
        self._require('line_update', line.order_id)
        vals = self._line_vals(values)
        if 'product_id' in vals and line.order_id.state != 'draft':
            raise ApiError('user_error', _("Use the substitute operation to change an item after confirmation."),
                           'product_id')
        line = line.with_context(**self._reason(reason))
        if vals:
            line.write(vals)
        if line_no:
            line.write({'line_no': int(line_no)})
        return self._order_data(line.order_id)

    @api.model
    @endpoint(write=True)
    def line_remove(self, line_id, reason=None):
        line = self._get('supply.order.line', line_id, 'line_id')
        order = line.order_id
        self._require('line_remove', order)
        line.with_context(**self._reason(reason)).unlink()
        return self._order_data(order)

    @api.model
    @endpoint(write=True)
    def line_substitute(self, line_id, product_id, reason, return_done=False):
        line = self._get('supply.order.line', line_id, 'line_id')
        self._require('line_substitute', line.order_id)
        if not (reason or '').strip():
            raise ApiError('validation_error', _("A reason is required to substitute an item."), 'reason')
        product = self._get('product.product', product_id, 'product_id')
        line.action_substitute(product, reason, return_done=bool(return_done))
        return self._order_data(line.order_id)

    # ------------------------------------------------------------------
    # scanning
    # ------------------------------------------------------------------
    @api.model
    @endpoint(write=True)
    def scan(self, order_id, code):
        order = self._get('supply.order', order_id, 'order_id')
        self._require('scan', order)
        code = (code or '').strip()
        if not code:
            raise ApiError('validation_error', _("Nothing was scanned."), 'code')
        product = order._scan_find_product(code)
        lots = order._scan_find_lot(code) if not product else order.env['stock.lot']
        before = {l.id: (l.qty_requested, l.lot_id.id, l.lot_name) for l in order.line_ids}
        warning = order._scan_process(code)
        after = {l.id: (l.qty_requested, l.lot_id.id, l.lot_name) for l in order.line_ids}
        order.invalidate_recordset(['line_ids'])
        message = ''
        if warning:
            message = warning['warning']['message']
            outcome = 'unknown' if not (product or lots) else ('ambiguous' if len(lots) > 1 else 'rejected')
        else:
            added = set(after) - set(before)
            changed = [i for i in after if i in before and after[i] != before[i]]
            if product:
                outcome = 'product_added' if added else 'quantity_increased'
            elif lots:
                outcome = 'lot_added' if added else ('lot_attached' if changed and after[changed[0]][1] != before[changed[0]][1]
                                                     else 'quantity_increased')
            else:
                outcome = 'new_lot_name'
        return {'outcome': outcome, 'message': message, 'order': self._order_data(order)}

    # ------------------------------------------------------------------
    # printing
    # ------------------------------------------------------------------
    PRINT_KINDS = {
        'quotation': ('supply.order', 'supply_order.report_supply_quotation'),
        'commercial_bill': ('supply.order', 'invoice_customization.report_commercial_bill'),
        'invoice': ('account.move', 'account.report_invoice'),
    }

    @api.model
    @api.readonly
    @endpoint()
    def document_links(self, kind, order_id=None, invoice_id=None):
        if kind not in self.PRINT_KINDS:
            raise ApiError('validation_error', _("Unknown document kind: %s", kind), 'kind')
        model, _report = self.PRINT_KINDS[kind]
        record = self._get(model, order_id if model == 'supply.order' else invoice_id,
                           'order_id' if model == 'supply.order' else 'invoice_id')
        base = '/supply_api/print/%s/%%s/%s' % (kind, record.id)
        return {'preview': base % 'html', 'pdf': base % 'pdf', 'xlsx': base % 'xlsx'}

    # ------------------------------------------------------------------
    # alerts
    # ------------------------------------------------------------------
    @api.model
    @api.readonly
    @endpoint()
    def alerts(self, kind, filter=None, offset=0, limit=50):
        limit = max(1, min(int(limit or 50), 200))
        offset = int(offset or 0)
        if kind == 'expiry':
            return self._expiry_alerts(filter, offset, limit)
        if kind == 'auto_purchase':
            return self._auto_purchase_alerts(filter, offset, limit)
        raise ApiError('validation_error', _("kind must be 'expiry' or 'auto_purchase'."), 'kind')

    def _expiry_alerts(self, flt, offset, limit):
        now = fields.Datetime.now()
        domain = Domain('expiration_date', '!=', False)
        if flt == 'expired':
            domain &= Domain('expiry_state', '=', 'expired')
        elif flt in ('within_7', 'within_30', 'within_60'):
            days = int(flt.split('_')[1])
            domain &= Domain('expiration_date', '>', now) & Domain('expiration_date', '<=', now + timedelta(days=days))
        else:  # 'alert' or no filter: everything that reached its alert date or expired
            domain &= Domain('expiry_state', 'in', ['alert', 'expired'])
        Lot = self.env['stock.lot']
        lots = Lot.search(domain, offset=offset, limit=limit, order='expiration_date')
        data = [{'id': l.id, 'name': l.name, 'product': self._product(l.product_id),
                 'expiration_date': self._iso(l.expiration_date), 'alert_date': self._iso(l.alert_date),
                 'days_to_expiry': l.days_to_expiry, 'expiry_state': l.expiry_state,
                 'qty': l.product_qty} for l in lots]
        return {'_page': {'data': data, 'total': Lot.search_count(domain), 'offset': offset, 'limit': limit}}

    def _auto_purchase_alerts(self, flt, offset, limit):
        domain = Domain('auto_generated', '=', True)
        if flt == 'to_confirm':
            domain &= Domain('state', 'in', ['draft', 'sent'])
        elif flt == 'to_receive':
            domain &= Domain('state', '=', 'purchase') & Domain('receipt_status', '!=', 'full')
        elif flt == 'late':
            domain &= Domain('is_late_receipt', '=', True)
        Purchase = self.env['purchase.order']
        orders = Purchase.search(domain, offset=offset, limit=limit, order='id desc')
        data = [{'id': p.id, 'name': p.name, 'partner': {'id': p.partner_id.id, 'name': p.partner_id.name},
                 'state': p.state, 'receipt_status': p.receipt_status or '', 'is_late': p.is_late_receipt,
                 'date_planned': self._iso(p.date_planned), 'amount_total': p.amount_total,
                 'auto_source': p.auto_source or '', 'currency': p.currency_id.name,
                 'supply_order': ({'id': p.supply_order_id.id, 'name': p.supply_order_id.name}
                                  if p.supply_order_id else None)} for p in orders]
        return {'_page': {'data': data, 'total': Purchase.search_count(domain), 'offset': offset, 'limit': limit}}

    # ------------------------------------------------------------------
    # autocomplete
    # ------------------------------------------------------------------
    @api.model
    @api.readonly
    @endpoint()
    def lookup(self, kind, query, limit=20):
        limit = max(1, min(int(limit or 20), 50))
        query = (query or '').strip()
        if kind == 'product':
            domain = Domain('type', '=', 'consu') & (
                Domain('name', 'ilike', query) | Domain('default_code', 'ilike', query) | Domain('barcode', '=', query))
            return [dict(self._product(p), code=p.default_code or '', sale_price=p.lst_price, cost=p.standard_price)
                    for p in self.env['product.product'].search(domain, limit=limit)]
        if kind == 'partner':
            domain = Domain('name', 'ilike', query) | Domain('ref', 'ilike', query) | Domain('phone', 'ilike', query)
            return [{'id': p.id, 'name': p.name, 'ref': p.ref or '', 'phone': p.phone or ''}
                    for p in self.env['res.partner'].search(domain, limit=limit)]
        if kind == 'lot':
            return [{'id': l.id, 'name': l.name, 'product': self._product(l.product_id),
                     'expiration_date': self._iso(l.expiration_date)}
                    for l in self.env['stock.lot'].search([('name', 'ilike', query)], limit=limit)]
        raise ApiError('validation_error', _("kind must be product, partner or lot."), 'kind')

    # ------------------------------------------------------------------
    # app users
    # ------------------------------------------------------------------
    @api.model
    @endpoint(write=True)
    def ext_user_sync(self, login, name, role, external_id=None, active=True):
        """Create or update the ``external.user`` that stands for an app account."""
        if self._service_user_id() != self.env.uid and not self.env.user.has_group('supply_order.group_supply_manager'):
            raise ApiError('access_denied', _("Only the integration user may manage app users."))
        if role not in dict(self.env['external.user']._fields['role'].selection):
            raise ApiError('validation_error', _("Unknown role: %s", role), 'role')
        User = self.env['external.user'].sudo().with_context(active_test=False)
        user = User.search([('login', '=', login)], limit=1)
        vals = {'name': name, 'role': role, 'external_id': external_id or False, 'active': bool(active)}
        if user:
            user.write(vals)
        else:
            user = User.create(dict(vals, login=login))
        return {'id': user.id, 'login': user.login, 'name': user.name, 'role': user.role, 'active': user.active}

    @api.model
    @api.readonly
    @endpoint()
    def whoami(self):
        """The acting app user and what its role allows (for the UI to hide what it cannot do)."""
        ext = self._actor()
        service = self._service_user_id() == self.env.uid
        return {
            'service_user': service,
            'app_user': {'id': ext.id, 'name': ext.name, 'login': ext.login, 'role': ext.role} if ext else None,
            'operations': sorted(a for a in ROLE_MATRIX if self._role_allows(a)),
            'company': {'id': self.env.company.id, 'name': self.env.company.name,
                        'currency': self.env.company.currency_id.name},
        }

    # ------------------------------------------------------------------
    # reconciliation and rebates
    # ------------------------------------------------------------------
    def _reconcile_wizard(self, partner_id, kind, date_from, date_to, allocation_order='due'):
        if kind not in ('customer', 'vendor'):
            raise ApiError('validation_error', _("kind must be 'customer' or 'vendor'."), 'kind')
        self._get('res.partner', partner_id, 'partner_id')
        wizard = self.env['smart.reconcile.wizard'].create({
            'partner_id': partner_id, 'kind': kind, 'date_from': date_from, 'date_to': date_to,
            'allocation_order': allocation_order})
        wizard.action_load()
        return wizard

    def _open_item(self, item):
        return {
            'id': item.id, 'role': item.role, 'document': {'id': item.move_id.id, 'name': item.move_id.name},
            'date': str(item.date), 'due': str(item.date_maturity) if item.date_maturity else None,
            'open_amount': item.residual, 'currency': item.doc_currency_id.name, 'selected': item.selected}

    @api.model
    @endpoint(write=True)
    def reconcile_load(self, partner_id, kind, date_from, date_to):
        self._require('reconcile')
        wizard = self._reconcile_wizard(partner_id, kind, date_from, date_to)
        return {'invoices': [self._open_item(i) for i in wizard.line_ids.filtered(lambda l: l.role == 'invoice')],
                'payments': [self._open_item(i) for i in wizard.line_ids.filtered(lambda l: l.role == 'payment')]}

    @api.model
    @endpoint(write=True)
    def reconcile_run(self, partner_id, kind, date_from, date_to, invoice_ids, payment_ids=None,
                      allocation_order='due'):
        """``invoice_ids`` are the account.move ids to settle; payments default to all that are open."""
        self._require('reconcile')
        if allocation_order not in ('due', 'invoice'):
            raise ApiError('validation_error', _("allocation_order must be 'due' or 'invoice'."), 'allocation_order')
        wizard = self._reconcile_wizard(partner_id, kind, date_from, date_to, allocation_order)
        wanted = set(invoice_ids or [])
        for item in wizard.line_ids.filtered(lambda l: l.role == 'invoice'):
            item.selected = item.move_id.id in wanted
        if payment_ids is not None:
            allowed = set(payment_ids)
            for item in wizard.line_ids.filtered(lambda l: l.role == 'payment'):
                item.selected = item.move_id.id in allowed
        if not wanted & set(wizard.line_ids.filtered(lambda l: l.role == 'invoice').move_id.ids):
            raise ApiError('nothing_to_do', _("None of the chosen invoices is open in that period."), 'invoice_ids')
        wizard.action_reconcile()
        return {
            'batch': wizard.log_ids[:1].batch or '',
            'pairs': [{'invoice': {'id': l.invoice_id.id, 'name': l.invoice_id.name},
                       'payment': {'id': l.payment_move_id.id, 'name': l.payment_move_id.name},
                       'amount': l.amount, 'invoice_left': l.invoice_residual_after}
                      for l in wizard.log_ids.sorted('id')],
            'remaining': wizard.remaining_total,
        }

    @api.model
    @api.readonly
    @endpoint()
    def rebate_accruals(self, state=None, applies_to=None, offset=0, limit=50):
        domain = Domain.TRUE
        if state:
            domain &= Domain('state', 'in', state)
        if applies_to:
            domain &= Domain('applies_to', '=', applies_to)
        Accrual = self.env['rebate.accrual']
        limit = max(1, min(int(limit or 50), 200))
        offset = int(offset or 0)
        rows = Accrual.search(domain, offset=offset, limit=limit)
        data = [{'id': a.id, 'name': a.name, 'program': a.program_id.name, 'applies_to': a.applies_to,
                 'partner': {'id': a.partner_id.id, 'name': a.partner_id.name},
                 'date_from': str(a.date_from), 'date_to': str(a.date_to), 'turnover': a.base_amount,
                 'reward_type': a.reward_type or '', 'amount': a.amount, 'state': a.state,
                 'credit_note': {'id': a.credit_note_id.id, 'name': a.credit_note_id.name} if a.credit_note_id else None,
                 'free_goods_order': ({'id': a.supply_order_id.id, 'name': a.supply_order_id.name}
                                      if a.supply_order_id else None)} for a in rows]
        return {'_page': {'data': data, 'total': Accrual.search_count(domain), 'offset': offset, 'limit': limit}}

    REBATE_ACTIONS = {'confirm': 'action_confirm', 'settle': 'action_settle',
                      'cancel': 'action_cancel', 'reset_draft': 'action_reset_draft'}

    @api.model
    @endpoint(write=True)
    def rebate_action(self, id, action):
        self._require('rebate_action')
        if action not in self.REBATE_ACTIONS:
            raise ApiError('validation_error', _("Unknown action: %s", action), 'action')
        accrual = self._get('rebate.accrual', id)
        getattr(accrual, self.REBATE_ACTIONS[action])()
        return {'id': accrual.id, 'state': accrual.state, 'amount': accrual.amount,
                'credit_note': {'id': accrual.credit_note_id.id, 'name': accrual.credit_note_id.name}
                if accrual.credit_note_id else None}
