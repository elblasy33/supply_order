from odoo.tests import tagged

from odoo.addons.supply_api.tests.test_api import ApiCase


@tagged('post_install', '-at_install')
class TestSupplyCash(ApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Journal = cls.env['account.journal']
        cls.cash = Journal.search([('type', '=', 'cash')], limit=1) or Journal.create(
            {'name': 'Cash', 'type': 'cash', 'code': 'CSH9'})
        cls.bank = Journal.search([('type', '=', 'bank')], limit=1) or Journal.create(
            {'name': 'Bank', 'type': 'bank', 'code': 'BNK9'})
        cls.lunch = cls.env['product.product'].create({'name': 'Team lunch', 'can_be_expensed': True,
                                                       'standard_price': 0})

    def balance(self, journal):
        return next(j['balance'] for j in self.ok(self.api(self.accountant).cash_journals()) if j['id'] == journal.id)

    def test_01_receipt_from_customer_is_not_reconciled(self):
        before = self.balance(self.cash)
        data = self.ok(self.api(self.accountant).cash_entry(
            journal_id=self.cash.id, partner_id=self.customer.id, direction='in', partner_kind='customer',
            amount=250))
        self.assertEqual((data['kind'], data['state'], data['amount']), ('receipt', 'paid', 250))
        self.assertEqual(self.balance(self.cash), before + 250)
        pay = self.env['account.payment'].browse(data['id'])
        self.assertEqual((pay.payment_type, pay.partner_type, pay.state), ('inbound', 'customer', 'paid'))
        line = pay.move_id.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable')
        self.assertEqual((line.credit, line.partner_id, line.reconciled), (250, self.customer, False))

    def test_02_payment_to_vendor_reduces_the_treasury(self):
        before = self.balance(self.bank)
        data = self.ok(self.api(self.accountant).cash_entry(
            journal_id=self.bank.id, partner_id=self.vendor.id, direction='out', partner_kind='vendor',
            amount=40, ref='advance'))
        self.assertEqual((data['kind'], data['ref']), ('payment', 'advance'))
        pay = self.env['account.payment'].browse(data['id'])
        self.assertEqual(self.balance(self.bank), before - 40)
        pay = self.env['account.payment'].browse(data['id'])
        self.assertEqual((pay.payment_type, pay.partner_type), ('outbound', 'supplier'))
        line = pay.move_id.line_ids.filtered(
            lambda l: l.account_id.account_type == 'liability_payable')
        self.assertEqual((line.debit, line.reconciled), (40, False))

    def test_03_transfer_between_treasuries(self):
        cash0, bank0 = self.balance(self.cash), self.balance(self.bank)
        data = self.ok(self.api(self.accountant).cash_transfer(
            from_journal_id=self.cash.id, to_journal_id=self.bank.id, amount=100))
        self.assertEqual(data['kind'], 'transfer')
        pay = self.env['account.payment'].browse(data['id'])
        self.assertTrue(pay.paired_internal_transfer_payment_id)
        self.assertEqual(pay.paired_internal_transfer_payment_id.journal_id, self.bank)
        self.assertEqual((self.balance(self.cash), self.balance(self.bank)), (cash0 - 100, bank0 + 100))
        self.bad(self.api(self.accountant).cash_transfer(
            from_journal_id=self.cash.id, to_journal_id=self.cash.id, amount=1), 'validation_error')

    def test_04_validation_and_roles(self):
        api = self.api(self.accountant)
        for amount in (0, -5, 'x'):
            self.bad(api.cash_entry(journal_id=self.cash.id, partner_id=self.customer.id, direction='in',
                                    partner_kind='customer', amount=amount), 'validation_error')
        self.bad(api.cash_entry(journal_id=self.cash.id, partner_id=self.customer.id, direction='up',
                                partner_kind='customer', amount=5), 'validation_error')
        sale = self.env['account.journal'].search([('type', '=', 'sale')], limit=1)
        self.bad(api.cash_entry(journal_id=sale.id, partner_id=self.customer.id, direction='in',
                                partner_kind='customer', amount=5), 'validation_error')
        self.bad(self.api(self.keeper).cash_entry(journal_id=self.cash.id, partner_id=self.customer.id,
                                                  direction='in', partner_kind='customer', amount=5), 'access_denied')

    def test_05_history(self):
        api = self.api(self.accountant)
        self.ok(api.cash_entry(journal_id=self.cash.id, partner_id=self.customer.id, direction='in',
                               partner_kind='customer', amount=7))
        self.ok(api.cash_transfer(from_journal_id=self.cash.id, to_journal_id=self.bank.id, amount=3))
        found = api.cash_search(kind='transfer')
        self.assertTrue(found['ok'] and found['total'] >= 1)
        self.assertTrue(all(r['kind'] == 'transfer' for r in found['data']))

    def test_06_expense_is_company_paid_from_the_chosen_journal(self):
        before = self.balance(self.cash)
        products = self.ok(self.api(self.accountant).expense_products(query='lunch'))
        self.assertEqual([p['id'] for p in products], [self.lunch.id])
        data = self.ok(self.api(self.accountant).expense_create(
            journal_id=self.cash.id, product_id=self.lunch.id, amount=60))
        expense = self.env['hr.expense'].browse(data['id'])
        self.assertEqual((expense.payment_mode, expense.payment_method_line_id.journal_id), ('company_account', self.cash))
        self.assertIn(data['state'], ('paid', 'in_payment', 'posted', 'approved'))
        self.assertTrue(data['move'])
        listed = self.ok(self.api(self.accountant).expense_search())
        self.assertIn(data['id'], [e['id'] for e in listed])
        self.bad(self.api(self.sales).expense_create(
            journal_id=self.cash.id, product_id=self.lunch.id, amount=1), 'access_denied')
        # the cash drawer is lower once the payment is posted
        self.assertEqual(self.balance(self.cash), before - 60)
