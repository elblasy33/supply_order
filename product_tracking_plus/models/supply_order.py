from odoo import api, Command, fields, models, _
from odoo.exceptions import ValidationError


class SupplyOrder(models.Model):
    _inherit = ['supply.order', 'barcode.scan.mixin']
    _name = 'supply.order'
    _scan_lines_field = 'line_ids'
    _scan_qty_field = 'qty_requested'

    # scanning ----------------------------------------------------------------
    def _scan_line_matches(self, line, product, lot):
        return line.product_id == product and (line.lot_id == lot if lot else not line.lot_id)

    def _scan_line_vals(self, product, lot):
        vals = super()._scan_line_vals(product, lot)
        if lot:
            vals['lot_id'] = lot.id
        return vals

    def _scan_add_lot(self, lots):
        """A scanned lot goes on the line of its product that still has no lot, else on a new line."""
        pending = self.line_ids.filtered(lambda l: not l.lot_id and not l.lot_name)
        if len(lots) > 1:
            lots = lots.filtered(lambda l: l.product_id in pending.product_id)
            if len(lots) != 1:
                return self._scan_warning(_("This lot number exists for several items: scan the item first."))
        lot = lots
        line = pending.filtered(lambda l: l.product_id == lot.product_id)[:1]
        if line:
            line.lot_id = lot
            return
        same = self.line_ids.filtered(lambda l: l.lot_id == lot)[:1]
        if same:
            if lot.product_id.tracking == 'serial':
                return self._scan_warning(_("Serial number %s was already scanned.", lot.name))
            if self._scan_increment():
                same.qty_requested += 1
                return
        self.line_ids = [Command.create(self._scan_line_vals(lot.product_id, lot))]

    def _scan_unknown(self, value):
        """On a purchase, an unknown code after a tracked item is the new lot number of that item."""
        if self.order_type == 'purchase':
            line = self.line_ids.filtered(
                lambda l: l.product_id.tracking and not l.lot_id and not l.lot_name)[-1:]
            if line:
                line.lot_name = value
                return
        return super()._scan_unknown(value)

    # transfer ----------------------------------------------------------------
    def action_prepare_transfer(self):
        picking = super().action_prepare_transfer()
        for move in picking.move_ids:
            line = move.supply_line_id
            if line.lot_id and picking.picking_type_code == 'outgoing':
                move.lot_ids = [Command.set(line.lot_id.ids)]
            elif line.lot_id or line.lot_name:
                for move_line in move.move_line_ids:
                    if line.lot_id:
                        move_line.lot_id = line.lot_id
                    else:
                        move_line.lot_name = line.lot_name
        return picking


class SupplyOrderLine(models.Model):
    _inherit = 'supply.order.line'

    lot_id = fields.Many2one('stock.lot', string='Lot/Serial', domain="[('product_id', '=', product_id)]",
                             check_company=True, copy=False)
    lot_name = fields.Char(string='New Lot Name', copy=False,
                           help="Lot number to create at reception, when the lot does not exist yet.")
    lot_expiration = fields.Datetime(related='lot_id.expiration_date', string='Expires on')
    tracking = fields.Selection(related='product_id.tracking')

    @api.constrains('lot_id', 'product_id')
    def _check_lot_product(self):
        for line in self.filtered('lot_id'):
            if line.lot_id.product_id != line.product_id:
                raise ValidationError(_("Lot %(lot)s belongs to %(lot_product)s, not to %(product)s.",
                                        lot=line.lot_id.name, lot_product=line.lot_id.product_id.display_name,
                                        product=line.product_id.display_name))

    @api.onchange('product_id')
    def _onchange_product_clear_lot(self):
        if self.lot_id and self.lot_id.product_id != self.product_id:
            self.lot_id = False

    def write(self, vals):
        if 'product_id' in vals and 'lot_id' not in vals:
            changed = self.filtered(lambda l: l.lot_id and l.lot_id.product_id.id != vals['product_id'])
            if changed:
                changed.write({'lot_id': False, 'lot_name': False})
        return super().write(vals)
