import datetime

from odoo import fields
from odoo.tests import tagged

from .test_api import ApiCase


@tagged('post_install', '-at_install')
class TestSupplyApiDashboard(ApiCase):

    def setUp(self):
        super().setUp()
        # the database may hold other data (demo, earlier work): push it out of every window so numbers are exact
        self.env.flush_all()
        long_ago = fields.Datetime.now() - datetime.timedelta(days=1000)
        far = fields.Datetime.now() + datetime.timedelta(days=1000)
        cr = self.env.cr
        cr.execute("UPDATE supply_order SET date_order = %s", (long_ago,))
        cr.execute("UPDATE stock_picking SET date_done = %s WHERE date_done IS NOT NULL", (long_ago,))
        cr.execute("UPDATE supply_order_change_log SET create_date = %s", (long_ago,))
        cr.execute("UPDATE stock_lot SET expiration_date = %s WHERE expiration_date IS NOT NULL", (far,))
        cr.execute("UPDATE rebate_accrual SET state = 'cancel'")
        self.env.invalidate_all()

    def test_01_numbers_follow_what_happened(self):
        base_ready = self.ok(self.api().dashboard(sections=['warehouse']))['warehouse']['ready']['delivery']
        # a sale of 10 x 10 delivered in two steps and invoiced; a purchase left in draft; a cancelled one
        sale = self.make_order(confirm=True, qty=10)
        pid = self.ok(self.api(self.keeper).order_action(id=sale['id'], action='prepare_transfer'))['created']['id']
        move_id = self.ok(self.api().picking_read(id=pid))['moves'][0]['id']
        self.ok(self.api(self.keeper).picking_save(id=pid, lines=[{'move_id': move_id, 'quantity': 6}]))
        self.ok(self.api(self.keeper).picking_validate(id=pid, backorder='create'))
        self.ok(self.api(self.accountant).order_action(id=sale['id'], action='create_invoice'))
        self.make_order(order_type='purchase', qty=5)
        gone = self.make_order(qty=3)
        self.ok(self.api(self.sales).order_action(id=gone['id'], action='cancel'))

        d = self.ok(self.api().dashboard(days=30))
        self.assertEqual(d['period']['days'], 30)
        self.assertEqual(d['period']['granularity'], 'day')
        self.assertEqual(d['currency'], self.company.currency_id.name)
        o = d['orders']
        self.assertGreaterEqual(o['kpis']['orders']['value'], 2)  # cancelled orders do not count
        self.assertGreaterEqual(o['kpis']['value']['sale'], 100)
        self.assertGreaterEqual(o['kpis']['value']['purchase'], 50)
        self.assertEqual(len(o['series']), 30)
        self.assertEqual(sum(s['count'] for s in o['series']), o['kpis']['orders']['value'])
        self.assertEqual(o['series'][-1]['sale'], o['kpis']['value']['sale'])  # everything happened today
        self.assertEqual(o['status']['cancel'], 1)
        funnel = {f['key']: f['count'] for f in o['funnel']}
        self.assertGreaterEqual(funnel['confirmed'], funnel['moving'])
        self.assertGreaterEqual(funnel['moving'], funnel['delivered'])
        self.assertGreaterEqual(funnel['delivered'], funnel['invoiced'])
        self.assertEqual(o['kpis']['fill_rate']['value'], 60.0)  # 6 of 10 really delivered
        names = [i['product']['name'] for i in o['top_items']['sale']]
        self.assertIn('Chips Hot', names)
        top = next(i for i in o['top_items']['sale'] if i['product']['name'] == 'Chips Hot')
        self.assertEqual((top['requested'], top['done']), (10, 6))
        self.assertEqual(o['top_partners']['sale'][0]['partner']['name'], 'Test Customer')
        self.assertEqual(o['top_partners']['purchase'][0]['partner']['name'], 'Test Vendor')

        w = d['warehouse']
        self.assertEqual(w['totals']['delivery'], 1)
        self.assertEqual(w['totals']['units']['delivery'], 6)
        self.assertEqual(w['ready']['delivery'], base_ready + 1)  # the backorder
        self.assertEqual(sum(sum(row) for row in w['heat']), 1)
        self.assertEqual(sum(s['delivery'] for s in w['series']), 1)
        self.assertEqual(len(w['heat']), 7)
        self.assertEqual(len(w['heat'][0]), 24)

    def test_02_periods_buckets_and_sections(self):
        self.make_order()
        week = self.ok(self.api().dashboard(days=90, sections=['orders']))
        self.assertEqual(week['period']['granularity'], 'week')
        self.assertEqual(set(week), {'period', 'currency', 'sections', 'orders'})
        self.assertLessEqual(len(week['orders']['series']), 14)
        month = self.ok(self.api().dashboard(days=366, sections=['orders']))
        self.assertEqual(month['period']['granularity'], 'month')
        self.assertEqual(self.ok(self.api().dashboard(days=0, sections=['orders']))['period']['days'], 30)  # sane default
        self.assertEqual(self.ok(self.api().dashboard(days=9999, sections=['orders']))['period']['days'], 366)
        self.assertEqual(self.ok(self.api().dashboard(sections=['nonsense']))['sections'], list(['orders', 'warehouse', 'expiry', 'rebates']))

    def test_03_expiry_buckets_and_changes_and_rebates(self):
        self.chips_hot.tracking = 'lot'
        now = fields.Datetime.now()
        for name, days, qty in (('E-OLD', -3, 4), ('E-WEEK', 5, 6), ('E-MONTH', 20, 8), ('E-TWO', 50, 10), ('E-FAR', 200, 99), ('E-EMPTY', 3, 0)):
            lot = self.env['stock.lot'].create({'name': name, 'product_id': self.chips_hot.id, 'expiration_date': now + datetime.timedelta(days=days)})
            if qty:
                self.env['stock.quant']._update_available_quantity(self.chips_hot, self.wh.lot_stock_id, qty, lot_id=lot)
        b = {x['key']: x for x in self.ok(self.api().dashboard(sections=['expiry']))['expiry']['buckets']}
        self.assertEqual((b['expired']['lots'], b['expired']['qty']), (1, 4))
        self.assertEqual((b['d7']['lots'], b['d7']['qty']), (1, 6))  # the empty lot is not exposure
        self.assertEqual((b['d30']['lots'], b['d60']['lots']), (1, 1))

        order = self.make_order(confirm=True, qty=5)
        self.ok(self.api(self.boss).line_update(line_id=order['lines'][0]['id'], values={'qty_requested': 7}, reason='more'))
        ch = self.ok(self.api().dashboard(sections=['orders']))['orders']
        self.assertEqual(ch['changes']['by_type'].get('qty'), 1)
        self.assertEqual(ch['kpis']['changed_share']['value'], 100.0)

        program = self.env['rebate.program'].create({
            'name': 'dash', 'applies_to': 'sale', 'period_type': 'custom', 'date_from': fields.Date.today() - datetime.timedelta(days=5),
            'date_to': fields.Date.today(), 'tier_ids': [(0, 0, {'threshold': 1, 'reward_type': 'fixed', 'value': 25})]})
        self.env['rebate.accrual'].create({'program_id': program.id, 'partner_id': self.customer.id, 'base_amount': 500,
                                           'date_from': program.date_from, 'date_to': program.date_to, 'tier_id': program.tier_ids.id})
        r = self.ok(self.api().dashboard(sections=['rebates']))['rebates']
        self.assertEqual(r['by_state']['draft'], 25)
        self.assertEqual(r['open_by_kind']['sale'], 25)
