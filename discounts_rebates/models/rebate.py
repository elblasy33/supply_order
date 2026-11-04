import calendar
import datetime

from odoo import api, Command, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import float_is_zero


class RebateProgram(models.Model):
    """Deferred discount: the turnover of a partner over a period decides a reward granted afterwards."""
    _name = 'rebate.program'
    _description = 'Rebate program'
    _inherit = ['mail.thread']
    _order = 'name'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id')
    applies_to = fields.Selection([('sale', 'Sales (rebate we grant)'), ('purchase', 'Purchases (rebate we receive)')],
                                  required=True, default='sale', tracking=True)
    period_type = fields.Selection(
        [('daily', 'Daily'), ('weekly', 'Weekly'), ('monthly', 'Monthly'), ('custom', 'Custom period')],
        required=True, default='monthly')
    date_from = fields.Date(string='Period start', help="Custom period only.")
    date_to = fields.Date(string='Period end', help="Custom period only.")
    partner_ids = fields.Many2many('res.partner', string='Partners', help="Empty: every partner.")
    product_ids = fields.Many2many('product.product', string='Products', help="Empty: every product.")
    category_ids = fields.Many2many('product.category', string='Product Categories')
    tier_ids = fields.One2many('rebate.tier', 'program_id', string='Tiers', copy=True)
    last_period_end = fields.Date(readonly=True, copy=False, help="Last period already computed.")
    accrual_ids = fields.One2many('rebate.accrual', 'program_id')
    accrual_count = fields.Integer(compute='_compute_accrual_count')

    @api.depends('accrual_ids')
    def _compute_accrual_count(self):
        for program in self:
            program.accrual_count = len(program.accrual_ids)

    @api.constrains('period_type', 'date_from', 'date_to')
    def _check_custom_period(self):
        for program in self.filtered(lambda p: p.period_type == 'custom'):
            if not program.date_from or not program.date_to or program.date_from > program.date_to:
                raise ValidationError(_("A custom period needs a start date before its end date."))

    # --- periods ----------------------------------------------------------------------------
    @staticmethod
    def _period_ending_before(period_type, today):
        """Latest complete period before ``today``."""
        if period_type == 'daily':
            day = today - datetime.timedelta(days=1)
            return day, day
        if period_type == 'weekly':
            end = today - datetime.timedelta(days=today.weekday() + 1)
            return end - datetime.timedelta(days=6), end
        end = today.replace(day=1) - datetime.timedelta(days=1)
        return end.replace(day=1), end

    @staticmethod
    def _next_period(period_type, last_end):
        start = last_end + datetime.timedelta(days=1)
        if period_type == 'daily':
            return start, start
        if period_type == 'weekly':
            return start, start + datetime.timedelta(days=6)
        return start, start.replace(day=calendar.monthrange(start.year, start.month)[1])

    def _closed_periods(self, today=None):
        """Periods that ended and were not computed yet (the latest one, or the ones missed since the last run)."""
        self.ensure_one()
        today = today or fields.Date.context_today(self)
        if self.period_type == 'custom':
            if self.date_to and today > self.date_to and self.last_period_end != self.date_to:
                return [(self.date_from, self.date_to)]
            return []
        latest = self._period_ending_before(self.period_type, today)
        if not self.last_period_end:
            return [latest]
        periods = []
        start, end = self._next_period(self.period_type, self.last_period_end)
        while end <= latest[1] and len(periods) < 12:
            periods.append((start, end))
            start, end = self._next_period(self.period_type, end)
        return periods

    # --- computation ------------------------------------------------------------------------
    def _turnover_by_partner(self, date_from, date_to):
        """Net turnover (company currency, untaxed) of every partner on posted invoices and credit notes."""
        self.ensure_one()
        types = ['out_invoice', 'out_refund'] if self.applies_to == 'sale' else ['in_invoice', 'in_refund']
        domain = [('company_id', '=', self.company_id.id), ('parent_state', '=', 'posted'),
                  ('display_type', '=', 'product'), ('move_id.move_type', 'in', types),
                  ('date', '>=', date_from), ('date', '<=', date_to)]
        if self.partner_ids:
            domain.append(('move_id.commercial_partner_id', 'in', self.partner_ids.ids))
        if self.product_ids or self.category_ids:
            domain += ['|', ('product_id', 'in', self.product_ids.ids),
                       ('product_id.categ_id', 'in', self.category_ids.ids)]
        sign = -1 if self.applies_to == 'sale' else 1  # income lines are credits, purchase lines are debits
        groups = self.env['account.move.line']._read_group(
            domain, ['move_id.commercial_partner_id'], ['balance:sum'])
        return {partner.id: sign * balance for partner, balance in groups}

    def _tier_for(self, amount):
        self.ensure_one()
        reached = self.tier_ids.filtered(lambda t: amount >= t.threshold).sorted('threshold', reverse=True)
        return reached[:1]

    def _compute_period(self, date_from, date_to):
        """Create the draft accruals of a closed period (idempotent: one per program, partner and period)."""
        self.ensure_one()
        created = self.env['rebate.accrual']
        existing = set(self.accrual_ids.filtered(
            lambda a: a.date_from == date_from and a.date_to == date_to).partner_id.ids)
        for partner_id, base in self._turnover_by_partner(date_from, date_to).items():
            tier = self._tier_for(base)
            if not tier or partner_id in existing:
                continue
            created |= self.env['rebate.accrual'].create({
                'program_id': self.id, 'partner_id': partner_id, 'date_from': date_from, 'date_to': date_to,
                'base_amount': base, 'tier_id': tier.id})
        self.last_period_end = date_to
        return created

    def action_compute_closed_periods(self):
        created = self.env['rebate.accrual']
        for program in self:
            for date_from, date_to in program._closed_periods():
                created |= program._compute_period(date_from, date_to)
        return {
            'type': 'ir.actions.act_window', 'name': _('Rebate Accruals'), 'res_model': 'rebate.accrual',
            'view_mode': 'list,form', 'domain': [('id', 'in', created.ids)],
        }

    @api.model
    def _cron_compute_rebates(self):
        self.search([]).action_compute_closed_periods()

    def action_view_accruals(self):
        self.ensure_one()
        return {'type': 'ir.actions.act_window', 'name': _('Rebate Accruals'), 'res_model': 'rebate.accrual',
                'view_mode': 'list,form,pivot', 'domain': [('program_id', '=', self.id)]}


