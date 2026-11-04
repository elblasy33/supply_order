from odoo.tests import tagged

from .test_api import ApiCase


@tagged('post_install', '-at_install')
class TestSupplyApiWarehouse(ApiCase):

    def deliver_setup(self, qty=10):
        order = self.make_order(confirm=True, qty=qty)
        moved = self.ok(self.api(self.keeper).order_action(id=order['id'], action='prepare_transfer'))
        return order, moved['created']['id']

    def state_of(self, order_id):
        return self.ok(self.api().order_read(id=order_id))

    # reading -------------------------------------------------------------------
    def test_01_transfers_are_listed_and_read(self):
        order, pid = self.deliver_setup()
        found = self.api(self.keeper).picking_search(kind='delivery', state=['assigned'], supply_order_id=order['id'])
        self.assertTrue(found['ok'])
        self.assertEqual([p['id'] for p in found['data']], [pid])
        self.assertEqual(found['data'][0]['supply_order']['name'], order['name'])
        self.assertEqual(self.api().picking_search(kind='receipt', supply_order_id=order['id'])['total'], 0)
        data = self.ok(self.api().picking_read(id=pid))
        move = data['moves'][0]
        self.assertEqual((data['kind'], data['state'], move['demand'], move['product']['name']), ('delivery', 'assigned', 10, 'Chips Hot'))
        self.assertTrue(data['can_validate'] and not data['can_return'])

    # counting and validating ---------------------------------------------------------
    def test_02_short_delivery_asks_what_to_do_with_the_rest(self):
        order, pid = self.deliver_setup()
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        api = self.api(self.keeper)
        data = self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 6}]))
        self.assertEqual(data['moves'][0]['quantity'], 6)
        self.bad(api.picking_validate(id=pid), 'validation_error')  # short and no decision
        done = self.ok(api.picking_validate(id=pid, backorder='create'))
        self.assertEqual(done['state'], 'done')
        back = done['created_backorders']
        self.assertEqual(len(back), 1)
        rest = self.ok(self.api().picking_read(id=back[0]['id']))
        self.assertEqual(rest['moves'][0]['demand'], 4)
        self.assertEqual(rest['backorder_of']['id'], pid)
        self.assertEqual(self.state_of(order['id'])['lines'][0]['qty_done'], 6)
        # the rest is delivered later
        self.ok(api.picking_save(id=back[0]['id'], lines=[{'move_id': rest['moves'][0]['id'], 'quantity': 4}]))
        self.ok(api.picking_validate(id=back[0]['id']))
        final = self.state_of(order['id'])
        self.assertEqual((final['lines'][0]['qty_done'], final['fulfillment_state']), (10, 'done'))

    def test_03_dropping_the_rest_creates_no_backorder(self):
        order, pid = self.deliver_setup()
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        api = self.api(self.keeper)
        self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 7}]))
        done = self.ok(api.picking_validate(id=pid, backorder='none'))
        self.assertEqual((done['state'], done['created_backorders']), ('done', []))
        self.assertEqual(self.state_of(order['id'])['lines'][0]['qty_done'], 7)

    def test_04_nothing_counted_and_over_delivery(self):
        order, pid = self.deliver_setup()
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        api = self.api(self.keeper)
        self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 0}]))
        self.bad(api.picking_validate(id=pid, backorder='none'), 'nothing_to_do')
        self.bad(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': -1}]), 'validation_error')
        self.bad(api.picking_save(id=pid, lines=[{'move_id': 999999, 'quantity': 1}]), 'not_found')
        self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 12}]))
        self.ok(api.picking_validate(id=pid))
        line = self.state_of(order['id'])['lines'][0]
        self.assertEqual((line['qty_done'], line['qty_requested']), (12, 12), "the order follows what really moved")
        self.bad(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 1}]), 'user_error')  # done

    def test_05_scanning_counts_item_by_item(self):
        self.chips_hot.barcode = '6221234500001'
        order, pid = self.deliver_setup(qty=3)
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        api = self.api(self.keeper)
        self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 0}]))
        for _i in range(2):
            res = self.ok(api.picking_scan(id=pid, code='6221234500001'))
        self.assertEqual((res['outcome'], res['picking']['moves'][0]['quantity']), ('quantity_increased', 2))
        miss = self.ok(api.picking_scan(id=pid, code='nope'))
        self.assertEqual(miss['outcome'], 'unknown')
        self.assertTrue(miss['message'])
        self.bad(api.picking_scan(id=pid, code=' '), 'validation_error')

    # lots ---------------------------------------------------------------------------------
    def test_06_receipt_with_new_lots_and_scan(self):
        self.chips_hot.tracking = 'lot'
        order = self.make_order(order_type='purchase', confirm=True, qty=10)
        pid = self.ok(self.api(self.keeper).order_action(id=order['id'], action='prepare_transfer'))['created']['id']
        data = self.ok(self.api().picking_read(id=pid))
        self.assertEqual(data['kind'], 'receipt')
        move_id = data['moves'][0]['id']
        api = self.api(self.keeper)
        res = self.ok(api.picking_scan(id=pid, code='LOT-NEW-1'))
        self.assertEqual(res['outcome'], 'new_lot_name')
        self.assertEqual([e['lot_name'] for e in res['picking']['moves'][0]['entries']], ['LOT-NEW-1'])
        self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'entries': [
            {'lot_name': 'LOT-NEW-1', 'quantity': 6}, {'lot_name': 'LOT-NEW-2', 'quantity': 4}]}]))
        done = self.ok(api.picking_validate(id=pid))
        self.assertEqual(done['state'], 'done')
        lots = {e['lot']['name']: e['quantity'] for e in done['moves'][0]['entries']}
        self.assertEqual(lots, {'LOT-NEW-1': 6, 'LOT-NEW-2': 4})
        self.assertEqual(self.env['stock.lot'].search([('name', '=', 'LOT-NEW-2')]).product_qty, 4)

    def test_07_delivery_of_a_lot_checks_the_lot(self):
        self.chips_hot.tracking = 'lot'
        lot = self.env['stock.lot'].create({'name': 'LOT-D1', 'product_id': self.chips_hot.id})
        self.env['stock.quant']._update_available_quantity(self.chips_hot, self.wh.lot_stock_id, 20, lot_id=lot)
        order, pid = self.deliver_setup(qty=5)
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        api = self.api(self.keeper)
        self.bad(api.picking_save(id=pid, lines=[{'move_id': move_id, 'entries': [{'lot_name': 'GHOST', 'quantity': 5}]}]),
                 'validation_error')
        other = self.env['stock.lot'].create({'name': 'LOT-X', 'product_id': self.chips_cheese.id})
        self.bad(api.picking_save(id=pid, lines=[{'move_id': move_id, 'entries': [{'lot_id': other.id, 'quantity': 5}]}]),
                 'validation_error')
        res = self.ok(api.picking_scan(id=pid, code='LOT-D1'))
        self.assertEqual(res['outcome'], 'lot_entry')
        self.ok(api.picking_save(id=pid, lines=[{'move_id': move_id, 'entries': [{'lot_id': lot.id, 'quantity': 5}]}]))
        self.assertEqual(self.ok(api.picking_validate(id=pid))['state'], 'done')

    # returns, cancel, roles ------------------------------------------------------------------------
    def test_08_return_part_of_a_delivery(self):
        order, pid = self.deliver_setup()
        api = self.api(self.keeper)
        move_id = self.ok(api.picking_read(id=pid))['moves'][0]['id']
        self.ok(api.picking_validate(id=pid))
        self.assertEqual(self.state_of(order['id'])['lines'][0]['qty_done'], 10)
        self.bad(api.picking_return(id=pid, lines=[{'move_id': move_id, 'quantity': 11}]), 'validation_error')
        res = self.ok(api.picking_return(id=pid, lines=[{'move_id': move_id, 'quantity': 3}]))
        self.assertTrue(res['return_picking']['name'])
        self.assertEqual(self.state_of(order['id'])['lines'][0]['qty_done'], 7, "returns reduce what counts as delivered")
        again = self.ok(api.picking_return(id=pid))  # the rest
        self.assertEqual(self.state_of(order['id'])['lines'][0]['qty_done'], 0)
        self.assertFalse(again['can_return'])
        self.bad(api.picking_return(id=pid), 'nothing_to_do')

    def test_09_cancel_and_roles(self):
        order, pid = self.deliver_setup()
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        for who in (self.sales, self.accountant):
            self.bad(self.api(who).picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 1}]), 'access_denied')
            self.bad(self.api(who).picking_validate(id=pid), 'access_denied')
            self.bad(self.api(who).picking_cancel(id=pid), 'access_denied')
        self.assertEqual(self.ok(self.api(self.keeper).picking_cancel(id=pid))['state'], 'cancel')
        self.bad(self.api(self.keeper).picking_cancel(id=pid), 'user_error')
        # what was cancelled can be planned again
        self.ok(self.api(self.keeper).order_action(id=order['id'], action='prepare_transfer'))
