from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    # Item notes: shown on the printed document, per document type
    print_note_sale = fields.Boolean(string='Notes on quotations / orders', default=True)
    print_note_invoice = fields.Boolean(string='Notes on invoices / bills', default=True)
    print_note_purchase = fields.Boolean(string='Notes on RFQ / purchase orders', default=True)
    print_note_delivery = fields.Boolean(string='Notes on delivery slips', default=True)
    # Line numbers (quotations / orders use Odoo's own "Line Numbers" setting, fed by our editable number)
    print_lineno_invoice = fields.Boolean(string='Line numbers on invoices / bills')
    print_lineno_purchase = fields.Boolean(string='Line numbers on RFQ / purchase orders')
    print_lineno_delivery = fields.Boolean(string='Line numbers on delivery slips')
