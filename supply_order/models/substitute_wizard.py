from odoo import fields, models


class SupplySubstituteWizard(models.TransientModel):
    _name = 'supply.substitute.wizard'
    _description = 'Substitute a supply order item'

    line_id = fields.Many2one('supply.order.line', required=True, readonly=True)
    old_product_id = fields.Many2one(related='line_id.product_id', string='Current Item')
    new_product_id = fields.Many2one('product.product', string='Substitute Item', required=True,
                                     domain=[('type', '=', 'consu')])
    reason = fields.Char(required=True)
    has_done_moves = fields.Boolean(related='line_id.has_done_moves')
    return_done = fields.Boolean(string='Also return what was already moved',
                                 help="Reverse what was already delivered/received of the current item "
                                      "with a return, and plan the full quantity again with the new item.")

    def action_substitute(self):
        self.ensure_one()
        self.line_id.action_substitute(self.new_product_id, self.reason, return_done=self.return_done)
        return {'type': 'ir.actions.act_window_close'}
