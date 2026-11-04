import io
import zipfile

from odoo.tests import HttpCase, tagged
from odoo.addons.supply_order.tests.test_supply_flow import SupplyCase


@tagged('post_install', '-at_install')
class TestInvoiceGrouping(SupplyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        vals = {'type': 'consu', 'is_storable': True, 'supplier_taxes_id': False, 'invoice_group_name': 'Chips'}
        cls.tax = cls.env['account.tax'].create({'name': 'Test 14%', 'amount': 14, 'type_tax_use': 'sale'})
        cls.hot = cls.env['product.product'].create(dict(vals, name='Chips Hot', list_price=10, taxes_id=False))
        cls.cheese = cls.env['product.product'].create(dict(vals, name='Chips Cheese', list_price=12, taxes_id=False))
        cls.spicy = cls.env['product.product'].create(
            dict(vals, name='Chips Spicy', list_price=9, taxes_id=[(6, 0, cls.tax.ids)]))
        cls.salt = cls.env['product.product'].create(dict(
            vals, name='Salt Pack', list_price=4, taxes_id=False, invoice_group_name=False))
        for p in (cls.hot, cls.cheese, cls.spicy, cls.salt):
            cls.env['stock.quant']._update_available_quantity(p, cls.wh.lot_stock_id, 100)

    def _invoice(self, products, group=True):
        order = self.env['supply.order'].create({
            'partner_id': self.customer.id, 'supply_ref': '11100',
            'line_ids': [(0, 0, {'product_id': p.id, 'qty_requested': 5 + i, 'price_unit': p.list_price,
                                 'line_note': 'memo-%d' % i}) for i, p in enumerate(products)]})
        order.action_confirm()
        picking = order.action_prepare_transfer()
        for m in picking.move_ids:
            m.quantity, m.picked = m.product_uom_qty, True
        picking.button_validate()
        invoice = order.action_create_invoice()
        invoice.group_invoice_lines = group
        invoice.action_post()
        return order, invoice

    def _html(self, invoice):
        html, _fmt = self.env['ir.actions.report']._render_qweb_html('account.report_invoice', invoice.ids)
        return html.decode()

    @staticmethod
    def _snapshot(invoice):
        return sorted((l.account_id.id, l.product_id.id, l.quantity, l.price_unit, l.debit, l.credit,
                       tuple(l.tax_ids.ids)) for l in invoice.line_ids)

    def test_01_group_on_print_only_entries_untouched(self):
        _order, invoice = self._invoice([self.hot, self.cheese, self.salt])
        entries_before = self._snapshot(invoice)
        lines_count = self.env['account.move.line'].search_count([])
        moves_count = self.env['account.move'].search_count([])
        html = self._html(invoice)
        self.assertIn('Chips', html)
        self.assertNotIn('Chips Hot', html)
        self.assertNotIn('Chips Cheese', html)
        self.assertIn('Salt Pack', html, "items without a group keep their name")
        self.assertIn('11.00', html, "5 + 6 pieces merged")
        self.assertEqual(self._snapshot(invoice), entries_before, "journal items identical")
        self.assertEqual(self.env['account.move.line'].search_count([]), lines_count, "nothing saved by printing")
        self.assertEqual(self.env['account.move'].search_count([]), moves_count)
        self.assertEqual(len(invoice.invoice_line_ids), 3, "invoice lines are not merged")
        # the same invoice printed without grouping lists every item
        invoice.group_invoice_lines = False
        html = self._html(invoice)
        self.assertIn('Chips Hot', html)
        self.assertIn('Chips Cheese', html)

    def test_02_cost_and_stock_moves_stay_per_item(self):
        order, invoice = self._invoice([self.hot, self.cheese])
        self.assertEqual(len(order.picking_ids.move_ids), 2)
        self.assertEqual(set(order.picking_ids.move_ids.product_id), {self.hot, self.cheese})
        self.assertEqual(set(invoice.invoice_line_ids.product_id), {self.hot, self.cheese})

    def test_03_different_taxes_are_not_merged_and_warn(self):
        _order, invoice = self._invoice([self.hot, self.cheese, self.spicy])
        self.assertIn('Chips', invoice.grouping_warning)
        html = self._html(invoice)
        self.assertIn('Chips Hot', html)
        self.assertIn('Chips Spicy', html)

    def test_04_group_name_flows_from_product_and_supply_line_wins(self):
        order, invoice = self._invoice([self.hot])
        self.assertEqual(invoice.invoice_line_ids.invoice_group_name, 'Chips')
        order2 = self.env['supply.order'].create({
            'partner_id': self.customer.id,
            'line_ids': [(0, 0, {'product_id': self.hot.id, 'invoice_group_name': 'Snacks'})]})
        self.assertEqual(order2.line_ids.invoice_group_name, 'Snacks')

    def test_05_print_button_opens_a_preview(self):
        _order, invoice = self._invoice([self.hot])
        action = invoice.action_print_pdf()
        self.assertEqual(action['type'], 'ir.actions.act_url')
        self.assertRegex(action['url'], r'^/report/html/account\.report_invoice[a-z_]*/%s$' % invoice.id)

    def test_06_company_default_for_new_invoices(self):
        self.env.company.group_invoice_lines_default = True
        move = self.env['account.move'].create({'move_type': 'out_invoice', 'partner_id': self.customer.id})
        self.assertTrue(move.group_invoice_lines)


@tagged('post_install', '-at_install')
class TestCommercialBill(SupplyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        vals = {'type': 'consu', 'is_storable': True, 'taxes_id': False, 'invoice_group_name': 'Chips'}
        cls.hot = cls.env['product.product'].create(dict(vals, name='Chips Hot', list_price=10))
        cls.cheese = cls.env['product.product'].create(dict(vals, name='Chips Cheese', list_price=12))
        cls.salt = cls.env['product.product'].create(dict(vals, name='Salt Pack', list_price=4, invoice_group_name=False))
        for p in (cls.hot, cls.cheese, cls.salt):
            cls.env['stock.quant']._update_available_quantity(p, cls.wh.lot_stock_id, 100)
        cls.order = cls.env['supply.order'].create({
            'partner_id': cls.customer.id, 'supply_ref': '11100',
            'line_ids': [(0, 0, {'product_id': p.id, 'qty_requested': q, 'price_unit': p.list_price,
                                 'line_note': 'memo-%s' % p.id})
                         for p, q in ((cls.hot, 5), (cls.cheese, 6), (cls.salt, 2))]})
        cls.order.action_confirm()

    def _html(self):
        html, _fmt = self.env['ir.actions.report']._render_qweb_html(
            'invoice_customization.report_commercial_bill', self.order.ids)
        return html.decode()

    def test_10_before_delivery_uses_requested_quantities_grouped(self):
        rows = self.order._get_commercial_lines()
        self.assertEqual([(r['name'], r['qty']) for r in rows], [('Chips', 11.0), ('Salt Pack', 2.0)])
        self.assertEqual(self.order._commercial_total(), 5 * 10 + 6 * 12 + 2 * 4)
        html = self._html()
        self.assertIn('Commercial Bill', html)
        self.assertIn('Chips', html)
        self.assertNotIn('Chips Hot', html)
        self.assertIn('130.00', html)

    def test_11_after_delivery_uses_what_was_really_moved(self):
        picking = self.order.action_prepare_transfer()
        for m in picking.move_ids:
            m.quantity = 1 if m.product_id == self.hot else m.product_uom_qty
            m.picked = True
        picking.with_context(skip_backorder=True, picking_ids_not_to_backorder=picking.ids).button_validate()
        rows = {r['name']: r['qty'] for r in self.order._get_commercial_lines()}
        self.assertEqual(rows, {'Chips': 7.0, 'Salt Pack': 2.0})

    def test_12_company_options_title_prices_notes_footer(self):
        company = self.order.company_id
        company.write({'commercial_bill_title': 'Invoice Proforma', 'commercial_bill_footer': 'Bank XYZ 123'})
        html = self._html()
        self.assertIn('Invoice Proforma', html)
        self.assertIn('Bank XYZ 123', html)
        self.assertIn('memo-%s' % self.salt.id, html)
        company.write({'commercial_bill_show_notes': False, 'commercial_bill_show_prices': False})
        html = self._html()
        self.assertNotIn('memo-%s' % self.salt.id, html)
        self.assertNotIn('130.00', html)

    def test_13_preview_actions(self):
        self.assertEqual(self.order.action_print_commercial_bill()['url'],
                         '/report/html/invoice_customization.report_commercial_bill/%s' % self.order.id)
        self.assertEqual(self.order.action_print_quotation()['url'],
                         '/report/html/supply_order.report_supply_quotation/%s' % self.order.id)


@tagged('post_install', '-at_install')
class TestPreviewToolbar(HttpCase):

    def setUp(self):
        super().setUp()
        self.partner = self.env['res.partner'].create({'name': 'Toolbar Customer'})
        product = self.env['product.product'].create({
            'name': 'Toolbar Item', 'type': 'consu', 'list_price': 8, 'taxes_id': False,
            'invoice_group_name': 'Items'})
        self.invoice = self.env['account.move'].create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'group_invoice_lines': True,
            'invoice_line_ids': [(0, 0, {'product_id': product.id, 'quantity': 3, 'price_unit': 8})]})
        self.invoice.action_post()
        self.authenticate('admin', 'admin')

    def test_20_html_preview_has_print_pdf_xlsx_toolbar(self):
        res = self.url_open('/report/html/account.report_invoice/%s' % self.invoice.id)
        self.assertEqual(res.status_code, 200)
        self.assertIn('ic-toolbar', res.text)
        self.assertIn('window.print()', res.text)
        self.assertIn('/ic/download/pdf/account.move/%s' % self.invoice.id, res.text)
        self.assertIn('/ic/download/xlsx/account.move/%s' % self.invoice.id, res.text)

    def test_21_toolbar_is_added_once_and_only_to_known_reports(self):
        res = self.url_open('/report/html/account.report_invoice/%s' % self.invoice.id)
        self.assertEqual(res.text.count('class="ic-toolbar"'), 1)
        res = self.url_open('/report/html/web.report_layout_dummy_none/1')
        self.assertNotIn('ic-toolbar', res.text)

    def test_22_xlsx_download_has_grouped_lines(self):
        res = self.url_open('/ic/download/xlsx/account.move/%s?report=account.report_invoice' % self.invoice.id)
        self.assertEqual(res.status_code, 200)
        self.assertIn('spreadsheetml', res.headers['Content-Type'])
        self.assertIn('attachment', res.headers['Content-Disposition'])
        shared = zipfile.ZipFile(io.BytesIO(res.content)).read('xl/sharedStrings.xml').decode()
        self.assertIn('Items', shared)
        self.assertIn(self.invoice.name, shared)

    def test_23_pdf_download_is_an_attachment(self):
        res = self.url_open('/ic/download/pdf/account.move/%s' % self.invoice.id)
        self.assertEqual(res.status_code, 200)
        self.assertIn('attachment', res.headers['Content-Disposition'])
        self.assertIn('.pdf', res.headers['Content-Disposition'])

    def test_24_unknown_model_or_record_is_refused(self):
        self.assertEqual(self.url_open('/ic/download/xlsx/res.users/1').status_code, 404)
        self.assertEqual(self.url_open('/ic/download/xlsx/account.move/999999').status_code, 404)
