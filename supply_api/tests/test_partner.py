from odoo import fields
from odoo.tests import tagged

from .test_api import ApiCase


@tagged('post_install', '-at_install')
class TestSupplyApiPartner(ApiCase):

    def post(self, partner, account_type, debit, credit, date):
        account = self.env['account.account'].search([('account_type', '=', account_type)], limit=1)
        other = self.env['account.account'].search([('account_type', '=', 'asset_cash')], limit=1)
        journal = self.env['account.journal'].search([('type', '=', 'general')], limit=1)
        move = self.env['account.move'].create({'move_type': 'entry', 'journal_id': journal.id, 'date': date, 'line_ids': [
            (0, 0, {'account_id': account.id, 'partner_id': partner.id, 'debit': debit, 'credit': credit}),
            (0, 0, {'account_id': other.id, 'debit': credit, 'credit': debit})]})
        move.action_post()

    def test_01_customer_balance_and_statement(self):
        self.post(self.customer, 'asset_receivable', 500, 0, '2026-01-10')
        self.post(self.customer, 'asset_receivable', 0, 200, '2026-02-10')
        rows = self.ok(self.api(self.accountant).partner_balances(kind='customer'))
        mine = next(r for r in rows if r['partner']['id'] == self.customer.id)
        self.assertEqual(mine['balance'], 300)
        st = self.ok(self.api(self.accountant).partner_statement(kind='customer', partner_id=self.customer.id,
                                                                 date_from='2026-02-01'))
        self.assertEqual((st['opening'], st['closing'], len(st['lines'])), (500, 300, 1))
        self.assertEqual(st['lines'][0]['balance'], 300)
        full = self.ok(self.api(self.accountant).partner_statement(kind='customer', partner_id=self.customer.id))
        self.assertEqual([l['balance'] for l in full['lines']][-2:], [500, 300])

    def test_02_vendor_balance_is_what_we_owe(self):
        self.post(self.vendor, 'liability_payable', 0, 800, '2026-01-10')
        self.post(self.vendor, 'liability_payable', 100, 0, '2026-01-20')
        rows = self.ok(self.api(self.accountant).partner_balances(kind='vendor'))
        self.assertEqual(next(r for r in rows if r['partner']['id'] == self.vendor.id)['balance'], 700)

    def test_03_roles_and_kind(self):
        self.bad(self.api(self.keeper).partner_balances(kind='customer'), 'access_denied')
        self.bad(self.api(self.accountant).partner_balances(kind='x'), 'validation_error')
