from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase


class SupplyCase(TransactionCase):
    """Shared fixtures and helpers (no tests of its own)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.user.group_ids |= cls.env.ref('supply_order.group_supply_manager')
        cls.company = cls.env.company
        cls.wh = cls.env['stock.warehouse'].search([('company_id', '=', cls.company.id)], limit=1)
        cls.customer = cls.env['res.partner'].create({'name': 'Test Customer'})
        cls.vendor = cls.env['res.partner'].create({'name': 'Test Vendor'})
        Product = cls.env['product.product']
        vals = {'type': 'consu', 'is_storable': True, 'taxes_id': False, 'supplier_taxes_id': False}
        cls.chips_hot = Product.create(dict(vals, name='Chips Hot', list_price=10, standard_price=6))
        cls.chips_cheese = Product.create(dict(vals, name='Chips Cheese', list_price=10, standard_price=6))
        for p in (cls.chips_hot, cls.chips_cheese):
            cls.env['stock.quant']._update_available_quantity(p, cls.wh.lot_stock_id, 500)

    # helpers -----------------------------------------------------------
    def _order(self, order_type='sale', qty=100, product=None, ref='11100'):
        order = self.env['supply.order'].create({
            'partner_id': (self.customer if order_type == 'sale' else self.vendor).id,
            'order_type': order_type,
            'supply_ref': ref,
            'line_ids': [(0, 0, {'product_id': (product or self.chips_hot).id,
                                 'qty_requested': qty, 'price_unit': 10})],
        })
        order.action_confirm()
        return order

    def _validate(self, picking, qty=None, backorder=True):
        for move in picking.move_ids:
            move.quantity = qty if qty is not None else move.product_uom_qty
            move.picked = True
        ctx = {'skip_backorder': True}
        if not backorder:
            ctx['picking_ids_not_to_backorder'] = picking.ids
        picking.with_context(**ctx).button_validate()



@tagged('post_install', '-at_install')
class TestSupplyFlow(SupplyCase):

    # 1. supply without quotation, two batches, invoice on actual ----------
    def test_01_two_batches_and_actual_invoice(self):
        order = self._order(qty=100)
        picking = order.action_prepare_transfer()
        self.assertEqual(picking.supply_order_id, order)
        self.assertEqual(picking.supply_ref, '11100')
        self._validate(picking, qty=60)
        self.assertEqual(order.line_ids.qty_done, 60)
        self.assertEqual(order.fulfillment_state, 'partial')
        invoice1 = order.action_create_invoice()
        self.assertEqual(invoice1.invoice_line_ids.mapped('quantity'), [60.0])
        self.assertEqual(invoice1.supply_ref, '11100')
        backorder = order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel'))
        self.assertEqual(len(backorder), 1, "backorder keeps the supply link")
        self._validate(backorder)
        self.assertEqual(order.fulfillment_state, 'done')
        invoice2 = order.action_create_invoice()
        self.assertEqual(invoice2.invoice_line_ids.mapped('quantity'), [40.0])
        self.assertEqual(order.line_ids.qty_invoiced, 100)
        with self.assertRaises(UserError):
            order.action_create_invoice()

    # 2. delivery before any sales order ----------------------------------
    def test_02_delivery_first_then_sale_order_no_duplicate(self):
        order = self._order(qty=50)
        picking = order.action_prepare_transfer()
        self._validate(picking, qty=30)  # 30 delivered, 20 left in backorder
        so = order.action_create_sale_order()
        self.assertEqual(so.supply_ref, '11100')
        so.action_confirm()
        # regression guard for the sale_stock rule_id behaviour (see docs/poc):
        self.assertEqual(so.picking_ids, order.picking_ids,
                         "confirming the SO must not create a second delivery")
        self.assertEqual(so.order_line.qty_delivered, 30)
        self.assertEqual(so.order_line.move_ids.supply_line_id, order.line_ids)
        self._validate(order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel')))
        self.assertEqual(so.order_line.qty_delivered, 50)
        invoice = order.action_create_invoice()
        self.assertEqual(invoice.invoice_line_ids.sale_line_ids, so.order_line)
        self.assertEqual(so.order_line.qty_invoiced, 50)

    def test_02b_sale_order_before_delivery_uses_supply_moves(self):
        order = self._order(qty=40)
        so = order.action_create_sale_order()
        so.action_confirm()
        self.assertEqual(len(so.picking_ids), 1)
        self.assertEqual(so.picking_ids.supply_order_id, order)
        self.assertEqual(order.line_ids.move_ids, so.picking_ids.move_ids)

    # 3. receipt before purchase order ------------------------------------
    def test_03_receipt_first_then_purchase_order(self):
        order = self._order('purchase', qty=40)
        receipt = order.action_prepare_transfer()
        self._validate(receipt)
        po = order.action_create_purchase_order()
        po.button_confirm()
        self.assertEqual(po.picking_ids, receipt, "no second receipt")
        self.assertEqual(po.order_line.qty_received, 40)
        bill = order.action_create_invoice()
        self.assertEqual(bill.move_type, 'in_invoice')
        self.assertEqual(bill.invoice_line_ids.mapped('quantity'), [40.0])
        self.assertEqual(bill.invoice_line_ids.purchase_line_id, po.order_line)

    # 4. substitution during preparation ----------------------------------
    def test_04_substitution_without_sale_order(self):
        order = self._order(qty=20)
        picking = order.action_prepare_transfer()
        line = order.line_ids
        line.action_substitute(self.chips_cheese, 'Hot out of stock')
        self.assertEqual(line.product_id, self.chips_cheese)
        self.assertEqual(line.requested_product_id, self.chips_hot)
        self.assertEqual(picking.move_ids.product_id, self.chips_cheese)
        self._validate(picking)
        invoice = order.action_create_invoice()
        self.assertEqual(invoice.invoice_line_ids.product_id, self.chips_cheese)
        log = order.change_log_ids.filtered(lambda l: l.change_type == 'substitute')
        self.assertEqual(len(log), 1)
        self.assertEqual(log.reason, 'Hot out of stock')

    def test_04b_substitution_with_confirmed_sale_order(self):
        order = self._order(qty=20)
        so = order.action_create_sale_order()
        so.action_confirm()
        picking = so.picking_ids
        order.line_ids.action_substitute(self.chips_cheese, 'swap')
        self.assertEqual(len(so.picking_ids), 1, "substitution must not spawn another delivery")
        self.assertEqual(picking.move_ids.product_id, self.chips_cheese)
        self.assertEqual(picking.move_ids.sale_line_id.product_id, self.chips_cheese)
        self.assertEqual(picking.move_ids.supply_line_id, order.line_ids)
        self._validate(picking)
        invoice = order.action_create_invoice()
        self.assertEqual(invoice.invoice_line_ids.product_id, self.chips_cheese)
        self.assertEqual(invoice.invoice_line_ids.quantity, 20)

    # 6. modification after confirmation ----------------------------------
    def test_06_edit_after_confirm_is_logged(self):
        order = self._order(qty=10)
        line = order.line_ids
        extra = self.env['supply.order.line'].with_context(change_reason='asked by phone').create({
            'order_id': order.id, 'product_id': self.chips_cheese.id, 'qty_requested': 5, 'price_unit': 10})
        line.qty_requested = 12
        line.price_unit = 11
        extra.unlink()
        types = order.change_log_ids.mapped('change_type')
        self.assertCountEqual(types, ['add', 'qty', 'price', 'remove'])
        with self.assertRaises(UserError):
            order.change_log_ids[:1].write({'reason': 'tamper'})
        with self.assertRaises(UserError):
            order.change_log_ids[:1].unlink()
        with self.assertRaises(UserError):
            line.product_id = self.chips_cheese  # must go through substitution

    def test_06b_only_manager_edits_confirmed(self):
        order = self._order()
        user = self.env['res.users'].create({
            'name': 'Plain', 'login': 'plain_supply',
            'group_ids': [(6, 0, [self.env.ref('supply_order.group_supply_user').id])]})
        with self.assertRaises(UserError):
            order.line_ids.with_user(user).qty_requested = 99

    # 10/3/12. reference and numbering ------------------------------------
    def test_10_supply_ref_propagates(self):
        order = self._order(qty=5, ref='11100')
        so = order.action_create_sale_order()
        picking = order.action_prepare_transfer()
        self.assertEqual((so.supply_ref, picking.supply_ref), ('11100', '11100'))
        found = self.env['stock.picking'].search([('supply_ref', '=', '11100')])
        self.assertIn(picking, found)

    def test_12_line_numbering(self):
        order = self.env['supply.order'].create({
            'partner_id': self.customer.id,
            'line_ids': [(0, 0, {'product_id': self.chips_hot.id}) for _i in range(3)]})
        a, b, c = order.line_ids.sorted('line_no')
        self.assertEqual([a.line_no, b.line_no, c.line_no], [1, 2, 3])
        c.set_position(1)
        self.assertEqual(order.line_ids.sorted('line_no').ids, [c.id, a.id, b.id])
        a.line_no = 3  # typing a number in the cell moves the line
        self.assertEqual(order.line_ids.sorted('line_no').ids, [c.id, b.id, a.id])

    # 11. external user stamp ---------------------------------------------
    def test_11_external_user_stamp(self):
        service = self.env['res.users'].create({
            'name': 'Service', 'login': 'svc_supply',
            'group_ids': [(6, 0, [self.env.ref('supply_order.group_supply_user').id])]})
        self.env['ir.config_parameter'].sudo().set_int('supply_order.service_user_id', service.id)
        ahmed = self.env['external.user'].create({'name': 'Ahmed', 'login': 'test.ahmed'})
        order = self.env['supply.order'].with_user(service).with_context(ext_user_id=ahmed.id).create({
            'partner_id': self.customer.id, 'line_ids': [(0, 0, {'product_id': self.chips_hot.id})]})
        self.assertEqual(order.created_ext_user_id, ahmed)
        self.assertEqual(order.line_ids.created_ext_user_id, ahmed)
        order.action_confirm()
        self.assertIn('Ahmed', order.message_ids[0].body)
        # same key from a normal Odoo user is ignored
        other = self.env['supply.order'].with_context(ext_user_id=ahmed.id).create({
            'partner_id': self.customer.id, 'line_ids': [(0, 0, {'product_id': self.chips_hot.id})]})
        self.assertFalse(other.created_ext_user_id)


@tagged('post_install', '-at_install')
class TestSupplyFlowChanges(SupplyCase):
    """Quotation printing, requested-vs-actual tracking and automatic transfers."""

    def _extra_move(self, picking, product, qty):
        return self.env['stock.move'].create({
            'picking_id': picking.id, 'product_id': product.id, 'product_uom_qty': qty,
            'uom_id': product.uom_id.id,
            'location_id': picking.location_id.id, 'location_dest_id': picking.location_dest_id.id,
        })

    # 1. print quotation without a sales order ----------------------------
    def test_20_print_quotation_without_sale_order(self):
        order = self._order(qty=7)
        action = order.action_print_quotation()
        # first print of a company opens the standard "configure document layout" step
        if action.get('type') == 'ir.actions.act_url':  # invoice_customization installed: preview first
            self.assertTrue(action['url'].startswith('/report/html/supply_order.report_supply_quotation/'))
        else:
            report_action = action if action.get('type') == 'ir.actions.report' else action['context']['report_action']
            self.assertEqual(report_action['report_name'], 'supply_order.report_supply_quotation')
        html, _fmt = self.env['ir.actions.report']._render_qweb_html(
            'supply_order.report_supply_quotation', order.ids)
        html = html.decode()
        self.assertIn(order.name, html)
        self.assertIn('Chips Hot', html)
        self.assertIn('11100', html)
        self.assertFalse(order.sale_order_ids, "printing must not create a sales order")
        self.assertEqual(order.amount_total, 70)

    # 2. items added / changed in the transfer show up in the order -------
    def test_21_item_added_in_transfer_and_more_delivered(self):
        order = self._order(qty=10)
        picking = order.action_prepare_transfer()
        self._extra_move(picking, self.chips_cheese, 5)
        added = order.line_ids.filtered(lambda l: l.product_id == self.chips_cheese)
        self.assertEqual(added.line_origin, 'added')
        self.assertEqual((added.qty_initial, added.qty_requested), (0, 5))
        self.assertEqual(added.move_ids, picking.move_ids.filtered(lambda m: m.product_id == self.chips_cheese))
        hot_move = picking.move_ids.filtered(lambda m: m.product_id == self.chips_hot)
        hot_move.quantity = 12  # delivered 2 more than requested
        for m in picking.move_ids:
            m.picked = True
            if m.product_id == self.chips_cheese:
                m.quantity = 5
        picking.with_context(skip_backorder=True).button_validate()
        hot = order.line_ids.filtered(lambda l: l.product_id == self.chips_hot)
        self.assertEqual((hot.qty_initial, hot.qty_requested, hot.qty_change, hot.qty_done), (10, 12, 2, 12))
        self.assertEqual(hot.line_origin, 'requested')
        invoice = order.action_create_invoice()
        self.assertEqual(sorted(invoice.invoice_line_ids.mapped('quantity')), [5.0, 12.0])
        self.assertIn('add', order.change_log_ids.mapped('change_type'))

    def test_22_item_changed_in_transfer_keeps_the_request_visible(self):
        order = self._order(qty=10)
        picking = order.action_prepare_transfer()
        picking.move_ids.product_id = self.chips_cheese  # typed over the item in the transfer
        hot = order.line_ids.filtered(lambda l: l.product_id == self.chips_hot)
        cheese = order.line_ids.filtered(lambda l: l.product_id == self.chips_cheese)
        self.assertEqual((hot.qty_initial, hot.qty_requested, hot.line_origin), (10, 10, 'requested'))
        self.assertEqual((cheese.qty_requested, cheese.line_origin), (10, 'added'))
        self._validate(picking)
        self.assertEqual((hot.qty_done, cheese.qty_done), (0, 10))
        invoice = order.action_create_invoice()
        self.assertEqual(invoice.invoice_line_ids.product_id, self.chips_cheese)

    # 3. adding items to the order creates a new transfer -----------------
    def test_23_adding_item_creates_new_transfer(self):
        order = self._order(qty=10)
        first = order.action_prepare_transfer()
        self.env['supply.order.line'].create({
            'order_id': order.id, 'product_id': self.chips_cheese.id, 'qty_requested': 5, 'price_unit': 10})
        live = order.picking_ids.filtered(lambda p: p.state != 'cancel')
        self.assertEqual(len(live), 2)
        new = live - first
        self.assertEqual(new.move_ids.product_id, self.chips_cheese)
        self.assertEqual(new.move_ids.product_uom_qty, 5)
        # raising a quantity plans the extra quantity in another transfer
        order.line_ids.filtered(lambda l: l.product_id == self.chips_hot).qty_requested = 14
        live = order.picking_ids.filtered(lambda p: p.state != 'cancel')
        self.assertEqual(len(live), 3)
        self.assertEqual((live - first - new).move_ids.product_uom_qty, 4)

    def test_23b_no_transfer_is_forced_before_the_first_one(self):
        order = self._order(qty=10)
        self.env['supply.order.line'].create({
            'order_id': order.id, 'product_id': self.chips_cheese.id, 'qty_requested': 5, 'price_unit': 10})
        self.assertFalse(order.picking_ids)

    def test_24_smart_button_counters_by_operation(self):
        sale = self._order(qty=3)
        sale.action_prepare_transfer()
        buy = self._order('purchase', qty=3)
        buy.action_prepare_transfer()
        self.assertEqual((sale.delivery_count, sale.receipt_count), (1, 0))
        self.assertEqual((buy.delivery_count, buy.receipt_count), (0, 1))


@tagged('post_install', '-at_install')
class TestSupplyAdoptAndReturn(SupplyCase):
    """Supply order created from an existing SO/PO, and substitution after validation."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_delivery = cls.env['product.product'].create({
            'name': 'Delivery-policy item', 'type': 'consu', 'is_storable': True, 'list_price': 10,
            'invoice_policy': 'delivery', 'taxes_id': False, 'supplier_taxes_id': False})
        cls.env['stock.quant']._update_available_quantity(cls.by_delivery, cls.wh.lot_stock_id, 500)

    # 1 (link): from an existing sales order that is already delivered/invoiced ------
    def test_30_supply_order_from_existing_sale_order(self):
        so = self.env['sale.order'].create({
            'partner_id': self.customer.id,
            'order_line': [(0, 0, {'product_id': self.by_delivery.id, 'product_uom_qty': 50, 'price_unit': 10})]})
        so.action_confirm()
        self._validate(so.picking_ids, qty=30)
        invoice = so._create_invoices()
        self.assertEqual(invoice.invoice_line_ids.quantity, 30)
        action = so.action_create_supply_order()
        order = self.env['supply.order'].browse(action['res_id'])
        line = order.line_ids
        self.assertEqual(order.state, 'confirmed')
        self.assertEqual((line.qty_initial, line.qty_requested, line.qty_done, line.qty_invoiced), (50, 50, 30, 30))
        self.assertEqual(so.supply_order_id, order)
        self.assertEqual(invoice.supply_order_id, order)
        self.assertEqual(so.picking_ids.supply_order_id, order)
        with self.assertRaises(UserError):
            order.action_create_invoice()  # 30 delivered, 30 already invoiced by the sale order
        with self.assertRaises(UserError):
            so.action_create_supply_order()  # only one supply order per document
        backorder = so.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel'))
        self._validate(backorder)
        new_invoice = order.action_create_invoice()
        self.assertEqual(new_invoice.invoice_line_ids.quantity, 20)
        self.assertEqual(so.order_line.qty_invoiced, 50)

    def test_31_supply_order_from_existing_purchase_order(self):
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {'product_id': self.chips_hot.id, 'product_qty': 40, 'price_unit': 6})]})
        po.button_confirm()
        self._validate(po.picking_ids)
        action = po.action_create_supply_order()
        order = self.env['supply.order'].browse(action['res_id'])
        self.assertEqual((order.order_type, order.state, order.line_ids.qty_done), ('purchase', 'confirmed', 40))
        bill = order.action_create_invoice()
        self.assertEqual(bill.invoice_line_ids.purchase_line_id, po.order_line)
        self.assertEqual(bill.invoice_line_ids.quantity, 40)

    # 1 (substitute after validation): the done move is returned, never edited -------
    def test_32_substitute_after_validation(self):
        order = self._order(qty=20)
        picking = order.action_prepare_transfer()
        self._validate(picking)
        order.action_create_invoice()
        line = order.line_ids
        self.assertTrue(line.has_done_moves)
        with self.assertRaises(UserError):
            line.action_substitute(self.chips_cheese, 'wrong item')  # path A refuses a fully moved line
        self.assertEqual(line.product_id, self.chips_hot)
        line.action_substitute(self.chips_cheese, 'wrong item', return_done=True)
        self.assertEqual(picking.move_ids.state, 'done', "the original move stays untouched")
        returns = order.picking_ids.filtered(lambda p: p.return_id == picking)
        self.assertEqual(returns.state, 'done')
        live = order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel'))
        self.assertEqual(len(live), 1)
        self.assertEqual((live.move_ids.product_id, live.move_ids.product_uom_qty), (self.chips_cheese, 20))
        self.assertIn('credit note', ' '.join(order.message_ids.mapped('body')))
        self._validate(live)
        self.assertEqual(line.qty_done, 20 - 20 + 20, "net: 20 delivered, 20 returned, 20 of the new item")
        by_product = {p: q for _l, p, q in line._get_invoiceable()}
        self.assertEqual(by_product, {self.chips_cheese: 20.0})

    def test_33_substitute_after_validation_with_sale_order(self):
        order = self._order(qty=20)
        so = order.action_create_sale_order()
        so.action_confirm()
        self._validate(so.picking_ids)
        order.line_ids.action_substitute(self.chips_cheese, 'wrong item', return_done=True)
        live = order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel'))
        self.assertEqual(len(live), 1, "exactly one new delivery, no duplicates")
        self.assertEqual(live.move_ids.sale_line_id.product_id, self.chips_cheese)
        self._validate(live)
        new_sol = so.order_line.filtered(lambda l: l.product_id == self.chips_cheese)
        self.assertEqual(new_sol.qty_delivered, 20)

    # 11: the app user is recorded in the change log -----------------------------
    def test_34_change_log_records_app_user(self):
        service = self.env['res.users'].create({
            'name': 'Service2', 'login': 'svc_supply2',
            'group_ids': [(6, 0, [self.env.ref('supply_order.group_supply_manager').id])]})
        self.env['ir.config_parameter'].sudo().set_int('supply_order.service_user_id', service.id)
        ahmed = self.env['external.user'].create({'name': 'Ahmed', 'login': 'test.ahmed2'})
        order = self._order(qty=5)
        order.line_ids.with_user(service).with_context(ext_user_id=ahmed.id).qty_requested = 8
        log = order.change_log_ids.filtered(lambda l: l.change_type == 'qty')
        self.assertEqual((log.ext_user_id, log.user_id), (ahmed, service))


