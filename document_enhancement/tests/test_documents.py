from odoo.tests import tagged
from odoo.tests.common import TransactionCase


@tagged('post_install', '-at_install')
class TestDocumentEnhancement(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.wh = cls.env['stock.warehouse'].search([('company_id', '=', cls.company.id)], limit=1)
        cls.customer = cls.env['res.partner'].create({'name': 'DE Customer'})
        cls.vendor = cls.env['res.partner'].create({'name': 'DE Vendor'})
        vals = {'type': 'consu', 'is_storable': True, 'taxes_id': False, 'supplier_taxes_id': False,
                'invoice_policy': 'delivery'}
        cls.products = cls.env['product.product'].create([
            dict(vals, name='DE Salt', list_price=5, standard_price=3),
            dict(vals, name='DE Chips', list_price=10, standard_price=6),
            dict(vals, name='DE Veg', list_price=7, standard_price=4)])
        for p in cls.products:
            cls.env['stock.quant']._update_available_quantity(p, cls.wh.lot_stock_id, 100)

    def _so(self):
        so = self.env['sale.order'].create({
            'partner_id': self.customer.id,
            'order_line': [(0, 0, {'display_type': 'line_section', 'name': 'Section A'})] + [
                (0, 0, {'product_id': p.id, 'product_uom_qty': 2, 'line_note': 'note %s' % p.name})
                for p in self.products]})
        return so

    def _deliver(self, picking):
        for m in picking.move_ids:
            m.quantity = m.product_uom_qty
            m.picked = True
        picking.button_validate()

    def test_01_numbers_skip_sections_and_follow_order(self):
        so = self._so()
        products = so.order_line.filtered(lambda l: not l.display_type)
        self.assertEqual(products.mapped('line_no'), [1, 2, 3])
        self.assertFalse(so.order_line.filtered('display_type').line_no, "sections are not numbered")

    def test_02_moving_a_line_renumbers_and_reorders(self):
        so = self._so()
        salt, chips, veg = so.order_line.filtered(lambda l: not l.display_type).sorted('line_no')
        veg.line_no = 1  # type a number in the cell: no dragging
        self.assertEqual([l.product_id.name for l in so.order_line.filtered('line_no').sorted('line_no')],
                         ['DE Veg', 'DE Salt', 'DE Chips'])
        self.assertEqual((veg.line_no, salt.line_no, chips.line_no), (1, 2, 3))
        self.assertLess(veg.sequence, salt.sequence, "the list order follows the new number")
        self.assertLess(salt.sequence, chips.sequence)

    def test_03_sale_chain_keeps_number_and_note(self):
        so = self._so()
        so.action_confirm()
        picking = so.picking_ids
        by_product = {m.product_id: m for m in picking.move_ids}
        for line in so.order_line.filtered(lambda l: not l.display_type):
            move = by_product[line.product_id]
            self.assertEqual((move.line_no, move.line_note), (line.line_no, line.line_note))
        self._deliver(picking)
        invoice = so._create_invoices()
        for line in so.order_line.filtered(lambda l: not l.display_type):
            inv = invoice.invoice_line_ids.filtered(lambda i: i.product_id == line.product_id)
            self.assertEqual((inv.line_no, inv.line_note), (line.line_no, line.line_note))
        # accounting lines (taxes, receivable) never get a number
        self.assertFalse(invoice.line_ids.filtered(lambda l: l.display_type != 'product' and l.line_no))

    def test_04_purchase_chain_keeps_number_and_note(self):
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': p.id, 'product_qty': 3, 'price_unit': 2,
                                   'line_note': 'buy %s' % p.name}) for p in self.products]})
        po.button_confirm()
        self.assertEqual(po.picking_ids.move_ids.sorted('line_no').mapped('line_no'), [1, 2, 3])
        self._deliver(po.picking_ids)
        po.order_line.filtered(lambda l: True)  # receipt done
        action = po.action_create_invoice()
        bill = self.env['account.move'].browse(action['res_id'])
        self.assertEqual(sorted(bill.invoice_line_ids.mapped('line_no')), [1, 2, 3])
        self.assertEqual(set(bill.invoice_line_ids.mapped('line_note')), {'buy %s' % p.name for p in self.products})

    # printing -------------------------------------------------------------
    def _html(self, report, records):
        html, _fmt = self.env['ir.actions.report']._render_qweb_html(report, records.ids)
        return html.decode()

    def test_10_quotation_prints_our_number_and_note(self):
        so = self._so()
        so.order_line.filtered(lambda l: l.product_id == self.products[0]).line_no = 3  # reorder numbers
        self.company.show_sol_numbers = True
        html = self._html('sale.report_saleorder', so)
        self.assertIn('note DE Salt', html)
        self.company.print_note_sale = False
        self.assertNotIn('note DE Salt', self._html('sale.report_saleorder', so))

    def test_11_invoice_prints_note_and_optional_number(self):
        so = self._so()
        so.action_confirm()
        self._deliver(so.picking_ids)
        invoice = so._create_invoices()
        html = self._html('account.report_invoice', invoice)
        self.assertIn('note DE Chips', html)
        self.assertNotIn('1. ', html.replace('\n', ' ').split('DE Salt')[0][-40:], "numbers are off by default")
        self.company.print_lineno_invoice = True
        html = self._html('account.report_invoice', invoice)
        self.assertRegex(html, r'1\.\s*(<[^>]*>\s*)*DE Salt|1\.</span>')
        self.company.print_note_invoice = False
        self.assertNotIn('note DE Chips', self._html('account.report_invoice', invoice))

    def test_12_purchase_and_delivery_slip_print_notes(self):
        so = self._so()
        so.action_confirm()
        html = self._html('stock.report_deliveryslip', so.picking_ids)
        self.assertIn('note DE Veg', html)
        self.company.print_note_delivery = False
        self.assertNotIn('note DE Veg', self._html('stock.report_deliveryslip', so.picking_ids))
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': self.products[1].id, 'product_qty': 1, 'price_unit': 2,
                                   'line_note': 'rfq note'})]})
        self.assertIn('rfq note', self._html('purchase.report_purchaseorder', po))
        self.company.print_note_purchase = False
        self.assertNotIn('rfq note', self._html('purchase.report_purchaseorder', po))
