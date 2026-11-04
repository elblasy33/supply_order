from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    supply_barcode_increment = fields.Boolean(
        string='Increase quantity on repeated scan', default=True,
        help="When the same product is scanned again, add 1 to its line instead of adding a new line.")


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    supply_barcode_increment = fields.Boolean(related='company_id.supply_barcode_increment', readonly=False)
