import datetime

from odoo import fields
from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestReconcileTour(HttpCase):

    def test_wizard_in_the_browser(self):
        today = fields.Date.context_today(self.env.user)
        partner = self.env['res.partner'].create({'name': 'Tour Reco Customer'})
        invoice = self.env['account.move'].create({
            'move_type': 'out_invoice', 'partner_id': partner.id, 'invoice_date': today,
            'invoice_line_ids': [(0, 0, {'name': 'goods', 'quantity': 1, 'price_unit': 100, 'tax_ids': False})]})
        invoice.action_post()
        bank = self.env['account.journal'].search([('type', '=', 'bank'), ('company_id', '=', self.env.company.id)], limit=1)
        self.env['account.payment'].with_context(force_payment_move=True).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': partner.id, 'amount': 60,
            'date': today, 'journal_id': bank.id}).action_post()
        self.start_tour('/odoo/action-smart_reconciliation.smart_reconcile_wizard_action', 'smart_reconcile_tour',
                        login='admin')
        self.assertEqual(invoice.amount_residual, 40)
