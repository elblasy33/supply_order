from collections import defaultdict
from functools import reduce

from odoo import api, fields, models, _


class AccountMove(models.Model):
    _inherit = 'account.move'

    group_invoice_lines = fields.Boolean(
        string='Group items when printing', copy=True,
        default=lambda self: self.env.company.group_invoice_lines_default,
        help="The printed invoice shows items of the same Invoice Group as one line. "
             "Journal items, stock moves and costs are not changed.")
    grouping_warning = fields.Text(compute='_compute_grouping_warning')

    # --- grouping (display only) ------------------------------------------------------------
    @staticmethod
    def _group_key(line):
        return ((line.invoice_group_name or '').strip(), line.product_uom_id.id,
                tuple(sorted(line.tax_ids.ids)), line.discount)

    def _group_buckets(self, lines):
        """Ordered buckets of product lines sharing a group name; a bucket = one printed line."""
        buckets = defaultdict(lambda: self.env['account.move.line'])
        for line in lines.filtered(lambda l: l.display_type == 'product' and (l.invoice_group_name or '').strip()):
            buckets[self._group_key(line)] |= line
        return buckets

    @api.depends('invoice_line_ids.invoice_group_name', 'invoice_line_ids.tax_ids',
                 'invoice_line_ids.product_uom_id', 'invoice_line_ids.discount', 'group_invoice_lines')
    def _compute_grouping_warning(self):
        for move in self:
            move.grouping_warning = False
            if not move.group_invoice_lines:
                continue
            clashes = move._clashing_groups(move._group_buckets(move.invoice_line_ids))
            if clashes:
                move.grouping_warning = _(
                    "These groups mix different taxes, units or discounts, so their items are not merged "
                    "on the printed invoice: %s", ', '.join(sorted(clashes)))

    def _virtual_group_line(self, name, lines):
        """An unsaved invoice line standing for ``lines`` on the printed document."""
        first = lines[0]
        qty = sum(lines.mapped('quantity'))
        gross = sum(l.quantity * l.price_unit for l in lines)
        return self.env['account.move.line'].new({
            'move_id': self.id,
            'display_type': 'product',
            'name': name,
            'label': name,  # the item name must not be prepended to the group name
            'product_id': first.product_id.id,
            'quantity': qty,
            'product_uom_id': first.product_uom_id.id,
            'price_unit': gross / qty if qty else first.price_unit,
            'discount': first.discount,
            'tax_ids': [(6, 0, first.tax_ids.ids)],
            'price_subtotal': sum(lines.mapped('price_subtotal')),
            'price_total': sum(lines.mapped('price_total')),
            'currency_id': first.currency_id.id,
            'sequence': min(lines.mapped('sequence')),
            'line_no': min(lines.mapped('line_no')),
            'line_note': ' · '.join(n for n in lines.mapped('line_note') if n),
        })

    def _clashing_groups(self, buckets):
        """Group names whose items differ in tax, unit or discount: those are never merged."""
        names = defaultdict(int)
        for key in buckets:
            names[key[0]] += 1
        return {name for name, count in names.items() if count > 1}

    def _get_move_lines_to_report(self):
        lines = super()._get_move_lines_to_report()
        if not self.group_invoice_lines:
            return lines
        buckets = self._group_buckets(lines)
        clashing = self._clashing_groups(buckets)
        buckets = {key: bucket for key, bucket in buckets.items() if key[0] not in clashing}
        grouped = reduce(lambda acc, rec: acc | rec, buckets.values(), self.env['account.move.line'])
        result, emitted = [], set()
        for line in lines:
            key = self._group_key(line) if line in grouped else None
            if key is None:
                result.append(line)
            elif key not in emitted:
                emitted.add(key)
                result.append(self._virtual_group_line(key[0], buckets[key]))
        return reduce(lambda acc, rec: acc | rec, result, self.env['account.move.line'])

    # --- print: preview first ---------------------------------------------------------------
    def _ic_report_name(self):
        self.ensure_one()
        return self.env['account.move.send']._get_default_pdf_report_id(self).report_name

    def _ic_preview_action(self):
        self.ensure_one()
        return {'type': 'ir.actions.act_url', 'target': 'new',
                'url': '/report/html/%s/%s' % (self._ic_report_name(), self.id)}

    def action_print_pdf(self):
        """Print opens a preview (print / PDF / XLSX) instead of downloading a file at once."""
        self.ensure_one()
        return self._ic_preview_action()

    # --- XLSX -------------------------------------------------------------------------------
    def _ic_xlsx_data(self):
        self.ensure_one()
        lines = self._get_move_lines_to_report()
        product_lines = lines.filtered(lambda l: l.display_type == 'product')
        return {
            'title': self.name or _('Invoice'),
            'sheet': _('Invoice'),
            'info': [(_('Partner'), self.partner_id.name or ''), (_('Date'), str(self.invoice_date or '')),
                     (_('Supply Order No.'), self.supply_ref or ''), (_('Currency'), self.currency_id.name)],
            'columns': ['#', _('Description'), _('Quantity'), _('Unit'), _('Unit Price'), _('Disc.%'),
                        _('Taxes'), _('Amount')],
            'rows': [[l.line_no or '', l.name or '', l.quantity, l.product_uom_id.name or '', l.price_unit,
                      l.discount, ', '.join(l.tax_ids.mapped('name')), l.price_subtotal] for l in product_lines],
            'totals': [(_('Untaxed Amount'), self.amount_untaxed), (_('Taxes'), self.amount_tax),
                       (_('Total'), self.amount_total)],
            'filename': (self.name or 'invoice').replace('/', '_'),
        }


class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    invoice_group_name = fields.Char(
        string='Invoice Group', compute='_compute_invoice_group_name', store=True, readonly=False)

    @api.depends('product_id.invoice_group_name', 'supply_line_id.invoice_group_name')
    def _compute_invoice_group_name(self):
        for line in self:
            line.invoice_group_name = (line.supply_line_id.invoice_group_name
                                       or line.product_id.invoice_group_name or False)
