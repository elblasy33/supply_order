from collections import OrderedDict

from odoo import api, fields, models, _
from odoo.tools import float_is_zero


class SupplyOrderLine(models.Model):
    _inherit = 'supply.order.line'

    invoice_group_name = fields.Char(
        string='Invoice Group', compute='_compute_invoice_group_name', store=True, readonly=False,
        help="Printed as one line with the other items of the same group (invoice and Commercial Bill).")

    @api.depends('product_id.invoice_group_name')
    def _compute_invoice_group_name(self):
        for line in self:
            line.invoice_group_name = line.product_id.invoice_group_name or False


class SupplyOrder(models.Model):
    _inherit = 'supply.order'

    # --- Commercial Bill -------------------------------------------------------------------
    def _get_commercial_lines(self):
        """Lines of the Commercial Bill: what was really moved (else what was asked), items of a group merged."""
        self.ensure_one()
        use_done = any(not float_is_zero(l.qty_done, precision_digits=4) for l in self.line_ids)
        buckets = OrderedDict()
        for line in self.line_ids.sorted(lambda l: (l.line_no, l.id)):
            qty = line.qty_done if use_done else line.qty_requested
            if float_is_zero(qty, precision_digits=4):
                continue
            group = (line.invoice_group_name or '').strip()
            key = (group, line.uom_id.id) if group else ('#%s' % line.id, line.uom_id.id)
            bucket = buckets.setdefault(key, {
                'no': line.line_no, 'name': group or line.product_id.display_name, 'uom': line.uom_id.name,
                'qty': 0.0, 'amount': 0.0, 'notes': []})
            bucket['qty'] += qty
            bucket['amount'] += qty * line.price_unit * (1 - (line.discount or 0.0) / 100.0)
            bucket['no'] = min(bucket['no'], line.line_no)
            if line.line_note:
                bucket['notes'].append(line.line_note)
        rows = []
        for bucket in buckets.values():
            bucket['price'] = bucket['amount'] / bucket['qty'] if bucket['qty'] else 0.0
            bucket['note'] = ' · '.join(bucket['notes'])
            rows.append(bucket)
        return rows

    def _commercial_total(self):
        return sum(row['amount'] for row in self._get_commercial_lines())

    def action_print_commercial_bill(self):
        self.ensure_one()
        return {'type': 'ir.actions.act_url', 'target': 'new',
                'url': '/report/html/invoice_customization.report_commercial_bill/%s' % self.id}

    def action_print_quotation(self):
        """Preview first (print / PDF / XLSX), same behaviour as invoices."""
        self.ensure_one()
        return {'type': 'ir.actions.act_url', 'target': 'new',
                'url': '/report/html/supply_order.report_supply_quotation/%s' % self.id}

    # --- generic preview/download support (controller) -------------------------------------
    def _ic_report_name(self):
        return 'invoice_customization.report_commercial_bill'

    def _ic_xlsx_data(self, report_name=None):
        self.ensure_one()
        if report_name == 'supply_order.report_supply_quotation':
            rows = [[l.line_no or '', l.product_id.display_name, l.qty_requested, l.uom_id.name or '',
                     l.price_unit, l.discount, ', '.join(l.tax_ids.mapped('name')), l.price_subtotal]
                    for l in self.line_ids.filtered('qty_requested').sorted(lambda l: (l.line_no, l.id))]
            return {
                'title': _('Quotation %s', self.name), 'sheet': _('Quotation'),
                'info': [(_('Partner'), self.partner_id.name or ''), (_('Supply Order No.'), self.supply_ref or ''),
                         (_('Date'), str(self.date_order.date())), (_('Currency'), self.currency_id.name)],
                'columns': ['#', _('Description'), _('Quantity'), _('Unit'), _('Unit Price'), _('Disc.%'),
                            _('Taxes'), _('Amount')],
                'rows': rows,
                'totals': [(_('Untaxed Amount'), self.amount_untaxed), (_('Taxes'), self.amount_tax),
                           (_('Total'), self.amount_total)],
                'filename': 'quotation_%s' % self.name.replace('/', '_'),
            }
        show_prices = self.company_id.commercial_bill_show_prices
        columns = ['#', _('Description'), _('Quantity'), _('Unit')] + (
            [_('Unit Price'), _('Amount')] if show_prices else [])
        rows = [[r['no'] or '', r['name'], r['qty'], r['uom']] + ([r['price'], r['amount']] if show_prices else [])
                for r in self._get_commercial_lines()]
        return {
            'title': self.company_id.commercial_bill_title or _('Commercial Bill'), 'sheet': _('Commercial Bill'),
            'info': [(_('Consignee'), self.partner_id.name or ''), (_('Supply Order No.'), self.supply_ref or ''),
                     (_('Reference'), self.name), (_('Currency'), self.currency_id.name)],
            'columns': columns, 'rows': rows,
            'totals': [(_('Total'), self._commercial_total())] if show_prices else [],
            'filename': 'commercial_bill_%s' % self.name.replace('/', '_'),
        }
