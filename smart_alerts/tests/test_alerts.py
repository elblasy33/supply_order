from datetime import timedelta

from odoo import fields
from odoo.tests import tagged
from odoo.addons.supply_order.tests.test_supply_flow import SupplyCase


@tagged('post_install', '-at_install')
class TestExpiryAlerts(SupplyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.categ = cls.env['product.category'].create({'name': 'Dairy alerts', 'expiry_alert_days': 10})
        cls.milk = cls.env['product.product'].create({
            'name': 'Alert Milk', 'type': 'consu', 'is_storable': True, 'tracking': 'lot',
            'use_expiration_date': True, 'expiration_time': 30, 'alert_time': 0, 'categ_id': cls.categ.id})

    def _lot(self, name, days_left, product=None):
        product = product or self.milk
        expiry = fields.Datetime.now() + timedelta(days=days_left)
        return self.env['stock.lot'].create({'name': name, 'product_id': product.id, 'expiration_date': expiry})

    def test_01_category_default_alert_period(self):
        lot = self._lot('A1', 30)
        self.assertEqual(lot.expiration_date - lot.alert_date, timedelta(days=10))

    def test_02_product_alert_period_wins_over_category(self):
        self.milk.alert_time = 4
        lot = self._lot('A2', 30)
        self.assertEqual(lot.expiration_date - lot.alert_date, timedelta(days=4))

    def test_03_expiry_state_and_search(self):
        ok, alert, expired = self._lot('S-OK', 25), self._lot('S-AL', 5), self._lot('S-EX', -2)
        self.assertEqual((ok.expiry_state, alert.expiry_state, expired.expiry_state), ('ok', 'alert', 'expired'))
        lots = ok | alert | expired
        search = lambda op, val: self.env['stock.lot'].search([('id', 'in', lots.ids), ('expiry_state', op, val)])
        self.assertEqual(search('=', 'alert'), alert)
        self.assertEqual(search('=', 'expired'), expired)
        self.assertEqual(search('in', ['alert', 'expired']), alert | expired)
        self.assertEqual(search('!=', 'ok'), alert | expired)
        self.assertEqual(alert.days_to_expiry, 5)

    def test_04_stock_managers_get_an_activity_once(self):
        manager = self.env['res.users'].create({
            'name': 'Stock Boss', 'login': 'stock_boss',
            'group_ids': [(6, 0, [self.env.ref('stock.group_stock_manager').id])]})
        lot = self._lot('S-MGR', 5)
        self.env['stock.quant']._update_available_quantity(self.milk, self.wh.lot_stock_id, 7, lot_id=lot)
        self.env['stock.lot']._alert_date_exceeded()
        mine = lot.activity_ids.filtered(lambda a: a.user_id == manager)
        self.assertEqual(len(mine), 1)
        self.assertIn('S-MGR', mine.summary)
        self.env['stock.lot']._alert_date_exceeded()
        self.assertEqual(len(lot.activity_ids.filtered(lambda a: a.user_id == manager)), 1, "no repeat")


@tagged('post_install', '-at_install')
class TestAutoPurchaseAlerts(SupplyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        mto = cls.env.ref('stock.route_warehouse0_mto')
        mto.write({'active': True, 'product_selectable': True})
        cls.wh.mto_pull_id.active = True
        buy = cls.env.ref('purchase_stock.route_warehouse0_buy')
        buy.product_selectable = True
        cls.mto_product = cls.env['product.product'].create({
            'name': 'MTO Item', 'type': 'consu', 'is_storable': True, 'list_price': 9, 'taxes_id': False,
            'route_ids': [(6, 0, [mto.id, buy.id])],
            'seller_ids': [(0, 0, {'partner_id': cls.vendor.id, 'price': 4})]})
        cls.buyer = cls.env['res.users'].create({
            'name': 'Buyer Boss', 'login': 'buyer_boss',
            'group_ids': [(6, 0, [cls.env.ref('purchase.group_purchase_manager').id])]})

    def _auto_po(self):
        order = self._order(qty=12, product=self.mto_product)
        so = order.action_create_sale_order()
        so.action_confirm()
        po = self.env['purchase.order'].search([('origin', 'ilike', so.name)])
        return order, po

    def test_10_mto_purchase_is_flagged_notified_and_linked(self):
        order, po = self._auto_po()
        self.assertTrue(po, "the MTO route created a purchase order")
        self.assertEqual((po.auto_generated, po.auto_source), (True, 'mto'))
        self.assertEqual(po.supply_order_id, order, "linked to the supply order that caused it")
        self.assertIn(self.buyer, po.activity_ids.user_id)
        self.assertIn(po, self.env['purchase.order'].search([('auto_generated', '=', True)]))

    def test_11_manual_purchase_is_not_flagged(self):
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': self.mto_product.id, 'product_qty': 1, 'price_unit': 4})]})
        self.assertFalse(po.auto_generated)

    def test_12_late_receipt_tracking_and_single_alert(self):
        order, po = self._auto_po()
        po.button_confirm()
        po.date_planned = fields.Datetime.now() - timedelta(days=3)
        self.assertTrue(po.is_late_receipt)
        self.assertIn(po, self.env['purchase.order'].search([('is_late_receipt', '=', True)]))
        self.assertNotIn(po, self.env['purchase.order'].search([('is_late_receipt', '=', False)]))
        before = len(po.activity_ids)
        self.env['purchase.order']._cron_late_auto_purchase_alert()
        self.assertGreater(len(po.activity_ids), before)
        self.assertTrue(po.late_alerted)
        count = len(po.activity_ids)
        self.env['purchase.order']._cron_late_auto_purchase_alert()
        self.assertEqual(len(po.activity_ids), count, "one alert per order")
        # received: no longer late
        for move in po.picking_ids.move_ids:
            move.quantity = move.product_uom_qty
            move.picked = True
        po.picking_ids.with_context(skip_backorder=True).button_validate()
        self.assertFalse(po.is_late_receipt)
