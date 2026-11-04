from odoo import fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    invoice_group_name = fields.Char(
        string='Invoice Group',
        help="Items sharing this name are shown as one line on the printed invoice and the Commercial Bill. "
             "Stock, cost and accounting entries keep every item separate.")
