import datetime
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase


@tagged('post_install', '-at_install')
class TestSmartReconcile(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.today = fields.Date.context_today(cls.env.user)
        cls.customer = cls.env['res.partner'].create({'name': 'Reco Customer'})
        cls.other = cls.env['res.partner'].create({'name': 'Reco Other'})
        cls.vendor = cls.env['res.partner'].create({'name': 'Reco Vendor'})
        cls.bank = cls.env['account.journal'].search(
            [('type', '=', 'bank'), ('company_id', '=', cls.company.id)], limit=1)

    # helpers -------------------------------------------------------------------
    def _invoice(self, partner, amount, move_type='out_invoice', date=None, due=None, currency=None):
        date = date or self.today
        move = self.env['account.move'].create({
            'move_type': move_type, 'partner_id': partner.id, 'invoice_date': date,
            'invoice_date_due': due or date, 'currency_id': (currency or self.company.currency_id).id,
            'invoice_line_ids': [(0, 0, {'name': 'goods', 'quantity': 1, 'price_unit': amount, 'tax_ids': False})]})
        move.action_post()
        return move

    def _payment(self, partner, amount, kind='customer', date=None, currency=None):
        # with Accounting installed Odoo only books a payment once the bank statement matches it
        payment = self.env['account.payment'].with_context(force_payment_move=True).create({
            'payment_type': 'inbound' if kind == 'customer' else 'outbound', 'partner_type': kind,
            'partner_id': partner.id, 'amount': amount, 'date': date or self.today, 'journal_id': self.bank.id,
            'currency_id': (currency or self.company.currency_id).id})
        payment.action_post()
        return payment

    def _wizard(self, partner, kind='customer', invoices=(), payments=None, order='due', **kw):
        wiz = self.env['smart.reconcile.wizard'].create(dict({
            'partner_id': partner.id, 'kind': kind, 'allocation_order': order,
            'date_from': self.today - datetime.timedelta(days=60), 'date_to': self.today}, **kw))
        wiz.action_load()
        for line in wiz.line_ids.filtered(lambda l: l.role == 'invoice'):
            line.selected = line.move_id in invoices
        return wiz

    @staticmethod
    def _shown(wiz, role):
        return wiz.line_ids.filtered(lambda l: l.role == role)

    @staticmethod
    def _pay_state(move):
        """'paid' also when the payment is only waiting for the bank statement ('in_payment')."""
        return 'paid' if move.payment_state in ('paid', 'in_payment') else move.payment_state

    def _paid_state(self, *moves):
        return [self._pay_state(m) for m in moves]

    # loading ---------------------------------------------------------------------
    def test_01_load_shows_only_that_partner_in_that_period(self):
        a = self._invoice(self.customer, 100)
        old = self._invoice(self.customer, 50, date=self.today - datetime.timedelta(days=200))
        self._invoice(self.other, 70)
        pay = self._payment(self.customer, 40)
        wiz = self._wizard(self.customer)
        self.assertEqual(self._shown(wiz, 'invoice').move_id, a, "other partner and out-of-period invoices are not shown")
        self.assertNotIn(old, self._shown(wiz, 'invoice').move_id)
        self.assertEqual(self._shown(wiz, 'payment').move_id, pay.move_id)
        self.assertTrue(self._shown(wiz, 'payment').selected, "payments start selected")
        self.assertFalse(self._shown(wiz, 'invoice').selected, "invoices are never selected for you")

    # distribution ------------------------------------------------------------------
    def test_02_payments_cover_selected_invoices_and_leave_the_rest(self):
        a = self._invoice(self.customer, 100, due=self.today + datetime.timedelta(days=5))
        b = self._invoice(self.customer, 200, due=self.today + datetime.timedelta(days=10))
        c = self._invoice(self.customer, 300)
        self._payment(self.customer, 250)
        self._payment(self.customer, 120)
        wiz = self._wizard(self.customer, invoices=a | b)
        self.assertEqual((wiz.selected_total, wiz.available_total), (300, 370))
        wiz.action_reconcile()
        self.assertEqual(self._paid_state(a, b), ['paid', 'paid'])
        self.assertEqual((c.amount_residual, c.payment_state), (300, 'not_paid'), "an unselected invoice is untouched")
        self.assertEqual(sum(wiz.log_ids.mapped('amount')), 300)
        left = sum(abs(l.amount_residual) for l in self._shown(wiz, 'payment').move_line_id)
        self.assertEqual(left, 70, "what is left stays on the payments, never forced on invoice C")

    def test_03_partial_reconciliation_never_exceeds_the_available_amount(self):
        a = self._invoice(self.customer, 100)
        b = self._invoice(self.customer, 200)
        self._payment(self.customer, 150)
        wiz = self._wizard(self.customer, invoices=a | b)
        wiz.action_reconcile()
        self.assertEqual(sum(wiz.log_ids.mapped('amount')), 150)
        self.assertEqual(self._paid_state(a, b), ['paid', 'partial'])
        self.assertEqual((a.amount_residual, b.amount_residual), (0, 150))
        self.assertEqual(wiz.remaining_total, 150, "shown to the user after the run")
        self.assertEqual([l.invoice_residual_after for l in wiz.log_ids.sorted('id')], [0, 150])

    def test_04_allocation_order_due_date_or_invoice_date(self):
        early_invoice_late_due = self._invoice(self.customer, 100, date=self.today - datetime.timedelta(days=30),
                                               due=self.today + datetime.timedelta(days=30))
        late_invoice_early_due = self._invoice(self.customer, 100, date=self.today - datetime.timedelta(days=5),
                                               due=self.today - datetime.timedelta(days=1))
        pay = self._payment(self.customer, 100)
        wiz = self._wizard(self.customer, invoices=early_invoice_late_due | late_invoice_early_due, order='due')
        wiz.action_reconcile()
        self.assertEqual(self._paid_state(late_invoice_early_due, early_invoice_late_due),
                         ['paid', 'not_paid'], "due date first")
        # undo and replay the other way
        (late_invoice_early_due.line_ids | pay.move_id.line_ids).remove_move_reconcile()
        wiz2 = self._wizard(self.customer, invoices=early_invoice_late_due | late_invoice_early_due, order='invoice')
        wiz2.action_reconcile()
        self.assertEqual(self._paid_state(early_invoice_late_due, late_invoice_early_due),
                         ['paid', 'not_paid'], "invoice date first")

    def test_05_credit_notes_are_available_like_payments(self):
        invoice = self._invoice(self.customer, 100)
        credit = self._invoice(self.customer, 30, 'out_refund')
        wiz = self._wizard(self.customer, invoices=invoice)
        self.assertEqual(self._shown(wiz, 'payment').move_id, credit)
        wiz.action_reconcile()
        self.assertEqual(invoice.amount_residual, 70)

    def test_06_vendors_are_the_mirror_case(self):
        bill1 = self._invoice(self.vendor, 100, 'in_invoice')
        bill2 = self._invoice(self.vendor, 200, 'in_invoice')
        self._payment(self.vendor, 150, kind='supplier')
        wiz = self._wizard(self.vendor, kind='vendor', invoices=bill1 | bill2)
        wiz.action_reconcile()
        self.assertEqual(self._paid_state(bill1, bill2), ['paid', 'partial'])
        self.assertEqual(bill2.amount_residual, 150)
        self.assertEqual(set(wiz.log_ids.mapped('kind')), {'vendor'})

    # refusals ------------------------------------------------------------------------
    def test_07_nothing_selected_or_nothing_available_is_refused(self):
        a = self._invoice(self.customer, 100)
        wiz = self._wizard(self.customer)
        with self.assertRaises(UserError):
            wiz.action_reconcile()  # no invoice ticked
        wiz = self._wizard(self.customer, invoices=a)
        with self.assertRaises(UserError):
            wiz.action_reconcile()  # no payment at all
        self.assertEqual((a.amount_residual, a.payment_state), (100, 'not_paid'))

    def test_08_a_failure_leaves_everything_unreconciled(self):
        a = self._invoice(self.customer, 100)
        b = self._invoice(self.customer, 50)
        self._payment(self.customer, 500)
        wiz = self._wizard(self.customer, invoices=a | b)
        line_model = type(self.env['account.move.line'])
        original, calls = line_model.reconcile, []

        def second_pairing_fails(records):
            calls.append(1)
            if len(calls) == 2:
                raise UserError("simulated accounting refusal")
            return original(records)

        with patch.object(line_model, 'reconcile', second_pairing_fails):
            with self.assertRaises(UserError), self.env.cr.savepoint():
                wiz.action_reconcile()
        self.assertEqual(len(calls), 2, "the first pairing really ran before the failure")
        self.assertEqual((a.payment_state, b.payment_state), ('not_paid', 'not_paid'), "all or nothing")
        self.assertEqual((a.amount_residual, b.amount_residual), (100, 50))
        self.assertFalse(self.env['smart.reconcile.log'].search([('partner_id', '=', self.customer.id)]))

    # currency --------------------------------------------------------------------------
    def test_09_foreign_currency_invoice_paid_partially_in_company_currency(self):
        eur = self.env.ref('base.EUR')
        eur.active = True
        self.env['res.currency.rate'].create({
            'currency_id': eur.id, 'name': self.today - datetime.timedelta(days=90),
            'company_rate': 0.5, 'company_id': self.company.id})
        if self.company.currency_id == eur:
            self.skipTest("company currency is EUR")
        invoice = self._invoice(self.customer, 100, currency=eur)  # 100 EUR = 200 in company currency
        self.assertEqual(invoice.amount_residual, 100)
        self._payment(self.customer, 120)  # company currency
        wiz = self._wizard(self.customer, invoices=invoice)
        wiz.action_reconcile()
        self.assertEqual(invoice.payment_state, 'partial')
        self.assertAlmostEqual(invoice.amount_residual, 40, places=2, msg="120 company currency = 60 EUR paid")
        self.assertAlmostEqual(sum(wiz.log_ids.mapped('amount')), 120, places=2)

    # log ----------------------------------------------------------------------------------
    def test_10_log_is_complete_and_append_only(self):
        a = self._invoice(self.customer, 100)
        pay = self._payment(self.customer, 100)
        wiz = self._wizard(self.customer, invoices=a)
        wiz.action_reconcile()
        log = wiz.log_ids
        self.assertEqual((log.partner_id, log.invoice_id, log.payment_move_id, log.user_id, log.kind),
                         (self.customer, a, pay.move_id, self.env.user, 'customer'))
        self.assertTrue(log.batch.startswith('REC-') and log.create_date)
        with self.assertRaises(UserError):
            log.write({'amount': 1})
        with self.assertRaises(UserError):
            log.unlink()
