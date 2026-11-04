from odoo import models


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def _generate_missing_lot_names(self):
        """Give a lot name to receipt lines of auto-numbered products that have none yet."""
        for picking in self.filtered(lambda p: p.picking_type_code == 'incoming'):
            taken = {}
            for line in picking.move_line_ids:
                product = line.product_id
                if (product.tracking != 'lot' or not product.product_tmpl_id.lot_auto_generate
                        or line.lot_id or line.lot_name or not line.quantity):
                    continue
                names = taken.setdefault(product.id, set())
                name = product._generate_lot_name(
                    partner=picking.partner_id, date=picking.scheduled_date.date() if picking.scheduled_date else None,
                    taken=names)
                names.add(name)
                line.lot_name = name

    def button_validate(self):
        self._generate_missing_lot_names()
        return super().button_validate()
