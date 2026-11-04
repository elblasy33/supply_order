from odoo import fields, models


class StockLot(models.Model):
    _inherit = 'stock.lot'

    vendor_id = fields.Many2one('res.partner', string='Vendor', index='btree_not_null',
                                help="Partner the lot was received from.")
    receipt_date = fields.Datetime(string='Received on', index=True)