class RebateTier(models.Model):
    _name = 'rebate.tier'
    _description = 'Rebate tier'
    _order = 'program_id, threshold'

    program_id = fields.Many2one('rebate.program', required=True, ondelete='cascade')
    threshold = fields.Monetary(string='Turnover from', required=True, currency_field='currency_id',
                                help="The highest tier reached applies to the whole turnover of the period.")
    reward_type = fields.Selection([('percent', 'Percentage'), ('fixed', 'Fixed amount'),
                                    ('free_product', 'Free products')], required=True, default='percent')
    value = fields.Float(string='Percentage / amount', digits='Product Price')
    product_id = fields.Many2one('product.product', string='Free product', domain=[('type', '=', 'consu')])
    quantity = fields.Float(string='Free quantity', default=1.0)
    currency_id = fields.Many2one(related='program_id.currency_id')

    @api.constrains('reward_type', 'value', 'product_id', 'quantity')
    def _check_reward(self):
        for tier in self:
            if tier.reward_type == 'free_product' and (not tier.product_id or tier.quantity <= 0):
                raise ValidationError(_("A free-product tier needs a product and a positive quantity."))
            if tier.reward_type != 'free_product' and tier.value <= 0:
                raise ValidationError(_("The tier reward must be positive."))
            if tier.reward_type == 'percent' and tier.value > 100:
                raise ValidationError(_("A percentage reward cannot exceed 100."))


