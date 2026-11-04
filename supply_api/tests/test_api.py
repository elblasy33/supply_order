import datetime
import uuid

from odoo import fields
from odoo.tests import tagged

from odoo.addons.supply_order.tests.test_supply_flow import SupplyCase


class ApiCase(SupplyCase):
    """Calls ``supply.api`` exactly as the JSON-2 endpoint does: as the integration user, with the app
    user in the context."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['res.users'].create({
            'name': 'Integration', 'login': 'svc_supply_api',
            'group_ids': [(6, 0, [cls.env.ref('supply_order.group_supply_manager').id,
                                  cls.env.ref('account.group_account_invoice').id,
                                  cls.env.ref('stock.group_stock_manager').id])]})
        cls.env['ir.config_parameter'].sudo().set_int('supply_order.service_user_id', cls.service.id)
        ExtUser = cls.env['external.user']
        cls.sales = ExtUser.create({'name': 'Sara', 'login': 'api.sales', 'role': 'sales'})
        cls.keeper = ExtUser.create({'name': 'Wael', 'login': 'api.wh', 'role': 'warehouse'})
        cls.accountant = ExtUser.create({'name': 'Amal', 'login': 'api.acc', 'role': 'accountant'})
        cls.boss = ExtUser.create({'name': 'Mona', 'login': 'api.boss', 'role': 'manager'})

    def api(self, who=None, **ctx):
        env = self.env['supply.api'].with_user(self.service)
        if who:
            ctx['ext_user_id'] = who.id
        return env.with_context(**ctx)

    def ok(self, result):
        self.assertTrue(result['ok'], result)
        return result['data']

    def bad(self, result, code):
        self.assertFalse(result['ok'], result)
        self.assertEqual(result['error']['code'], code, result)
        return result['error']

    def make_order(self, who=None, order_type='sale', qty=10, confirm=False):
        api = self.api(who or self.sales)
        data = self.ok(api.order_create(
            partner_id=(self.customer if order_type == 'sale' else self.vendor).id, order_type=order_type,
            supply_ref='API-1', lines=[{'product_id': self.chips_hot.id, 'qty_requested': qty, 'price_unit': 10}]))
        if confirm:
            data = self.ok(api.order_action(id=data['id'], action='confirm'))
        return data


@tagged('post_install', '-at_install')
class TestSupplyApi(ApiCase):

    # envelope ---------------------------------------------------------------------
    def test_01_read_gives_the_full_order(self):
        order = self.make_order()
        data = self.ok(self.api(self.sales).order_read(id=order['id']))
        self.assertEqual((data['state'], data['order_type'], data['supply_ref']), ('draft', 'sale', 'API-1'))
        self.assertEqual(data['partner']['name'], 'Test Customer')
        line = data['lines'][0]
        self.assertEqual((line['line_no'], line['qty_requested'], line['product']['name']), (1, 10, 'Chips Hot'))
        self.assertEqual(data['amount_total'], 100)
        self.assertIn('confirm', data['allowed_actions'])
        self.assertNotIn('prepare_transfer', data['allowed_actions'])

    def test_02_errors_come_back_as_envelopes_not_exceptions(self):
        self.bad(self.api().order_read(id=0), 'not_found')
        self.bad(self.api().order_read(id=99999999), 'not_found')
        self.bad(self.api(self.sales).order_action(id=self.make_order()['id'], action='fly'), 'validation_error')
        empty = self.ok(self.api(self.sales).order_create(partner_id=self.customer.id, order_type='sale'))
        error = self.bad(self.api(self.sales).order_action(id=empty['id'], action='confirm'), 'user_error')
        self.assertIn('at least one line', error['message'])

    def test_03_a_failed_call_leaves_nothing_behind(self):
        before = self.env['supply.order'].search_count([])
        result = self.api(self.sales).order_create(
            partner_id=self.customer.id, order_type='sale',
            lines=[{'product_id': self.chips_hot.id, 'qty_requested': 1}, {'nonsense': 3}])
        self.bad(result, 'validation_error')
        self.assertEqual(self.env['supply.order'].search_count([]), before, "the order was rolled back")

    # idempotency ---------------------------------------------------------------------
    def test_04_same_key_same_answer_one_effect(self):
        key = str(uuid.uuid4())
        api = self.api(self.sales)
        vals = dict(partner_id=self.customer.id, order_type='sale', supply_ref='IDEM-1', idempotency_key=key)
        first = self.ok(api.order_create(**vals))
        again = self.ok(api.order_create(**vals))
        self.assertEqual(first['id'], again['id'])
        self.assertEqual(self.env['supply.order'].search_count([('supply_ref', '=', 'IDEM-1')]), 1)
        # the same key for another operation is a conflict, not a replay
        self.bad(api.order_action(id=first['id'], action='cancel', idempotency_key=key), 'conflict')

    def test_05_a_failed_write_is_not_remembered(self):
        key = str(uuid.uuid4())
        api = self.api(self.sales)
        empty = self.ok(api.order_create(partner_id=self.customer.id, order_type='sale'))
        self.bad(api.order_action(id=empty['id'], action='confirm', idempotency_key=key), 'user_error')
        self.ok(api.line_add(order_id=empty['id'], line={'product_id': self.chips_hot.id, 'qty_requested': 2}))
        self.ok(api.order_action(id=empty['id'], action='confirm', idempotency_key=key))  # retry does run

    # roles ---------------------------------------------------------------------------
    def test_06_roles_are_enforced_by_odoo_too(self):
        order = self.make_order(confirm=True)
        oid = order['id']
        self.bad(self.api(self.sales).order_action(id=oid, action='prepare_transfer'), 'access_denied')
        self.bad(self.api(self.accountant).order_action(id=oid, action='prepare_transfer'), 'access_denied')
        self.ok(self.api(self.keeper).order_action(id=oid, action='prepare_transfer'))
        self.bad(self.api(self.keeper).order_action(id=oid, action='create_invoice'), 'access_denied')
        self.bad(self.api(self.keeper).order_create(partner_id=self.customer.id, order_type='sale'), 'access_denied')
        self.bad(self.api(self.sales).order_action(id=oid, action='close'), 'access_denied')
        self.ok(self.api(self.boss).order_action(id=oid, action='close'))

    def test_07_the_integration_user_needs_an_app_user_but_normal_users_do_not(self):
        self.bad(self.api().order_create(partner_id=self.customer.id, order_type='sale'), 'access_denied')
        inactive = self.env['external.user'].create({'name': 'Gone', 'login': 'api.gone', 'role': 'manager',
                                                     'active': False})
        self.bad(self.api(inactive).order_create(partner_id=self.customer.id, order_type='sale'), 'access_denied')
        # a normal Odoo user is not subject to the app roles (Odoo access rights apply)
        normal = self.env['supply.api'].with_user(self.env.user)
        self.ok(normal.order_create(partner_id=self.customer.id, order_type='sale'))

    def test_08_sales_cannot_change_items_after_confirmation_but_warehouse_can(self):
        order = self.make_order(confirm=True)
        line_id = order['lines'][0]['id']
        self.bad(self.api(self.sales).line_update(line_id=line_id, values={'qty_requested': 12}), 'access_denied')
        self.assertNotIn('edit', self.ok(self.api(self.sales).order_read(id=order['id']))['allowed_actions'])
        data = self.ok(self.api(self.keeper).line_update(
            line_id=line_id, values={'qty_requested': 12}, reason='customer asked for more'))
        self.assertEqual(data['lines'][0]['qty_change'], 2)
        entry = data['change_log'][0]
        self.assertEqual((entry['type'], entry['reason'], entry['app_user']), ('qty', 'customer asked for more', 'Wael'))

    # workflow --------------------------------------------------------------------------
    def test_10_full_flow_through_the_api(self):
        order = self.make_order(confirm=True, qty=10)
        oid = order['id']
        moved = self.ok(self.api(self.keeper).order_action(id=oid, action='prepare_transfer'))
        self.assertEqual(moved['created']['model'], 'stock.picking')
        picking = self.env['stock.picking'].browse(moved['created']['id'])
        self._validate(picking, qty=6)
        data = self.ok(self.api(self.accountant).order_action(id=oid, action='create_invoice'))
        self.assertEqual(data['created']['model'], 'account.move')
        self.assertEqual(self.env['account.move'].browse(data['created']['id']).invoice_line_ids.quantity, 6)
        kinds = {d['kind'] for d in data['documents']}
        self.assertTrue({'delivery', 'invoice'} <= kinds)
        self.assertEqual(data['lines'][0]['qty_done'], 6)
        self.assertEqual((data['lines'][0]['qty_invoiced'], data['invoice_state']), (6, 'nothing'),
                         "what was delivered is invoiced; the rest waits for the next delivery")

    def test_11_from_document_and_sale_order_creation(self):
        sale = self.api(self.sales)
        order = self.make_order(confirm=True)
        data = self.ok(sale.order_action(id=order['id'], action='create_sale_order'))
        self.assertEqual(data['created']['model'], 'sale.order')
        self.assertNotIn('create_sale_order', data['allowed_actions'])
        so = self.env['sale.order'].create({
            'partner_id': self.customer.id,
            'order_line': [(0, 0, {'product_id': self.chips_cheese.id, 'product_uom_qty': 3})]})
        so.action_confirm()
        adopted = self.ok(sale.order_from_document(model='sale.order', id=so.id))
        self.assertEqual(adopted['lines'][0]['product']['name'], 'Chips Cheese')
        self.bad(sale.order_from_document(model='sale.order', id=so.id), 'user_error')
        self.bad(sale.order_from_document(model='res.partner', id=so.id), 'validation_error')

    def test_12_lines_add_update_renumber_remove_substitute(self):
        order = self.make_order(qty=5)
        api = self.api(self.sales)
        data = self.ok(api.line_add(order_id=order['id'], line={
            'product_id': self.chips_cheese.id, 'qty_requested': 2, 'price_unit': 8, 'note': 'fresh', 'invoice_group': 'Chips'}))
        self.assertEqual([l['line_no'] for l in data['lines']], [1, 2])
        second = data['lines'][1]
        self.assertEqual((second['note'], second['invoice_group']), ('fresh', 'Chips'))
        data = self.ok(api.line_update(line_id=second['id'], line_no=1))
        self.assertEqual([l['product']['name'] for l in data['lines']], ['Chips Cheese', 'Chips Hot'])
        self.bad(api.line_update(line_id=second['id'], values={'bogus': 1}), 'validation_error')
        data = self.ok(api.line_remove(line_id=second['id']))
        self.assertEqual(len(data['lines']), 1)
        # substitution needs a reason and an order that is confirmed
        keeper = self.api(self.keeper)
        line_id = data['lines'][0]['id']
        self.bad(keeper.line_substitute(line_id=line_id, product_id=self.chips_cheese.id, reason='x'), 'user_error')
        self.ok(self.api(self.sales).order_action(id=order['id'], action='confirm'))
        self.bad(keeper.line_substitute(line_id=line_id, product_id=self.chips_cheese.id, reason=' '), 'validation_error')
        self.bad(self.api(self.sales).line_substitute(line_id=line_id, product_id=self.chips_cheese.id, reason='out'),
                  'access_denied')
        data = self.ok(keeper.line_substitute(line_id=line_id, product_id=self.chips_cheese.id, reason='out of stock'))
        line = data['lines'][0]
        self.assertEqual((line['product']['name'], line['requested_product']['name']), ('Chips Cheese', 'Chips Hot'))
        self.assertEqual(data['change_log'][0]['type'], 'substitute')

    def test_13_removing_with_done_stock_is_a_clean_user_error(self):
        order = self.make_order(confirm=True)
        picking = self.env['stock.picking'].browse(
            self.ok(self.api(self.keeper).order_action(id=order['id'], action='prepare_transfer'))['created']['id'])
        self._validate(picking)
        self.bad(self.api(self.boss).line_remove(line_id=order['lines'][0]['id']), 'user_error')

    # scan ------------------------------------------------------------------------------------
    def test_14_scan_outcomes(self):
        self.chips_hot.barcode = '6221234567890'
        order = self.make_order(qty=1)
        api = self.api(self.sales)
        # same product again raises the quantity (company setting), unknown code is reported
        result = self.ok(api.scan(order_id=order['id'], code='6221234567890'))
        self.assertIn(result['outcome'], ('quantity_increased', 'product_added'))
        qty = sum(l['qty_requested'] for l in result['order']['lines'] if l['product']['name'] == 'Chips Hot')
        self.assertEqual(qty, 2)
        miss = self.ok(api.scan(order_id=order['id'], code='nothing-like-this'))
        self.assertEqual(miss['outcome'], 'unknown')
        self.assertTrue(miss['message'])
        self.chips_cheese.barcode = '6229999999999'
        added = self.ok(api.scan(order_id=order['id'], code='6229999999999'))
        self.assertEqual(added['outcome'], 'product_added')
        self.bad(api.scan(order_id=order['id'], code=' '), 'validation_error')

    def test_15_scan_a_lot_attaches_it_to_its_item(self):
        self.chips_hot.tracking = 'lot'
        lot = self.env['stock.lot'].create({'name': 'LOT-A1', 'product_id': self.chips_hot.id})
        order = self.make_order(qty=1)
        result = self.ok(self.api(self.sales).scan(order_id=order['id'], code='LOT-A1'))
        self.assertEqual(result['outcome'], 'lot_attached')
        self.assertEqual(result['order']['lines'][0]['lot']['id'], lot.id)

    # lists, links, alerts, lookups ------------------------------------------------------------------
    def test_20_search_filters_and_pages(self):
        a = self.make_order()
        self.make_order(order_type='purchase')
        api = self.api()
        found = api.order_search(query='API-1', order_type='sale', limit=1)
        self.assertTrue(found['ok'])
        self.assertEqual((found['limit'], found['offset']), (1, 0))
        self.assertIn(a['id'], [o['id'] for o in found['data']])
        self.assertNotIn('lines', found['data'][0], "lists are summaries")
        self.assertEqual(api.order_search(query='Test Vendor', state=['draft'])['total'], 1)
        self.assertEqual(api.order_search(query='Chips Hot', state=['cancel'])['total'], 0)
        self.assertEqual(api.order_search(limit=100000)['limit'], 200, "the page size is capped")

    def test_21_document_links_point_to_key_authenticated_routes(self):
        order = self.make_order()
        links = self.ok(self.api().document_links(kind='quotation', order_id=order['id']))
        self.assertEqual(links['pdf'], '/supply_api/print/quotation/pdf/%s' % order['id'])
        self.assertEqual(set(links), {'preview', 'pdf', 'xlsx'})
        self.bad(self.api().document_links(kind='nope', order_id=order['id']), 'validation_error')
        self.bad(self.api().document_links(kind='invoice', invoice_id=0), 'not_found')

    def test_22_expiry_alerts_and_auto_purchases(self):
        self.chips_hot.tracking = 'lot'
        now = fields.Datetime.now()
        soon = self.env['stock.lot'].create({'name': 'SOON', 'product_id': self.chips_hot.id,
                                             'expiration_date': now + datetime.timedelta(days=5)})
        far = self.env['stock.lot'].create({'name': 'FAR', 'product_id': self.chips_hot.id,
                                            'expiration_date': now + datetime.timedelta(days=500)})
        gone = self.env['stock.lot'].create({'name': 'GONE', 'product_id': self.chips_hot.id,
                                             'expiration_date': now - datetime.timedelta(days=2)})
        api = self.api()
        within = {l['name'] for l in api.alerts(kind='expiry', filter='within_7')['data']}
        self.assertIn('SOON', within)
        self.assertNotIn('FAR', within)
        expired = {l['name']: l for l in api.alerts(kind='expiry', filter='expired')['data']}
        self.assertEqual(expired['GONE']['expiry_state'], 'expired')
        self.assertLess(expired['GONE']['days_to_expiry'], 0)
        self.assertNotIn('SOON', expired)
        po = self.env['purchase.order'].create({
            'partner_id': self.vendor.id, 'auto_generated': True, 'auto_source': 'mto',
            'order_line': [(0, 0, {'product_id': self.chips_hot.id, 'product_qty': 3, 'price_unit': 5})]})
        rows = api.alerts(kind='auto_purchase', filter='to_confirm')['data']
        self.assertIn(po.id, [r['id'] for r in rows])
        self.assertEqual(api.alerts(kind='auto_purchase', filter='late')['total'], 0)
        self.bad(api.alerts(kind='weather'), 'validation_error')
        self.assertTrue(soon and far and gone)

    def test_23_lookup(self):
        self.chips_hot.barcode = '6221111111111'
        api = self.api()
        by_code = self.ok(api.lookup(kind='product', query='6221111111111'))
        self.assertEqual([p['name'] for p in by_code], ['Chips Hot'])
        self.assertEqual(by_code[0]['sale_price'], 10)
        self.assertEqual(len(self.ok(api.lookup(kind='product', query='Chips', limit=1))), 1)
        self.assertEqual(self.ok(api.lookup(kind='partner', query='Test Vendor'))[0]['name'], 'Test Vendor')
        self.env['stock.lot'].create({'name': 'LKP-1', 'product_id': self.chips_hot.id})
        self.assertEqual(self.ok(api.lookup(kind='lot', query='LKP'))[0]['name'], 'LKP-1')
        self.bad(api.lookup(kind='ghost', query='x'), 'validation_error')

    def test_24_app_users_and_whoami(self):
        api = self.api()
        created = self.ok(api.ext_user_sync(login='api.new', name='New One', role='warehouse', external_id='ext-9'))
        self.assertEqual((created['role'], created['active']), ('warehouse', True))
        again = self.ok(api.ext_user_sync(login='api.new', name='New One', role='accountant', active=False))
        self.assertEqual((again['id'], again['role'], again['active']), (created['id'], 'accountant', False))
        self.bad(api.ext_user_sync(login='api.bad', name='Bad', role='wizard'), 'validation_error')
        who = self.ok(self.api(self.keeper).whoami())
        self.assertEqual(who['app_user']['role'], 'warehouse')
        self.assertIn('prepare_transfer', who['operations'])
        self.assertNotIn('create_invoice', who['operations'])
        self.assertEqual(self.ok(self.api(self.boss).whoami())['operations'], sorted(
            __import__('odoo.addons.supply_api.models.supply_api', fromlist=['ROLE_MATRIX']).ROLE_MATRIX))
        outsider = self.env['supply.api'].with_user(self.env['res.users'].create({
            'name': 'Plain', 'login': 'plain_api', 'group_ids': [(6, 0, [self.env.ref('base.group_user').id])]}))
        self.bad(outsider.ext_user_sync(login='api.evil', name='Evil', role='manager'), 'access_denied')


@tagged('post_install', '-at_install')
class TestSupplyApiAccounting(ApiCase):

    def _invoice(self, partner, amount, move_type='out_invoice'):
        move = self.env['account.move'].create({
            'move_type': move_type, 'partner_id': partner.id, 'invoice_date': fields.Date.today(),
            'invoice_line_ids': [(0, 0, {'name': 'goods', 'quantity': 1, 'price_unit': amount, 'tax_ids': False})]})
        move.action_post()
        return move

    def _payment(self, partner, amount):
        bank = self.env['account.journal'].search([('type', '=', 'bank'), ('company_id', '=', self.company.id)], limit=1)
        payment = self.env['account.payment'].with_context(force_payment_move=True).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': partner.id, 'amount': amount,
            'date': fields.Date.today(), 'journal_id': bank.id})
        payment.action_post()
        return payment

    def test_30_reconcile_load_and_run(self):
        a = self._invoice(self.customer, 100)
        b = self._invoice(self.customer, 200)
        self._payment(self.customer, 150)
        dates = dict(partner_id=self.customer.id, kind='customer',
                     date_from=str(fields.Date.today() - datetime.timedelta(days=30)), date_to=str(fields.Date.today()))
        self.bad(self.api(self.sales).reconcile_load(**dates), 'access_denied')
        loaded = self.ok(self.api(self.accountant).reconcile_load(**dates))
        self.assertEqual({i['document']['id'] for i in loaded['invoices']}, {a.id, b.id})
        self.assertTrue(all(not i['selected'] for i in loaded['invoices']))
        self.assertEqual(sum(i['open_amount'] for i in loaded['payments']), 150)
        self.bad(self.api(self.accountant).reconcile_run(invoice_ids=[], **dates), 'nothing_to_do')
        result = self.ok(self.api(self.accountant).reconcile_run(invoice_ids=[a.id, b.id], **dates))
        self.assertEqual([p['amount'] for p in result['pairs']], [100, 50])
        self.assertEqual(result['remaining'], 150)
        self.assertTrue(result['batch'].startswith('REC-'))
        self.assertEqual(b.amount_residual, 150)

    def test_31_rebates_listing_and_actions(self):
        program = self.env['rebate.program'].create({
            'name': 'API rebate', 'applies_to': 'sale', 'period_type': 'custom',
            'date_from': fields.Date.today() - datetime.timedelta(days=10), 'date_to': fields.Date.today(),
            'tier_ids': [(0, 0, {'threshold': 50, 'reward_type': 'percent', 'value': 10})]})
        accrual = self.env['rebate.accrual'].create({
            'program_id': program.id, 'partner_id': self.customer.id, 'base_amount': 1000,
            'date_from': program.date_from, 'date_to': program.date_to, 'tier_id': program.tier_ids.id})
        listing = self.api(self.accountant).rebate_accruals(state=['draft'])
        self.assertTrue(listing['ok'])
        self.assertIn(accrual.id, [r['id'] for r in listing['data']])
        self.assertEqual(next(r for r in listing['data'] if r['id'] == accrual.id)['amount'], 100)
        self.bad(self.api(self.sales).rebate_action(id=accrual.id, action='settle'), 'access_denied')
        # a rebate must be provisioned before it is settled: the API reports it as a user error
        self.bad(self.api(self.accountant).rebate_action(id=accrual.id, action='settle'), 'user_error')
        self.assertEqual(accrual.state, 'draft')


@tagged('post_install', '-at_install')
class TestSupplyApiReports(ApiCase):
    """The documents really render (a real wkhtmltopdf run), whatever the app asks for."""

    def test_20_pdfs_render_with_the_expected_content(self):
        import shutil
        import subprocess
        import tempfile
        if not (shutil.which('wkhtmltopdf') and shutil.which('pdftotext')):
            self.skipTest("wkhtmltopdf / pdftotext not available")
        order = self.env['supply.order'].browse(self.make_order(confirm=True)['id'])
        Reports = self.env['ir.actions.report'].with_context(force_report_rendering=True)
        for report, expected in (('supply_order.report_supply_quotation', ['Chips Hot', 'API-1']),
                                 ('invoice_customization.report_commercial_bill', [])):
            if report.startswith('invoice_customization'):
                picking = order.action_prepare_transfer()
                self._validate(picking)
                expected = ['Chips Hot']
            pdf, _fmt = Reports._render_qweb_pdf(report, order.ids)
            self.assertEqual(pdf[:4], b'%PDF', report)
            with tempfile.NamedTemporaryFile(suffix='.pdf') as handle:
                handle.write(pdf)
                handle.flush()
                text = subprocess.run(['pdftotext', '-layout', handle.name, '-'], capture_output=True,
                                      text=True, check=True).stdout
            for needle in expected:
                self.assertIn(needle, text, report)
