from odoo import api, fields, models, _


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    auto_generated = fields.Boolean(string='Auto-generated', readonly=True, copy=False, index=True,
                                    help="Created by the scheduler (replenish on order or reordering rule).")
    auto_source = fields.Selection([('mto', 'Replenish on order'), ('reorder', 'Reordering rule')],
                                   string='Created automatically by', readonly=True, copy=False)
    late_alerted = fields.Boolean(copy=False)
    is_late_receipt = fields.Boolean(string='Late receipt', compute='_compute_is_late_receipt',
                                     search='_search_is_late_receipt')

    def _late_domain(self):
        return [('state', '=', 'purchase'), ('receipt_status', '!=', 'full'),
                ('date_planned', '<', fields.Datetime.now())]

    @api.depends('state', 'receipt_status', 'date_planned')
    def _compute_is_late_receipt(self):
        now = fields.Datetime.now()
        for order in self:
            order.is_late_receipt = bool(
                order.state == 'purchase' and order.receipt_status != 'full'
                and order.date_planned and order.date_planned < now)

    def _search_is_late_receipt(self, operator, value):
        values = {value} if isinstance(value, bool) else set(value)  # Odoo may pass `in {True}`
        late = (True in values) == (operator in ('=', 'in'))
        domain = self._late_domain()
        return domain if late else ['!', '&', '&'] + domain

    def _managers(self):
        return self.env.ref('purchase.group_purchase_manager').user_ids.filtered(lambda u: not u.share)

    def _notify_auto_generated(self, source):
        """Tell the purchase managers, and link the supply order that caused the purchase."""
        for order in self:
            order.write({'auto_generated': True, 'auto_source': source})
            supply = order.order_line.move_dest_ids.supply_line_id.order_id
            if len(supply) == 1 and not order.supply_order_id:
                order.supply_order_id = supply
            order.message_post(body=_("Purchase order created automatically (%s).",
                                      dict(self._fields['auto_source'].selection)[source]))
            for user in order._managers():
                order.activity_schedule(
                    'mail.mail_activity_data_todo', user_id=user.id,
                    summary=_("Automatic purchase order %s", order.name or ''),
                    note=_("Review and confirm: created by the scheduler."))

    @api.model
    def _cron_late_auto_purchase_alert(self):
        late = self.search(self._late_domain() + [('auto_generated', '=', True), ('late_alerted', '=', False)])
        for order in late:
            for user in order._managers():
                order.activity_schedule(
                    'mail.mail_activity_data_todo', user_id=user.id,
                    summary=_("Late receipt: %s", order.name),
                    note=_("Planned for %s and not fully received.", order.date_planned))
        late.write({'late_alerted': True})


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        for line in lines:
            order = line.order_id
            if order.auto_generated or order.state not in ('draft', 'sent'):
                continue
            if line.move_dest_ids:
                order._notify_auto_generated('mto')
            elif line.orderpoint_id:
                order._notify_auto_generated('reorder')
        return lines
