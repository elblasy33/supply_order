from odoo import api, models


class SaleOrderLine(models.Model):
    _inherit = ['sale.order.line', 'line.numbering.mixin']
    _name = 'sale.order.line'
    _line_parent_field = 'order_id'

    def _is_numbered_line(self):
        return not self.display_type

    def _prepare_invoice_line(self, **optional_values):
        vals = super()._prepare_invoice_line(**optional_values)
        vals.update(line_no=self.line_no, line_note=self.line_note)
        return vals


class PurchaseOrderLine(models.Model):
    _inherit = ['purchase.order.line', 'line.numbering.mixin']
    _name = 'purchase.order.line'
    _line_parent_field = 'order_id'

    def _is_numbered_line(self):
        return not self.display_type

    def _prepare_account_move_line(self, move=False):
        vals = super()._prepare_account_move_line(move)
        vals.update(line_no=self.line_no, line_note=self.line_note)
        return vals


class StockMove(models.Model):
    _inherit = ['stock.move', 'line.numbering.mixin']
    _name = 'stock.move'
    _line_parent_field = 'picking_id'

    @api.model_create_multi
    def create(self, vals_list):
        """Moves generated from a sale/purchase line keep its number and note."""
        for vals in vals_list:
            source = False
            if vals.get('sale_line_id'):
                source = self.env['sale.order.line'].browse(vals['sale_line_id'])
            elif vals.get('purchase_line_id'):
                source = self.env['purchase.order.line'].browse(vals['purchase_line_id'])
            if source:
                if not vals.get('line_no') and source.line_no:
                    vals['line_no'] = source.line_no
                if not vals.get('line_note') and source.line_note:
                    vals['line_note'] = source.line_note
        return super().create(vals_list)


class AccountMoveLine(models.Model):
    _inherit = ['account.move.line', 'line.numbering.mixin']
    _name = 'account.move.line'
    _line_parent_field = 'move_id'
    _line_sync_sequence = False  # the invoice line sequence is computed by accounting

    def _is_numbered_line(self):
        return self.display_type == 'product'
