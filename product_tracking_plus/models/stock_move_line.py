from odoo import fields, models


class StockMoveLine(models.Model):
    _inherit = 'stock.move.line'

    def _prepare_new_lot_vals(self):
        vals = super()._prepare_new_lot_vals()
        picking = self.picking_id
        if picking and picking.picking_type_code == 'incoming':
            vals.setdefault('vendor_id', picking.partner_id.id)
            vals.setdefault('receipt_date', fields.Datetime.now())
        return vals
