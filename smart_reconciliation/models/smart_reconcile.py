from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_is_zero


class SmartReconcileLog(models.Model):
    """Append-only record of every pairing made by the wizard."""
    _name = 'smart.reconcile.log'
    _description = 'Smart reconciliation log'
    _order = 'id desc'

    batch = fields.Char(required=True, index=True)
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user, readonly=True)
    create_date = fields.Datetime(readonly=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id')
    partner_id = fields.Many2one('res.partner', required=True, index=True)
    kind = fields.Selection([('customer', 'Customer'), ('vendor', 'Vendor')], required=True)
    invoice_line_id = fields.Many2one('account.move.line', string='Invoice item', ondelete='restrict')
    invoice_id = fields.Many2one('account.move', string='Invoice', ondelete='restrict')
    payment_line_id = fields.Many2one('account.move.line', string='Payment item', ondelete='restrict')
    payment_move_id = fields.Many2one('account.move', string='Payment / credit note', ondelete='restrict')
    amount = fields.Monetary(string='Reconciled', currency_field='currency_id',
                             help="Amount matched, in company currency.")
    invoice_residual_after = fields.Monetary(string='Invoice left', currency_field='currency_id')

    def write(self, vals):
        raise UserError(_("The reconciliation log cannot be modified."))

    def unlink(self):
        if self.env.context.get('module_uninstall'):
            return super().unlink()
        raise UserError(_("The reconciliation log cannot be deleted."))


class SmartReconcileWizard(models.TransientModel):
    _name = 'smart.reconcile.wizard'
    _description = 'Reconcile selected invoices with payments'

    partner_id = fields.Many2one('res.partner', required=True)
    kind = fields.Selection([('customer', 'Customer'), ('vendor', 'Vendor')], required=True, default='customer')
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id')
    date_from = fields.Date(required=True, default=lambda self: fields.Date.context_today(self).replace(day=1))
    date_to = fields.Date(required=True, default=fields.Date.context_today)
    allocation_order = fields.Selection(
        [('due', 'Oldest due date first'), ('invoice', 'Oldest invoice first')], default='due', required=True)
    state = fields.Selection([('draft', 'Choose'), ('loaded', 'Select'), ('done', 'Done')], default='draft')
    line_ids = fields.One2many('smart.reconcile.wizard.line', 'wizard_id')
    # the two lists of the form (the domain filters what the screen shows; the code always uses ``line_ids``)
    invoice_line_ids = fields.One2many('smart.reconcile.wizard.line', 'wizard_id', domain=[('role', '=', 'invoice')])
    payment_line_ids = fields.One2many('smart.reconcile.wizard.line', 'wizard_id', domain=[('role', '=', 'payment')])
    log_ids = fields.Many2many('smart.reconcile.log', string='Reconciled pairs')
    available_total = fields.Monetary(compute='_compute_totals', currency_field='currency_id')
    selected_total = fields.Monetary(compute='_compute_totals', currency_field='currency_id')
    remaining_total = fields.Monetary(compute='_compute_totals', currency_field='currency_id',
                                      help="Still due on the selected invoices after the reconciliation.")

    @api.depends('line_ids.selected', 'invoice_line_ids.selected', 'payment_line_ids.selected',
                 'line_ids.residual', 'invoice_line_ids.residual', 'payment_line_ids.residual', 'state')
    def _compute_totals(self):
        for wiz in self:
            # the screen edits the two filtered lists, the code reads ``line_ids``: look at all of them
            lines = wiz.line_ids | wiz.invoice_line_ids | wiz.payment_line_ids
            payments = lines.filtered(lambda l: l.role == 'payment' and l.selected)
            invoices = lines.filtered(lambda l: l.role == 'invoice' and l.selected)
            wiz.available_total = sum(payments.mapped('residual'))
            wiz.selected_total = sum(invoices.mapped('residual'))
            wiz.remaining_total = max(wiz.selected_total - wiz.available_total, 0.0) if wiz.state != 'done' \
                else sum(invoices.mapped('residual'))

    # --- loading ----------------------------------------------------------------------------
    def _sign(self):
        """+1: invoices are debits (customers); -1: invoices are credits (vendors)."""
        return 1 if self.kind == 'customer' else -1

    def _open_items_domain(self):
        self.ensure_one()
        account_type = 'asset_receivable' if self.kind == 'customer' else 'liability_payable'
        return [('company_id', '=', self.company_id.id), ('partner_id', '=', self.partner_id.id),
                ('account_id.account_type', '=', account_type), ('parent_state', '=', 'posted'),
                ('reconciled', '=', False), ('amount_residual', '!=', 0),
                ('date', '>=', self.date_from), ('date', '<=', self.date_to)]

    def action_load(self):
        self.ensure_one()
        if self.date_from > self.date_to:
            raise UserError(_("The period must start before it ends."))
        self.line_ids.unlink()
        Line = self.env['smart.reconcile.wizard.line']
        for item in self.env['account.move.line'].search(self._open_items_domain(), order='date_maturity, date, id'):
            is_invoice = self._sign() * item.amount_residual > 0
            Line.create({'wizard_id': self.id, 'role': 'invoice' if is_invoice else 'payment',
                         'move_line_id': item.id, 'selected': not is_invoice})
        self.state = 'loaded'
        return self._reopen()

    def _reopen(self):
        return {'type': 'ir.actions.act_window', 'res_model': self._name, 'res_id': self.id,
                'view_mode': 'form', 'target': 'new'}

    # --- reconciling --------------------------------------------------------------------------
    def _residual(self, item):
        """Open amount of an item in company currency, positive."""
        item.invalidate_recordset(['amount_residual'])
        return abs(item.amount_residual)

    def action_reconcile(self):
        self.ensure_one()
        invoices = self.line_ids.filtered(lambda l: l.role == 'invoice' and l.selected).move_line_id
        payments = self.line_ids.filtered(lambda l: l.role == 'payment' and l.selected).move_line_id
        if not invoices:
            raise UserError(_("Tick at least one invoice to reconcile."))
        if not payments:
            raise UserError(_("There is no payment available: tick at least one payment or credit note."))
        key = (lambda l: (l.date_maturity or l.date, l.id)) if self.allocation_order == 'due' \
            else (lambda l: (l.move_id.invoice_date or l.date, l.id))
        invoices = invoices.sorted(key)
        payments = payments.sorted(lambda l: (l.date, l.id))
        batch = 'REC-%s-%s' % (fields.Datetime.now().strftime('%Y%m%d%H%M%S'), self.id)
        rounding = self.company_id.currency_id.rounding
        logs = self.env['smart.reconcile.log']
        for invoice in invoices:
            for payment in payments:
                before = self._residual(invoice)
                if float_is_zero(before, precision_rounding=rounding):
                    break
                available = self._residual(payment)
                if float_is_zero(available, precision_rounding=rounding):
                    continue
                (invoice | payment).reconcile()
                after = self._residual(invoice)
                matched = before - after
                if float_compare(matched, 0.0, precision_rounding=rounding) <= 0:
                    continue
                logs |= self.env['smart.reconcile.log'].create({
                    'batch': batch, 'company_id': self.company_id.id, 'partner_id': self.partner_id.id,
                    'kind': self.kind, 'invoice_line_id': invoice.id, 'invoice_id': invoice.move_id.id,
                    'payment_line_id': payment.id, 'payment_move_id': payment.move_id.id,
                    'amount': matched, 'invoice_residual_after': after})
        if not logs:
            raise UserError(_("Nothing could be reconciled with the selection."))
        self.write({'state': 'done', 'log_ids': [(6, 0, logs.ids)]})
        self.line_ids.invalidate_recordset(['residual'])
        return self._reopen()


class SmartReconcileWizardLine(models.TransientModel):
    _name = 'smart.reconcile.wizard.line'
    _description = 'Open item shown in the reconciliation wizard'
    _order = 'role, date_maturity, date, id'

    wizard_id = fields.Many2one('smart.reconcile.wizard', required=True, ondelete='cascade')
    role = fields.Selection([('invoice', 'Invoice'), ('payment', 'Payment')], required=True)
    move_line_id = fields.Many2one('account.move.line', required=True)
    move_id = fields.Many2one(related='move_line_id.move_id', string='Document')
    move_type = fields.Selection(related='move_line_id.move_id.move_type')
    date = fields.Date(related='move_line_id.date')
    date_maturity = fields.Date(related='move_line_id.date_maturity', string='Due')
    currency_id = fields.Many2one(related='wizard_id.currency_id')
    doc_currency_id = fields.Many2one(related='move_line_id.currency_id', string='Document currency')
    residual = fields.Monetary(string='Open amount', currency_field='currency_id',
                               compute='_compute_residual', help="Open amount in company currency.")
    selected = fields.Boolean(string='Select')

    @api.depends('move_line_id.amount_residual')
    def _compute_residual(self):
        for line in self:
            line.residual = abs(line.move_line_id.amount_residual)
