from odoo.exceptions import ValidationError
from odoo.tests import Form, tagged
from odoo.addons.supply_order.tests.test_supply_flow import SupplyCase


class TrackingCase(SupplyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        vals = {'type': 'consu', 'is_storable': True, 'tracking': 'lot', 'taxes_id': False,
                'supplier_taxes_id': False, 'list_price': 10, 'standard_price': 5}
        cls.milk = cls.env['product.product'].create(dict(
            vals, name='Milk', default_code='MLK', barcode='6001', lot_auto_generate=True,
            use_expiration_date=True, expiration_time=30))
        cls.rice = cls.env['product.product'].create(dict(vals, name='Rice', default_code='RCE', barcode='6002'))
        cls.plain = cls.env['product.product'].create({
            'name': 'Plain', 'type': 'consu', 'is_storable': True, 'barcode': '6003', 'taxes_id': False})

    def _receive(self, order, qty=None):
        picking = order.action_prepare_transfer()
        for move in picking.move_ids:
            move.quantity = qty or move.product_uom_qty
            move.picked = True
        picking.button_validate()
        return picking


@tagged('post_install', '-at_install')
class TestLotGeneration(TrackingCase):

    def test_01_lots_generated_on_receipt_without_repeats(self):
        self.vendor.ref = 'ACME'
        order = self._order('purchase', qty=10, product=self.milk)
        picking = self._receive(order)
        lot = picking.move_line_ids.lot_id
        self.assertRegex(lot.name, r'^MLK-\d{6}-001$')
        self.assertEqual((lot.vendor_id, bool(lot.receipt_date)), (self.vendor, True))
        second = self._receive(self._order('purchase', qty=5, product=self.milk))
        self.assertRegex(second.move_line_ids.lot_id.name, r'-002$')
        self.assertNotEqual(lot, second.move_line_ids.lot_id)
        self.assertTrue(lot.expiration_date, "expiry date still comes from product_expiry")

    def test_02_pattern_tokens_and_uniqueness(self):
        self.vendor.ref = 'acme-1'
        self.milk.lot_pattern = '{vendor}/{code}/{seq:4}'
        names = [self.milk._generate_lot_name(partner=self.vendor, taken={'ACME/MLK/0001', 'ACME/MLK/0002'})]
        self.assertEqual(names, ['ACME/MLK/0003'])

    def test_03_pattern_without_sequence_is_refused(self):
        with self.assertRaises(ValidationError):
            self.milk.lot_pattern = '{code}-{date}'

    def test_04_manual_lot_name_is_respected_and_no_auto_for_other_products(self):
        order = self.env['supply.order'].create({
            'partner_id': self.vendor.id, 'order_type': 'purchase',
            'line_ids': [(0, 0, {'product_id': self.rice.id, 'qty_requested': 4, 'price_unit': 3,
                                 'lot_name': 'RICE-MANUAL-1'})]})
        order.action_confirm()
        picking = self._receive(order)
        self.assertEqual(picking.move_line_ids.lot_id.name, 'RICE-MANUAL-1')


@tagged('post_install', '-at_install')
class TestScanning(TrackingCase):

    def _scan(self, record, *codes):
        with Form(record) as form:
            for code in codes:
                form.scan_input = code
        return record

    def test_10_scan_product_adds_and_increments(self):
        order = self.env['supply.order'].create({'partner_id': self.customer.id})
        self._scan(order, '6003', '6003', '6003')
        self.assertEqual(order.line_ids.product_id, self.plain)
        self.assertEqual(order.line_ids.qty_requested, 3, "1 + 2 repeated scans")
        self.env.company.supply_barcode_increment = False
        self._scan(order, '6003')
        self.assertEqual(len(order.line_ids), 2, "setting off: a new line per scan")

    def test_11_scan_on_sale_and_purchase_orders(self):
        so = self._scan(self.env['sale.order'].create({'partner_id': self.customer.id}), '6003', '6003')
        self.assertEqual((so.order_line.product_id, so.order_line.product_uom_qty), (self.plain, 2))
        po = self._scan(self.env['purchase.order'].create({'partner_id': self.vendor.id}), '6003')
        self.assertEqual((po.order_line.product_id, po.order_line.product_qty), (self.plain, 1))

    def test_12_unknown_code_warns(self):
        order = self.env['supply.order'].create({'partner_id': self.customer.id})
        self.assertIn('unknown', order._scan_process('nope')['warning']['message'])
        so = self.env['sale.order'].create({'partner_id': self.customer.id})
        self.assertIn('unknown', so._scan_process('nope')['warning']['message'])

    def test_13_scan_lot_on_delivery_reserves_that_lot(self):
        lot_a = self.env['stock.lot'].create({'name': 'MILK-A', 'product_id': self.milk.id})
        lot_b = self.env['stock.lot'].create({'name': 'MILK-B', 'product_id': self.milk.id})
        for lot in (lot_a, lot_b):
            self.env['stock.quant']._update_available_quantity(self.milk, self.wh.lot_stock_id, 50, lot_id=lot)
        order = self.env['supply.order'].create({'partner_id': self.customer.id})
        self._scan(order, '6001', 'MILK-B')  # product, then its lot
        line = order.line_ids
        self.assertEqual((len(line), line.lot_id, line.qty_requested), (1, lot_b, 1))
        self.assertTrue(line.lot_expiration, "expiry of the lot is shown on the line")
        order.action_confirm()
        picking = order.action_prepare_transfer()
        self.assertEqual(picking.move_line_ids.lot_id, lot_b)
        self.assertEqual(picking.move_line_ids.quantity, 1)

    def test_14_scan_lot_alone_adds_its_product(self):
        lot = self.env['stock.lot'].create({'name': 'ONLY-RICE-9', 'product_id': self.rice.id})
        order = self._scan(self.env['supply.order'].create({'partner_id': self.customer.id}), 'ONLY-RICE-9')
        self.assertEqual((order.line_ids.product_id, order.line_ids.lot_id), (self.rice, lot))

    def test_15_lot_of_another_product_is_refused(self):
        lot = self.env['stock.lot'].create({'name': 'R-1', 'product_id': self.rice.id})
        order = self.env['supply.order'].create({
            'partner_id': self.customer.id, 'line_ids': [(0, 0, {'product_id': self.milk.id})]})
        with self.assertRaises(ValidationError):
            order.line_ids.lot_id = lot

    def test_16_receipt_scan_new_lot_name(self):
        order = self.env['supply.order'].create({'partner_id': self.vendor.id, 'order_type': 'purchase'})
        self._scan(order, '6002', 'NEW-RICE-LOT')
        self.assertEqual(order.line_ids.lot_name, 'NEW-RICE-LOT')
        order.action_confirm()
        picking = self._receive(order)
        self.assertEqual(picking.move_line_ids.lot_id.name, 'NEW-RICE-LOT')

    def test_17_substitution_clears_the_lot(self):
        lot = self.env['stock.lot'].create({'name': 'M-1', 'product_id': self.milk.id})
        self.env['stock.quant']._update_available_quantity(self.milk, self.wh.lot_stock_id, 10, lot_id=lot)
        order = self.env['supply.order'].create({
            'partner_id': self.customer.id,
            'line_ids': [(0, 0, {'product_id': self.milk.id, 'qty_requested': 2, 'lot_id': lot.id})]})
        order.action_confirm()
        order.line_ids.action_substitute(self.plain, 'swap')
        self.assertFalse(order.line_ids.lot_id)
