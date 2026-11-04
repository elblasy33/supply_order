import datetime

from odoo import api, fields, models, _
from odoo.fields import Domain


class StockLot(models.Model):
    _inherit = 'stock.lot'

    days_to_expiry = fields.Integer(compute='_compute_days_to_expiry', help="Negative once expired.")
    expiry_state = fields.Selection(
        [('ok', 'OK'), ('alert', 'Alert reached'), ('expired', 'Expired')],
        compute='_compute_expiry_state', search='_search_expiry_state')

    def _expiry_alert_days(self):
        """Alert period: the product's own, else its category's default."""
        self.ensure_one()
        return self.product_id.product_tmpl_id.alert_time or self.product_id.categ_id.expiry_alert_days

    @api.depends('product_id', 'expiration_date')
    def _compute_dates(self):
        super()._compute_dates()
        for lot in self.filtered(lambda l: l.expiration_date and l.product_id.use_expiration_date):
            days = lot._expiry_alert_days()
            if days and not lot.product_id.product_tmpl_id.alert_time and lot.alert_date == lot.expiration_date:
                lot.alert_date = lot.expiration_date - datetime.timedelta(days=days)

    @api.depends('expiration_date')
    @api.depends_context('uid')
    def _compute_days_to_expiry(self):
        today = fields.Date.context_today(self)
        for lot in self:
            lot.days_to_expiry = (lot.expiration_date.date() - today).days if lot.expiration_date else 0

    @api.depends('expiration_date', 'alert_date')
    def _compute_expiry_state(self):
        now = fields.Datetime.now()
        for lot in self:
            if lot.expiration_date and lot.expiration_date <= now:
                lot.expiry_state = 'expired'
            elif lot.alert_date and lot.alert_date <= now:
                lot.expiry_state = 'alert'
            else:
                lot.expiry_state = 'ok'

    def _search_expiry_state(self, operator, value):
        now = fields.Datetime.now()
        by_state = {
            'expired': Domain('expiration_date', '<=', now),
            'alert': Domain('alert_date', '<=', now) & Domain('expiration_date', '>', now),
            'ok': Domain('alert_date', '=', False) | Domain('alert_date', '>', now),
        }
        values = [v for v in ([value] if isinstance(value, str) else value) if v in by_state]
        positive = Domain.OR([by_state[v] for v in values])
        return ~positive if operator in ('!=', 'not in') else positive

    @api.model
    def _alert_date_exceeded(self):
        """Besides the activity for the product's responsible, warn the stock managers once per lot."""
        pending = self.search([('alert_date', '<=', fields.Date.today()), ('product_expiry_reminded', '=', False)])
        super()._alert_date_exceeded()
        alerted = pending.filtered('product_expiry_reminded')
        managers = self.env.ref('stock.group_stock_manager').user_ids.filtered(lambda u: not u.share)
        for lot in alerted:
            for user in managers:
                lot.activity_schedule(
                    'mail.mail_activity_data_todo', user_id=user.id,
                    summary=_("Expiry alert: %s", lot.display_name),
                    note=_("Lot %(lot)s of %(product)s expires on %(date)s.",
                           lot=lot.name, product=lot.product_id.display_name, date=lot.expiration_date))
