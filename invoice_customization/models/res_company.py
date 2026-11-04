from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    group_invoice_lines_default = fields.Boolean(
        string='Group items on printed invoices by default',
        help="New invoices start with 'Group items when printing' ticked.")
    commercial_bill_title = fields.Char(string='Commercial Bill title', default='Commercial Bill', translate=True)
    commercial_bill_show_prices = fields.Boolean(string='Show prices on the Commercial Bill', default=True)
    commercial_bill_show_notes = fields.Boolean(string='Show item notes on the Commercial Bill', default=True)
    commercial_bill_footer = fields.Text(string='Commercial Bill footer', translate=True,
                                         help="Free text printed at the bottom: bank details, origin, declaration…")
