from odoo import fields, models


class AccountPayment(models.Model):
    _inherit = 'account.payment'

    supply_cash_kind = fields.Selection(
        [('receipt', 'Cash receipt'), ('payment', 'Cash payment'), ('transfer', 'Treasury transfer')],
        string='Cash voucher', copy=False, index='btree_not_null', readonly=True)
