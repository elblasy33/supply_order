from collections import defaultdict
from datetime import datetime, time, timedelta

import pytz

from odoo import api, fields, models

from .supply_api import endpoint

SECTIONS = ('orders', 'warehouse', 'expiry', 'rebates')
CAP = 20000  # records read per query: a dashboard is a summary, never a full export


class SupplyApiDashboard(models.AbstractModel):
    """Numbers for the dashboard charts, computed in one call so every chart agrees with the others."""
    _inherit = 'supply.api'

    # ---- time helpers ---------------------------------------------------------------------
    def _dash_tz(self):
        return pytz.timezone(self.env.context.get('tz') or self.env.user.tz or 'UTC')

    @staticmethod
    def _dash_bucket(day, granularity):
        if granularity == 'week':
            return day - timedelta(days=day.weekday())
        if granularity == 'month':
            return day.replace(day=1)
        return day

    @staticmethod
    def _dash_next(day, granularity):
        if granularity == 'week':
            return day + timedelta(days=7)
        if granularity == 'month':
            return (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        return day + timedelta(days=1)

    def _dash_local_day(self, tz, value):
        return pytz.utc.localize(value).astimezone(tz).date()

    @api.model
    @api.readonly
    @endpoint()
    def dashboard(self, days=30, sections=None):
        """``days``: length of the period (1-366). ``sections``: any of orders / warehouse / expiry / rebates."""
        days = max(1, min(int(days or 30), 366))
        want = [s for s in (sections or SECTIONS) if s in SECTIONS] or list(SECTIONS)
        tz = self._dash_tz()
        today = datetime.now(tz).date()
        start = today - timedelta(days=days - 1)
        to_utc = lambda d: tz.localize(datetime.combine(d, time.min)).astimezone(pytz.utc).replace(tzinfo=None)
        window = {'tz': tz, 'days': days, 'today': today, 'start': start, 'start_dt': to_utc(start),
                  'prev_dt': to_utc(start - timedelta(days=days)), 'end_dt': to_utc(today + timedelta(days=1)),
                  'granularity': 'day' if days <= 35 else ('week' if days <= 120 else 'month')}
        data = {
            'period': {'days': days, 'start': str(start), 'end': str(today), 'granularity': window['granularity']},
            'currency': self.env.company.currency_id.name,
            'sections': want,
        }
        if 'orders' in want:
            data['orders'] = self._dash_orders(window)
        if 'warehouse' in want:
            data['warehouse'] = self._dash_warehouse(window)
        if 'expiry' in want:
            data['expiry'] = self._dash_expiry(window)
        if 'rebates' in want:
            data['rebates'] = self._dash_rebates()
        return data

    # ---- orders ---------------------------------------------------------------------------------
    def _dash_axis(self, window):
        """Every bucket of the period, so a quiet day is a zero and not a gap."""
        out, day = [], self._dash_bucket(window['start'], window['granularity'])
        while day <= window['today']:
            out.append(day)
            day = self._dash_next(day, window['granularity'])
        return out

    def _dash_orders(self, w):
        env, tz, gran = self.env, w['tz'], w['granularity']
        orders = env['supply.order'].search([('date_order', '>=', w['prev_dt']), ('date_order', '<', w['end_dt'])], limit=CAP)
        cur = orders.filtered(lambda o: o.date_order >= w['start_dt'])
        prev = orders - cur
        live = lambda rs: rs.filtered(lambda o: o.state != 'cancel')
        cur_live, prev_live = live(cur), live(prev)
        value = lambda rs, kind=None: round(sum(o.amount_total for o in rs if kind in (None, o.order_type)), 2)

        def fill(rs):
            lines = rs.filtered(lambda o: o.state in ('confirmed', 'closed')).line_ids
            wanted = sum(lines.mapped('qty_requested'))
            return round(100.0 * sum(lines.mapped('qty_done')) / wanted, 1) if wanted else None

        axis = self._dash_axis(w)
        series = {d: {'date': str(d), 'sale': 0.0, 'purchase': 0.0, 'count': 0} for d in axis}
        for o in cur_live:
            b = series.get(self._dash_bucket(self._dash_local_day(tz, o.date_order), gran))
            if b:
                b[o.order_type] += o.amount_total
                b['count'] += 1
        started = cur_live.filtered(lambda o: o.state != 'draft')
        changes = env['supply.order.change.log'].search([('create_date', '>=', w['start_dt']), ('create_date', '<', w['end_dt'])], limit=CAP)
        by_type = defaultdict(int)
        for c in changes:
            by_type[c.change_type] += 1
        Line = env['supply.order.line']

        def top_items(kind):
            rows = Line._read_group(
                [('order_id', 'in', cur_live.filtered(lambda o: o.order_type == kind).ids)], ['product_id'],
                ['qty_requested:sum', 'qty_done:sum'], order='qty_requested:sum desc', limit=8)
            return [{'product': {'id': p.id, 'name': p.display_name}, 'requested': req, 'done': done} for p, req, done in rows]

        def top_partners(kind):
            rows = env['supply.order']._read_group(
                [('id', 'in', cur_live.filtered(lambda o: o.order_type == kind).ids)], ['partner_id'],
                ['amount_total:sum', '__count'], order='amount_total:sum desc', limit=6)
            return [{'partner': {'id': p.id, 'name': p.display_name}, 'amount': round(amount, 2), 'orders': count}
                    for p, amount, count in rows]

        status = defaultdict(int)
        for o in cur:
            status[o.state] += 1
        Order = env['supply.order']
        return {
            'kpis': {
                'orders': {'value': len(cur_live), 'previous': len(prev_live)},
                'value': {'value': value(cur_live), 'previous': value(prev_live), 'sale': value(cur_live, 'sale'), 'purchase': value(cur_live, 'purchase')},
                'fill_rate': {'value': fill(cur_live), 'previous': fill(prev_live)},
                'changed_share': {'value': round(100.0 * len({c.order_id.id for c in changes}) / len(started), 1) if started else None},
                'to_confirm': Order.search_count([('state', '=', 'draft')]),
                'to_invoice': Order.search_count([('state', '=', 'confirmed'), ('invoice_state', '=', 'to_invoice')]),
            },
            'series': [series[d] for d in axis],
            'status': {s: status.get(s, 0) for s in ('draft', 'confirmed', 'closed', 'cancel')},
            'funnel': [
                {'key': 'confirmed', 'count': len(started)},
                {'key': 'moving', 'count': len(started.filtered(lambda o: o.fulfillment_state in ('partial', 'done')))},
                {'key': 'delivered', 'count': len(started.filtered(lambda o: o.fulfillment_state == 'done'))},
                {'key': 'invoiced', 'count': len(started.filtered(lambda o: o.invoice_state == 'invoiced'))},
            ],
            'top_items': {'sale': top_items('sale'), 'purchase': top_items('purchase')},
            'top_partners': {'sale': top_partners('sale'), 'purchase': top_partners('purchase')},
            'changes': {'by_type': dict(by_type), 'total': len(changes)},
        }

    # ---- warehouse ------------------------------------------------------------------------------
    def _dash_warehouse(self, w):
        env, tz, gran = self.env, w['tz'], w['granularity']
        Picking = env['stock.picking']
        done = Picking.search([('state', '=', 'done'), ('date_done', '>=', w['start_dt']), ('date_done', '<', w['end_dt']),
                               ('picking_type_code', 'in', ['incoming', 'outgoing'])], limit=CAP)
        axis = self._dash_axis(w)
        series = {d: {'date': str(d), 'delivery': 0, 'receipt': 0} for d in axis}
        heat = [[0] * 24 for _ in range(7)]
        for p in done:
            local = pytz.utc.localize(p.date_done).astimezone(tz)
            b = series.get(self._dash_bucket(local.date(), gran))
            if b:
                b['delivery' if p.picking_type_code == 'outgoing' else 'receipt'] += 1
            heat[local.weekday()][local.hour] += 1
        units = {'delivery': 0.0, 'receipt': 0.0}
        for kind, code in (('delivery', 'outgoing'), ('receipt', 'incoming')):
            rows = env['stock.move']._read_group([('picking_id', 'in', done.filtered(lambda p: p.picking_type_code == code).ids),
                                                  ('state', '=', 'done')], [], ['quantity:sum'])
            units[kind] = round(rows[0][0] or 0.0, 2) if rows else 0.0
        ready = ['assigned', 'confirmed', 'waiting']
        return {
            'series': [series[d] for d in axis],
            'heat': heat,  # [weekday 0=Monday][hour]
            'totals': {'delivery': sum(s['delivery'] for s in series.values()), 'receipt': sum(s['receipt'] for s in series.values()), 'units': units},
            'ready': {'delivery': Picking.search_count([('state', 'in', ready), ('picking_type_code', '=', 'outgoing')]),
                      'receipt': Picking.search_count([('state', 'in', ready), ('picking_type_code', '=', 'incoming')])},
        }

    # ---- expiry ---------------------------------------------------------------------------------
    def _dash_expiry(self, w):
        now = fields.Datetime.now()
        lots = self.env['stock.lot'].search([('expiration_date', '!=', False),
                                             ('expiration_date', '<', now + timedelta(days=60))], limit=5000)
        buckets = [{'key': k, 'lots': 0, 'qty': 0.0} for k in ('expired', 'd7', 'd30', 'd60')]
        for lot in lots:
            qty = lot.product_qty
            if qty <= 0:
                continue
            days = (lot.expiration_date - now).total_seconds() / 86400
            b = buckets[0] if days < 0 else buckets[1] if days <= 7 else buckets[2] if days <= 30 else buckets[3]
            b['lots'] += 1
            b['qty'] += qty
        for b in buckets:
            b['qty'] = round(b['qty'], 2)
        return {'buckets': buckets}

    # ---- rebates --------------------------------------------------------------------------------
    def _dash_rebates(self):
        rows = self.env['rebate.accrual']._read_group([('state', '!=', 'cancel')], ['state', 'applies_to'], ['amount:sum'])
        out = {'draft': 0.0, 'confirmed': 0.0, 'settled': 0.0}
        by_kind = {'sale': 0.0, 'purchase': 0.0}
        for state, kind, amount in rows:
            out[state] = round(out.get(state, 0.0) + (amount or 0.0), 2)
            if state != 'settled':
                by_kind[kind] = round(by_kind.get(kind, 0.0) + (amount or 0.0), 2)
        return {'by_state': out, 'open_by_kind': by_kind}