@tagged('post_install', '-at_install')
class TestSupplyDocumentsFollow(SupplyCase):
    """Lowering a quantity and adding items keep transfers and documents in step."""

    def test_40_lowering_quantity_reduces_the_planned_transfer(self):
        order = self._order(qty=10)
        picking = order.action_prepare_transfer()
        line = order.line_ids
        line.qty_requested = 6
        self.assertEqual(picking.move_ids.product_uom_qty, 6)
        self.assertEqual(line.qty_unplanned, 0)
        self.assertEqual(len(order.picking_ids), 1, "no extra transfer is created by lowering")

    def test_41_lowering_to_zero_cancels_the_move_and_never_goes_below_done(self):
        order = self._order(qty=10)
        first = order.action_prepare_transfer()
        self._validate(first, qty=4, backorder=True)
        line = order.line_ids
        self.assertEqual(line.qty_done, 4)
        with self.assertRaises(UserError):
            line.qty_requested = 3  # 4 already delivered
        line.qty_requested = 4
        live = order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel'))
        self.assertFalse(live.move_ids.filtered(lambda m: m.state != 'cancel'), "the backorder has nothing left")
        self.assertEqual(line.qty_done, 4)

    def test_42_item_added_after_sale_order_goes_to_the_sale_order(self):
        order = self._order(qty=10)
        so = order.action_create_sale_order()
        so.action_confirm()
        self.env['supply.order.line'].create({
            'order_id': order.id, 'product_id': self.chips_cheese.id, 'qty_requested': 5, 'price_unit': 10})
        added = so.order_line.filtered(lambda l: l.product_id == self.chips_cheese)
        self.assertEqual(added.product_uom_qty, 5)
        live = so.picking_ids.filtered(lambda p: p.state != 'cancel')
        self.assertEqual(len(live), 2, "the confirmed delivery plus one new transfer for the added item")
        cheese = live.move_ids.filtered(lambda m: m.product_id == self.chips_cheese)
        self.assertEqual(len(cheese), 1, "the sale line created no delivery of its own")
        self.assertEqual(cheese.sale_line_id, added)
        for picking in live:
            self._validate(picking)
        self.assertEqual(added.qty_delivered, 5)
        self.assertEqual(sum(so.order_line.mapped('qty_delivered')), 15)
        # lowering the supply line follows on the sale line
        order.line_ids.filtered(lambda l: l.product_id == self.chips_cheese).with_context(
            supply_internal=True).qty_requested = 7
        order.line_ids.filtered(lambda l: l.product_id == self.chips_cheese)._sync_document_quantities()
        self.assertEqual(added.product_uom_qty, 7)

    def test_43_item_added_after_purchase_order_goes_to_it_without_own_receipt(self):
        order = self._order('purchase', qty=10)
        po = order.action_create_purchase_order()
        po.button_confirm()
        self.env['supply.order.line'].create({
            'order_id': order.id, 'product_id': self.chips_cheese.id, 'qty_requested': 5, 'price_unit': 10})
        added = po.order_line.filtered(lambda l: l.product_id == self.chips_cheese)
        self.assertEqual(added.product_qty, 5)
        moves = order.picking_ids.move_ids.filtered(lambda m: m.product_id == self.chips_cheese)
        self.assertEqual(len(moves), 1, "the purchase line created no receipt of its own")
        self.assertEqual(moves.purchase_line_id, added)
        for picking in order.picking_ids.filtered(lambda p: p.state != 'cancel'):
            self._validate(picking)
        self.assertEqual(added.qty_received, 5)
