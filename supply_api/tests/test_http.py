import datetime
import json

from odoo.tests import HttpCase, tagged



@tagged('post_install', '-at_install')
class TestSupplyApiHttp(HttpCase):
    """The real HTTP surface: JSON-2 with an API key, and the key-authenticated print routes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['res.users'].create({
            'name': 'Integration HTTP', 'login': 'svc_supply_http',
            'group_ids': [(6, 0, [cls.env.ref('supply_order.group_supply_manager').id,
                                  cls.env.ref('account.group_account_invoice').id])]})
        cls.env['ir.config_parameter'].sudo().set_int('supply_order.service_user_id', cls.service.id)
        expiration = datetime.datetime.now() + datetime.timedelta(days=1)
        cls.key = cls.env['res.users.apikeys'].with_user(cls.service).sudo()._generate('rpc', 'test', expiration)
        cls.ext = cls.env['external.user'].create({'name': 'Http Sales', 'login': 'http.sales', 'role': 'sales'})
        cls.customer = cls.env['res.partner'].create({'name': 'Http Customer'})
        cls.product = cls.env['product.product'].create({
            'name': 'Http Chips', 'type': 'consu', 'list_price': 12, 'taxes_id': False})
        cls.order = cls.env['supply.order'].create({
            'partner_id': cls.customer.id, 'order_type': 'sale', 'supply_ref': 'HTTP-1',
            'line_ids': [(0, 0, {'product_id': cls.product.id, 'qty_requested': 4, 'price_unit': 12})]})

    def headers(self):
        return {'Authorization': 'Bearer %s' % self.key, 'Content-Type': 'application/json'}

    def call(self, method, **body):
        response = self.url_open('/json/2/supply.api/%s' % method, data=json.dumps(body), headers=self.headers())
        return response

    # JSON-2 --------------------------------------------------------------------
    def test_01_json2_read_and_write_with_app_user_context(self):
        response = self.call('order_read', id=self.order.id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body['ok'])
        self.assertEqual(body['data']['supply_ref'], 'HTTP-1')
        response = self.call('order_action', id=self.order.id, action='confirm', idempotency_key='k-1',
                             context={'ext_user_id': self.ext.id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['ok'], response.text)
        self.assertEqual(self.order.state, 'confirmed')
        self.assertIn('Http Sales', ' '.join(self.order.message_ids.mapped('body')))
        replay = self.call('order_action', id=self.order.id, action='confirm', idempotency_key='k-1',
                           context={'ext_user_id': self.ext.id})
        self.assertEqual(replay.json(), response.json(), "the replay returns the first answer")

    def test_02_business_errors_are_200_envelopes(self):
        response = self.call('order_action', id=self.order.id, action='prepare_transfer',
                             context={'ext_user_id': self.ext.id})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['error']['code'], 'access_denied')

    def test_03_no_key_no_access(self):
        response = self.url_open('/json/2/supply.api/order_read', data=json.dumps({'id': self.order.id}),
                                 headers={'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 401)
        bad = self.url_open('/json/2/supply.api/order_read', data=json.dumps({'id': self.order.id}),
                            headers={'Authorization': 'Bearer nonsense', 'Content-Type': 'application/json'})
        self.assertEqual(bad.status_code, 401)

    # print routes -------------------------------------------------------------------------
    def get(self, path, key=True):
        return self.url_open(path, headers={'Authorization': 'Bearer %s' % self.key} if key else {})

    def test_10_quotation_in_three_formats(self):
        base = '/supply_api/print/quotation/%s/' + str(self.order.id)
        html = self.get(base % 'html')
        self.assertEqual(html.status_code, 200)
        self.assertIn('HTTP-1', html.text)
        self.assertNotIn('ic-toolbar', html.text, "the app shows its own toolbar")
        pdf = self.get(base % 'pdf')  # test mode renders reports as HTML: check the headers here, see test_20
        self.assertEqual((pdf.status_code, pdf.headers['Content-Type']), (200, 'application/pdf'))
        self.assertIn('.pdf', pdf.headers['Content-Disposition'])
        xlsx = self.get(base % 'xlsx')
        self.assertEqual((xlsx.status_code, xlsx.content[:2]), (200, b'PK'))
        self.assertIn('spreadsheetml', xlsx.headers['Content-Type'])

    def test_11_commercial_bill_and_invoice(self):
        self.order.action_confirm()
        picking = self.order.action_prepare_transfer()
        for move in picking.move_ids:
            move.quantity = move.product_uom_qty
            move.picked = True
        picking.with_context(skip_backorder=True).button_validate()
        bill = self.get('/supply_api/print/commercial_bill/html/%s' % self.order.id)
        self.assertEqual(bill.status_code, 200)
        self.assertIn('Http Chips', bill.text)
        invoice = self.order.action_create_invoice()
        self.assertEqual(self.get('/supply_api/print/invoice/pdf/%s' % invoice.id).headers['Content-Type'],
                         'application/pdf')
        self.assertEqual(self.get('/supply_api/print/invoice/xlsx/%s' % invoice.id).content[:2], b'PK')

    def test_12_unauthenticated_and_unknown_requests_are_refused(self):
        path = '/supply_api/print/quotation/pdf/%s' % self.order.id
        self.assertEqual(self.get(path, key=False).status_code, 401)
        self.assertEqual(self.get('/supply_api/print/secrets/pdf/1').status_code, 404)
        self.assertEqual(self.get('/supply_api/print/quotation/doc/%s' % self.order.id).status_code, 404)
        self.assertEqual(self.get('/supply_api/print/quotation/pdf/99999999').status_code, 404)
