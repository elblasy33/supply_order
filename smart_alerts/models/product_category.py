from odoo import fields, models


class ProductCategory(models.Model):
    _inherit = 'product.category'

    expiry_alert_days = fields.Integer(
        string='Expiry Alert (days before)',
        help="Default alert period for lots of products of this category that have no alert period of their own.")