class RebateAccrual(models.Model):
    """What one partner is entitled to for one period: provisioned, then settled by a credit/debit note."""
    _name = 'rebate.accrual'
    _description = 'Rebate accrual'
    _inherit = ['mail.thread']
    _order = 'date_to desc, id desc'

    name = fields.Char(compute='_compute_name', store=True)
    program_id = fields.Many2one('rebate.program', required=True, ondelete='restrict', index=True)
    applies_to = fields.Selection(related='program_id.applies_to', store=True)
    company_id = fields.Many2one(related='program_id.company_id', store=True)
    currency_id = fields.Many2one(related='program_id.currency_id')
    partner_id = fields.Many2one('res.partner', required=True, index=True)
    date_from = fields.Date(required=True)
    date_to = fields.Date(required=True)
    base_amount = fields.Monetary(string='Turnover', currency_field='currency_id')
    tier_id = fields.Many2one('rebate.tier', ondelete='restrict')
    reward_type = fields.Selection(related='tier_id.reward_type', store=True)
    amount = fields.Monetary(string='Rebate', compute='_compute_amount', store=True, currency_field='currency_id')
    free_product_id = fields.Many2one(related='tier_id.product_id')
    free_quantity = fields.Float(related='tier_id.quantity')
    state = fields.Selection([('draft', 'To review'), ('confirmed', 'Provisioned'), ('settled', 'Settled'),
                              ('cancel', 'Cancelled')], default='draft', required=True, tracking=True, index=True)
    provision_move_id = fields.Many2one('account.move', string='Provision entry', readonly=True, copy=False)
    credit_note_id = fields.Many2one('account.move', string='Credit / debit note', readonly=True, copy=False)
    supply_order_id = fields.Many2one('supply.order', string='Free goods order', readonly=True, copy=False)

    _unique_period = models.Constraint(
        'unique(program_id, partner_id, date_from, date_to)', 'This partner already has an accrual for that period.')

    @api.depends('program_id.name', 'partner_id.name', 'date_from', 'date_to')
    def _compute_name(self):
        for accrual in self:
            accrual.name = '%s — %s (%s → %s)' % (
                accrual.program_id.name, accrual.partner_id.name, accrual.date_from, accrual.date_to)

    @api.depends('base_amount', 'tier_id.reward_type', 'tier_id.value')
    def _compute_amount(self):
        for accrual in self:
            tier = accrual.tier_id
            if tier.reward_type == 'percent':
                accrual.amount = accrual.currency_id.round(accrual.base_amount * tier.value / 100.0)
            elif tier.reward_type == 'fixed':
                accrual.amount = accrual.currency_id.round(tier.value)
            else:
                accrual.amount = 0.0

    # --- workflow ---------------------------------------------------------------------------
    def _accounts(self):
        """(debit account, credit account) of the provision entry."""
        self.ensure_one()
        company = self.company_id
        company._check_rebate_setup(self.applies_to)
        if self.applies_to == 'sale':
            return company.rebate_expense_account_id, company.rebate_accrual_sale_account_id
        return company.rebate_accrual_purchase_account_id, company.rebate_income_account_id

    def action_confirm(self):
        for accrual in self:
            if accrual.state != 'draft':
                raise UserError(_("Only accruals to review can be provisioned."))
            if accrual.reward_type == 'free_product':
                accrual.supply_order_id = accrual._create_free_goods_order()
            elif not float_is_zero(accrual.amount, precision_rounding=accrual.currency_id.rounding):
                debit, credit = accrual._accounts()
                accrual.provision_move_id = accrual.env['account.move'].create({
                    'move_type': 'entry', 'journal_id': accrual.company_id.rebate_journal_id.id,
                    'date': accrual.date_to, 'ref': accrual.name,
                    'line_ids': [
                        Command.create({'account_id': debit.id, 'debit': accrual.amount, 'credit': 0.0,
                                        'partner_id': accrual.partner_id.id, 'name': accrual.name}),
                        Command.create({'account_id': credit.id, 'debit': 0.0, 'credit': accrual.amount,
                                        'partner_id': accrual.partner_id.id, 'name': accrual.name})]})
                accrual.provision_move_id.action_post()
            accrual.state = 'confirmed'
        return True

    def _create_free_goods_order(self):
        self.ensure_one()
        return self.env['supply.order'].create({
            'partner_id': self.partner_id.id, 'company_id': self.company_id.id,
            'order_type': self.applies_to, 'supply_ref': self.program_id.name,
            'note': _("Free goods: %s", self.name),
            'line_ids': [Command.create({
                'product_id': self.free_product_id.id, 'qty_requested': self.free_quantity,
                'price_unit': 0.0, 'discount': 0.0, 'line_note': self.program_id.name})]})

    def action_settle(self):
        """Issue the credit note (customer) or the vendor credit note request of the rebate."""
        for accrual in self:
            if accrual.state != 'confirmed':
                raise UserError(_("Provision the rebate before settling it."))
            if accrual.reward_type != 'free_product':
                is_sale = accrual.applies_to == 'sale'
                # the note clears the provision instead of touching revenue/purchases a second time
                _debit, _credit = accrual._accounts()
                account = _credit if is_sale else _debit
                accrual.credit_note_id = accrual.env['account.move'].create({
                    'move_type': 'out_refund' if is_sale else 'in_refund',
                    'partner_id': accrual.partner_id.id, 'company_id': accrual.company_id.id,
                    'invoice_date': fields.Date.context_today(accrual), 'ref': accrual.name,
                    'invoice_origin': accrual.program_id.name,
                    'invoice_line_ids': [Command.create({
                        'name': _("Rebate %(program)s (%(start)s → %(end)s)", program=accrual.program_id.name,
                                  start=accrual.date_from, end=accrual.date_to),
                        'quantity': 1.0, 'price_unit': accrual.amount, 'account_id': account.id, 'tax_ids': False})]})
            accrual.state = 'settled'
        return True

    def action_cancel(self):
        for accrual in self:
            if accrual.state == 'settled':
                raise UserError(_("A settled rebate cannot be cancelled: cancel its credit note first."))
            move = accrual.provision_move_id
            if move and move.state == 'posted':
                move._reverse_moves(
                    [{'ref': _("Reversal of %s", accrual.name), 'date': fields.Date.context_today(accrual)}],
                    cancel=True)
            accrual.state = 'cancel'
        return True

    def action_reset_draft(self):
        if any(a.state != 'cancel' for a in self):
            raise UserError(_("Only cancelled accruals can be reset."))
        self.write({'state': 'draft', 'provision_move_id': False})
        return True
