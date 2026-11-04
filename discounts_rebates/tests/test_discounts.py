import datetime

from odoo import fields
from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase


class DiscountsCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.user.group_ids |= cls.env.ref('supply_order.group_supply_manager')
        cls.company = cls.env.company
        cls.customer = cls.env['res.partner'].create({'name': 'Disc Customer'})
        cls.vendor = cls.env['res.partner'].create({'name': 'Disc Vendor'})
        cls.premium_categ = cls.env['product.category'].create({'name': 'Premium'})
        vals = {'type': 'consu', 'taxes_id': False, 'supplier_taxes_id': False}
        cls.premium = cls.env['product.product'].create(dict(
            vals, name='Premium Item', list_price=120, standard_price=100, categ_id=cls.premium_categ.id))
        cls.cheap = cls.env['product.product'].create(dict(vals, name='Cheap Item', list_price=80, standard_price=50))


@tagged('post_install', '-at_install')
class TestConditionalDiscount(DiscountsCase):

    def _rule(self, **kw):
        vals = {'name': 'Above 100', 'min_price': 100, 'value': 10, 'applies_to': 'sale',
                'category_ids': [(6, 0, self.premium_categ.ids)]}
        vals.update(kw)
        return self.env['conditional.discount.rule'].create(vals)

    def _so_line(self, product):
        so = self.env['sale.order'].create({
            'partner_id': self.customer.id,
            'order_line': [(0, 0, {'product_id': product.id, 'product_uom_qty': 1})]})
        return so.order_line

    def test_01_sale_line_gets_discount_above_threshold_only(self):
        self._rule()
        line = self._so_line(self.premium)
        self.assertEqual((line.price_unit, line.discount), (120, 10))
        self.assertAlmostEqual(line.price_subtotal, 108)
        self.assertEqual(self._so_line(self.cheap).discount, 0, "below the threshold / other category")

    def test_02_dates_and_amount_type(self):
        today = fields.Date.context_today(self.env.user)
        self._rule(date_to=today - datetime.timedelta(days=1))
        self.assertEqual(self._so_line(self.premium).discount, 0, "rule ended yesterday")
        self.env['conditional.discount.rule'].search([]).unlink()
        self._rule(discount_type='amount', value=12, date_from=today, date_to=today)
        self.assertAlmostEqual(self._so_line(self.premium).discount, 10.0, msg="12 off a price of 120 = 10%")

    def test_03_rule_for_sales_only_does_not_touch_purchases(self):
        self._rule(applies_to='sale')
        self.env['product.supplierinfo'].create({
            'partner_id': self.vendor.id, 'product_tmpl_id': self.premium.product_tmpl_id.id, 'price': 150})
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': self.premium.id, 'product_qty': 1})]})
        self.assertEqual((po.order_line.price_unit, po.order_line.discount), (150, 0))
        self.env['conditional.discount.rule'].search([]).write({'applies_to': 'both'})
        po2 = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': self.premium.id, 'product_qty': 1})]})
        self.assertEqual(po2.order_line.discount, 10)

    def test_04_vendor_price_list_discount_is_kept(self):
        self._rule(applies_to='both')
        self.env['product.supplierinfo'].create({
            'partner_id': self.vendor.id, 'product_tmpl_id': self.premium.product_tmpl_id.id,
            'price': 150, 'discount': 5})
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': self.premium.id, 'product_qty': 1})]})
        self.assertEqual(po.order_line.discount, 5, "never stacked on a price-list discount")

    def test_05_supply_order_lines_and_invoice(self):
        self._rule(applies_to='both')
        order = self.env['supply.order'].create({
            'partner_id': self.customer.id,
            'line_ids': [(0, 0, {'product_id': self.premium.id, 'qty_requested': 2, 'price_unit': 200}),
                         (0, 0, {'product_id': self.cheap.id, 'qty_requested': 1, 'price_unit': 80})]})
        premium, cheap = order.line_ids.sorted('line_no')
        self.assertEqual((premium.discount, cheap.discount), (10, 0))
        self.assertAlmostEqual(order.amount_untaxed, 2 * 200 * 0.9 + 80)
        premium.discount = 15  # a manual choice is kept
        self.assertEqual(premium.discount, 15)

    def test_06_invalid_values_refused(self):
        with self.assertRaises(ValidationError):
            self._rule(value=0)
        with self.assertRaises(ValidationError):
            self._rule(value=150)
        with self.assertRaises(ValidationError):
            self._rule(date_from='2026-02-01', date_to='2026-01-01')


@tagged('post_install', '-at_install')
class TestRebates(DiscountsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.action_create_suggested_rebate_accounts()
        today = fields.Date.context_today(cls.env.user)
        cls.period_end = today.replace(day=1) - datetime.timedelta(days=1)
        cls.period_start = cls.period_end.replace(day=1)
        cls.mid = cls.period_start + datetime.timedelta(days=9)
        cls.partner_a = cls.env['res.partner'].create({'name': 'Rebate A'})
        cls.partner_b = cls.env['res.partner'].create({'name': 'Rebate B'})
        cls.partner_c = cls.env['res.partner'].create({'name': 'Rebate C'})

    def _invoice(self, partner, amount, move_type='out_invoice', date=None):
        move = self.env['account.move'].create({
            'move_type': move_type, 'partner_id': partner.id, 'invoice_date': date or self.mid,
            'invoice_line_ids': [(0, 0, {'name': 'goods', 'quantity': 1, 'price_unit': amount, 'tax_ids': False})]})
        move.action_post()
        return move

    def _program(self, applies_to='sale', **kw):
        # scoped to the test partners: the database may hold other invoices (demo data)
        vals = {'name': 'Monthly volume', 'applies_to': applies_to, 'period_type': 'monthly',
                'partner_ids': [(6, 0, (self.partner_a | self.partner_b | self.partner_c | self.vendor).ids)],
                'tier_ids': [(0, 0, {'threshold': 1000, 'reward_type': 'percent', 'value': 2}),
                             (0, 0, {'threshold': 5000, 'reward_type': 'percent', 'value': 3})]}
        vals.update(kw)
        return self.env['rebate.program'].create(vals)

    def _balance(self, account, partner=None):
        domain = [('account_id', '=', account.id), ('parent_state', '=', 'posted')]
        if partner:
            domain.append(('partner_id', '=', partner.id))
        return sum(self.env['account.move.line'].search(domain).mapped('balance'))

    # setup ---------------------------------------------------------------
    def test_00_suggested_accounts_are_created_once(self):
        company = self.company
        self.assertTrue(all([company.rebate_expense_account_id, company.rebate_accrual_sale_account_id,
                             company.rebate_income_account_id, company.rebate_accrual_purchase_account_id,
                             company.rebate_journal_id]))
        before = company.rebate_expense_account_id
        company.action_create_suggested_rebate_accounts()
        self.assertEqual(company.rebate_expense_account_id, before, "idempotent")

    # periods ---------------------------------------------------------------
    def test_01_period_boundaries(self):
        Program = self.env['rebate.program']
        today = datetime.date(2026, 11, 4)  # a Wednesday
        self.assertEqual(Program._period_ending_before('daily', today), (datetime.date(2026, 11, 3),) * 2)
        self.assertEqual(Program._period_ending_before('weekly', today),
                         (datetime.date(2026, 10, 26), datetime.date(2026, 11, 1)))
        self.assertEqual(Program._period_ending_before('monthly', today),
                         (datetime.date(2026, 10, 1), datetime.date(2026, 10, 31)))
        program = self._program(last_period_end=False)
        program.last_period_end = datetime.date(2026, 8, 31)
        self.assertEqual(program._closed_periods(today), [
            (datetime.date(2026, 9, 1), datetime.date(2026, 9, 30)),
            (datetime.date(2026, 10, 1), datetime.date(2026, 10, 31))])

    # turnover and tiers ----------------------------------------------------
    def test_10_accruals_by_tier_net_of_credit_notes_and_idempotent(self):
        self._invoice(self.partner_a, 1500)
        self._invoice(self.partner_a, 100, 'out_refund')
        self._invoice(self.partner_b, 6000)
        self._invoice(self.partner_c, 500)
        program = self._program()
        program.action_compute_closed_periods()
        accruals = {a.partner_id: a for a in program.accrual_ids}
        self.assertEqual(set(accruals), {self.partner_a, self.partner_b}, "C is below the first tier")
        self.assertEqual((accruals[self.partner_a].base_amount, accruals[self.partner_a].amount), (1400, 28))
        self.assertEqual((accruals[self.partner_b].base_amount, accruals[self.partner_b].amount), (6000, 180))
        program.action_compute_closed_periods()
        program._compute_period(self.period_start, self.period_end)
        self.assertEqual(len(program.accrual_ids), 2, "never twice for the same period")

    def test_11_sales_and_purchases_programs_are_independent(self):
        self._invoice(self.partner_a, 2000)
        self._invoice(self.vendor, 4000, 'in_invoice')
        sale = self._program('sale')
        purchase = self._program('purchase', name='Vendor volume')
        sale.action_compute_closed_periods()
        purchase.action_compute_closed_periods()
        self.assertEqual(sale.accrual_ids.partner_id, self.partner_a)
        self.assertEqual(purchase.accrual_ids.partner_id, self.vendor)
        self.assertEqual(purchase.accrual_ids.amount, 80, "2% of 4000")

    def test_12_scope_products_and_partners(self):
        self._invoice(self.partner_a, 3000)
        self._invoice(self.partner_b, 3000)
        program = self._program(partner_ids=[(6, 0, self.partner_a.ids)])
        program.action_compute_closed_periods()
        self.assertEqual(program.accrual_ids.partner_id, self.partner_a)

    # accounting ------------------------------------------------------------
    def test_20_customer_rebate_is_provisioned_then_settled_without_double_cost(self):
        company = self.company
        expense, accrued = company.rebate_expense_account_id, company.rebate_accrual_sale_account_id
        invoice = self._invoice(self.partner_a, 2000)
        program = self._program()
        program.action_compute_closed_periods()
        accrual = program.accrual_ids
        self.assertEqual(accrual.amount, 40)
        receivable = invoice.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable').account_id
        receivable_before = self._balance(receivable, self.partner_a)
        accrual.action_confirm()
        self.assertEqual(accrual.state, 'confirmed')
        self.assertEqual((accrual.provision_move_id.state, accrual.provision_move_id.amount_total), ('posted', 40))
        self.assertEqual(self._balance(expense, self.partner_a), 40, "expense recognised once")
        self.assertEqual(self._balance(accrued, self.partner_a), -40, "provision owed to the customer")
        accrual.action_settle()
        note = accrual.credit_note_id
        self.assertEqual((note.move_type, note.amount_total, note.state), ('out_refund', 40, 'draft'))
        self.assertEqual(note.invoice_line_ids.account_id, accrued, "the note clears the provision, not revenue")
        note.action_post()
        self.assertEqual(self._balance(accrued, self.partner_a), 0, "provision cleared by the note")
        self.assertEqual(self._balance(expense, self.partner_a), 40, "still one expense, no second cost")
        self.assertEqual(self._balance(receivable, self.partner_a), receivable_before - 40, "customer owes 40 less")
        self.assertEqual(accrual.state, 'settled')

    def test_21_vendor_rebate_mirrors_it(self):
        company = self.company
        accrued, income = company.rebate_accrual_purchase_account_id, company.rebate_income_account_id
        self._invoice(self.vendor, 3000, 'in_invoice')
        program = self._program('purchase')
        program.action_compute_closed_periods()
        accrual = program.accrual_ids
        accrual.action_confirm()
        self.assertEqual(self._balance(accrued, self.vendor), 60)
        self.assertEqual(self._balance(income, self.vendor), -60)
        accrual.action_settle()
        note = accrual.credit_note_id
        self.assertEqual(note.move_type, 'in_refund')
        note.action_post()
        self.assertEqual(self._balance(accrued, self.vendor), 0)
        self.assertEqual(self._balance(income, self.vendor), -60, "income recognised once")

    def test_22_cancel_reverses_the_provision(self):
        company = self.company
        self._invoice(self.partner_a, 2000)
        program = self._program()
        program.action_compute_closed_periods()
        accrual = program.accrual_ids
        accrual.action_confirm()
        accrual.action_cancel()
        self.assertEqual(accrual.state, 'cancel')
        self.assertEqual(self._balance(company.rebate_expense_account_id, self.partner_a), 0)
        self.assertEqual(self._balance(company.rebate_accrual_sale_account_id, self.partner_a), 0)
        accrual.action_reset_draft()
        self.assertEqual(accrual.state, 'draft')

    def test_23_settled_rebate_cannot_be_cancelled(self):
        self._invoice(self.partner_a, 2000)
        program = self._program()
        program.action_compute_closed_periods()
        accrual = program.accrual_ids
        accrual.action_confirm()
        accrual.action_settle()
        with self.assertRaises(UserError):
            accrual.action_cancel()

    def test_24_missing_accounts_give_a_clear_message(self):
        self._invoice(self.partner_a, 2000)
        program = self._program()
        program.action_compute_closed_periods()
        self.company.rebate_expense_account_id = False
        with self.assertRaisesRegex(UserError, 'Rebates granted'):
            program.accrual_ids.action_confirm()

    # free products -----------------------------------------------------------
    def test_30_free_product_tier_creates_a_zero_price_supply_order(self):
        self._invoice(self.partner_a, 4000)
        program = self._program(tier_ids=[(0, 0, {
            'threshold': 1000, 'reward_type': 'free_product', 'product_id': self.cheap.id, 'quantity': 5})])
        program.action_compute_closed_periods()
        accrual = program.accrual_ids
        self.assertEqual(accrual.amount, 0)
        accrual.action_confirm()
        order = accrual.supply_order_id
        self.assertEqual((order.partner_id, order.state, order.order_type), (self.partner_a, 'draft', 'sale'))
        self.assertEqual((order.line_ids.product_id, order.line_ids.qty_requested, order.line_ids.price_unit),
                         (self.cheap, 5, 0))
        self.assertFalse(accrual.provision_move_id)
        accrual.action_settle()
        self.assertFalse(accrual.credit_note_id, "goods, not money: no credit note")

    # custom period and reports --------------------------------------------------
    def test_40_custom_period_runs_once_after_it_ended(self):
        self._invoice(self.partner_a, 2500)
        program = self._program(period_type='custom', date_from=self.period_start, date_to=self.period_end)
        self.assertEqual(len(program._closed_periods()), 1)
        program.action_compute_closed_periods()
        self.assertEqual(program._closed_periods(), [])
        self.assertEqual(len(program.accrual_ids), 1)

    def test_41_entitled_report_totals_by_partner(self):
        self._invoice(self.partner_a, 2000)
        self._invoice(self.partner_b, 6000)
        program = self._program()
        program.action_compute_closed_periods()
        rows = self.env['rebate.accrual']._read_group(
            [('program_id', '=', program.id)], ['partner_id'], ['amount:sum'])
        self.assertEqual({p.name: total for p, total in rows}, {'Rebate A': 40.0, 'Rebate B': 180.0})
