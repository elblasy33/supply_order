from odoo import api, Command, fields, models, _
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_is_zero


class SupplyOrder(models.Model):
    _name = 'supply.order'
    _description = 'Supply Order'
    _inherit = ['mail.thread', 'mail.activity.mixin', 'external.user.stamp']
    _order = 'id desc'
    _check_company_auto = True

    name = fields.Char(string='Reference', default=lambda self: _('New'), copy=False, readonly=True, index=True)
    supply_ref = fields.Char(string='Supply Order No.', index=True, tracking=True,
                             help="Free text number of the supply order as known by the customer/vendor, e.g. 11100.")
    order_type = fields.Selection([('sale', 'Supply to customer'), ('purchase', 'Purchase from vendor')],
                                  required=True, default='sale', tracking=True)
    state = fields.Selection(
        [('draft', 'Draft'), ('confirmed', 'Confirmed'), ('closed', 'Closed'), ('cancel', 'Cancelled')],
        default='draft', required=True, copy=False, tracking=True, index=True)
    fulfillment_state = fields.Selection(
        [('none', 'Not started'), ('partial', 'Partially done'), ('done', 'Fully done')],
        compute='_compute_fulfillment', store=True)
    invoice_state = fields.Selection(
        [('nothing', 'Nothing to invoice'), ('to_invoice', 'To invoice'), ('invoiced', 'Fully invoiced')],
        compute='_compute_fulfillment', store=True)
    partner_id = fields.Many2one('res.partner', string='Partner', required=True, tracking=True, check_company=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id, required=True)
    date_order = fields.Datetime(default=fields.Datetime.now, required=True)
    note = fields.Text()
    line_ids = fields.One2many('supply.order.line', 'order_id', string='Lines', copy=True)
    change_log_ids = fields.One2many('supply.order.change.log', 'order_id', string='Change Log')
    linked_supply_id = fields.Many2one('supply.order', string='Linked Supply Order', copy=False,
                                       help="Counterpart order, e.g. the vendor purchase serving a customer supply.")

    sale_order_ids = fields.One2many('sale.order', 'supply_order_id', string='Sales Orders')
    purchase_order_ids = fields.One2many('purchase.order', 'supply_order_id', string='Purchase Orders')
    picking_ids = fields.One2many('stock.picking', 'supply_order_id', string='Transfers')
    invoice_ids = fields.One2many('account.move', 'supply_order_id', string='Invoices')
    sale_count = fields.Integer(compute='_compute_counts')
    purchase_count = fields.Integer(compute='_compute_counts')
    picking_count = fields.Integer(compute='_compute_counts')
    delivery_count = fields.Integer(compute='_compute_counts')
    receipt_count = fields.Integer(compute='_compute_counts')
    invoice_count = fields.Integer(compute='_compute_counts')
    amount_untaxed = fields.Monetary(compute='_compute_amounts', store=True, currency_field='currency_id')
    amount_tax = fields.Monetary(compute='_compute_amounts', store=True, currency_field='currency_id')
    amount_total = fields.Monetary(compute='_compute_amounts', store=True, currency_field='currency_id')

    @api.depends('sale_order_ids', 'purchase_order_ids', 'picking_ids', 'invoice_ids')
    def _compute_counts(self):
        for order in self:
            order.sale_count = len(order.sale_order_ids)
            order.purchase_count = len(order.purchase_order_ids)
            pickings = order.picking_ids
            order.picking_count = len(pickings)
            order.delivery_count = len(pickings.filtered(lambda p: p.picking_type_code == 'outgoing'))
            order.receipt_count = len(pickings.filtered(lambda p: p.picking_type_code == 'incoming'))
            order.invoice_count = len(order.invoice_ids)

    @api.depends('line_ids.price_subtotal', 'line_ids.price_total')
    def _compute_amounts(self):
        for order in self:
            order.amount_untaxed = sum(order.line_ids.mapped('price_subtotal'))
            order.amount_total = sum(order.line_ids.mapped('price_total'))
            order.amount_tax = order.amount_total - order.amount_untaxed

    @api.depends('state', 'line_ids.qty_requested', 'line_ids.qty_done', 'line_ids.qty_invoiced')
    def _compute_fulfillment(self):
        for order in self:
            lines = order.line_ids
            requested = sum(lines.mapped('qty_requested'))
            done = sum(lines.mapped('qty_done'))
            invoiced = sum(lines.mapped('qty_invoiced'))
            if float_is_zero(done, precision_digits=4):
                order.fulfillment_state = 'none'
            elif float_compare(done, requested, precision_digits=4) >= 0:
                order.fulfillment_state = 'done'
            else:
                order.fulfillment_state = 'partial'
            if float_compare(done, invoiced, precision_digits=4) > 0:
                order.invoice_state = 'to_invoice'
            elif done and float_compare(invoiced, requested, precision_digits=4) >= 0:
                order.invoice_state = 'invoiced'
            else:
                order.invoice_state = 'nothing'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('supply.order') or _('New')
        return super().create(vals_list)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _post_app(self, body):
        """Chatter message, mentioning the app user when acting through the service account."""
        ext = self._get_ext_user()
        if ext:
            body = _("%(body)s — by %(user)s via the app", body=body, user=ext.name)
        self.message_post(body=body)

    def _log(self, line, change_type, field_name='', old='', new='', line_desc=''):
        ext = self._get_ext_user()
        self.env['supply.order.change.log'].sudo().create({
            'order_id': self.id,
            'line_id': line.id if line else False,
            'line_desc': line_desc or (line.product_id.display_name if line else ''),
            'change_type': change_type,
            'field_name': field_name,
            'old_value': old,
            'new_value': new,
            'reason': self.env.context.get('change_reason', ''),
            'user_id': self.env.uid,
            'ext_user_id': ext.id,
        })

    def _get_warehouse(self):
        self.ensure_one()
        wh = self.env['stock.warehouse'].search([('company_id', '=', self.company_id.id)], limit=1)
        if not wh:
            raise UserError(_("No warehouse found for company %s.", self.company_id.name))
        return wh

    def _get_delivery_rule(self, warehouse):
        """Pull rule of the delivery route: moves must carry it for Odoo to count them as the
        procurement of a sale line (see sale_stock ``_get_outgoing_incoming_moves``)."""
        rule = warehouse.delivery_route_id.rule_ids.filtered(
            lambda r: r.picking_type_id == warehouse.out_type_id and r.action in ('pull', 'pull_push'))[:1]
        return rule

    # ------------------------------------------------------------------
    # workflow
    # ------------------------------------------------------------------
    def action_confirm(self):
        for order in self:
            if order.state != 'draft':
                raise UserError(_("Only draft orders can be confirmed."))
            if not order.line_ids:
                raise UserError(_("Add at least one line before confirming."))
            order.state = 'confirmed'
            for line in order.line_ids:
                line.with_context(supply_internal=True, skip_auto_plan=True).qty_initial = line.qty_requested
            order._post_app(_("Supply order confirmed."))
        return True

    def action_cancel(self):
        for order in self:
            if order.invoice_ids.filtered(lambda m: m.state == 'posted'):
                raise UserError(_("Cannot cancel an order with posted invoices."))
            if order.line_ids.filtered(lambda l: l.qty_done):
                raise UserError(_("Cannot cancel an order with done stock moves. Close it instead."))
            order.line_ids.move_ids.filtered(lambda m: m.state not in ('done', 'cancel'))._action_cancel()
            order.state = 'cancel'
            order._post_app(_("Supply order cancelled."))
        return True

    def action_close(self):
        self.write({'state': 'closed'})
        for order in self:
            order._post_app(_("Supply order closed."))
        return True

    def action_reset_draft(self):
        if any(o.state != 'cancel' for o in self):
            raise UserError(_("Only cancelled orders can be reset to draft."))
        self.write({'state': 'draft'})
        return True

    # ------------------------------------------------------------------
    # stock operations
    # ------------------------------------------------------------------
    def action_prepare_transfer(self):
        """Create the delivery (sale) or receipt (purchase) for what is still unplanned.

        Callable at any time, before or after the sale/purchase order exists.
        """
        self.ensure_one()
        if self.state != 'confirmed':
            raise UserError(_("Confirm the supply order first."))
        wh = self._get_warehouse()
        is_sale = self.order_type == 'sale'
        ptype = wh.out_type_id if is_sale else wh.in_type_id
        src = ptype.default_location_src_id if is_sale else self.partner_id.property_stock_supplier
        dest = self.partner_id.property_stock_customer if is_sale else ptype.default_location_dest_id
        rule = self._get_delivery_rule(wh) if is_sale else self.env['stock.rule']
        move_vals = []
        for line in self.line_ids:
            qty = line.qty_unplanned
            if float_compare(qty, 0, precision_digits=4) <= 0:
                continue
            vals = {
                'product_id': line.product_id.id,
                'product_uom_qty': qty,
                'uom_id': line.uom_id.id,
                'location_id': src.id,
                'location_dest_id': dest.id,
                'supply_line_id': line.id,
            }
            if is_sale and line.sale_line_id:
                vals.update(sale_line_id=line.sale_line_id.id, rule_id=rule.id, warehouse_id=wh.id)
            if not is_sale and line.purchase_line_id:
                vals['purchase_line_id'] = line.purchase_line_id.id
            move_vals.append(Command.create(vals))
        if not move_vals:
            raise UserError(_("Nothing left to plan: all requested quantities already have stock moves."))
        picking = self.env['stock.picking'].create({
            'picking_type_id': ptype.id,
            'partner_id': self.partner_id.id,
            'location_id': src.id,
            'location_dest_id': dest.id,
            'origin': self.name,
            'supply_order_id': self.id,
            'move_ids': move_vals,
        })
        picking.action_confirm()
        picking.action_assign()
        self._post_app(_("Transfer %s prepared.", picking.name))
        return picking

    def _auto_plan_transfer(self):
        """Plan a new transfer for quantities that have none yet (added items / increased quantities).

        Only when the order already has a live transfer: before that, planning stays a manual choice.
        """
        for order in self:
            if order.state != 'confirmed' or self.env.context.get('skip_auto_plan'):
                continue
            if not order.picking_ids.filtered(lambda p: p.state != 'cancel'):
                continue
            if not order.line_ids.filtered(lambda l: float_compare(l.qty_unplanned, 0, precision_digits=4) > 0):
                continue
            picking = order.action_prepare_transfer()
            order._post_app(_("Items were added: new transfer %s created automatically.", picking.name))

    def _add_line_from_move(self, move):
        """Attach a stock move created outside the supply order flow (e.g. an item typed directly in
        the transfer) to a supply line: reuse the line of the same product, or add a new one."""
        self.ensure_one()
        line = self.line_ids.filtered(lambda l: l.product_id == move.product_id)[:1]
        ctx = dict(supply_internal=True, skip_auto_plan=True,
                   change_reason=_("Added in transfer %s", move.picking_id.name or ''))
        if not line:
            line = self.env['supply.order.line'].with_context(**ctx).create({
                'order_id': self.id,
                'product_id': move.product_id.id,
                'qty_requested': move.product_uom_qty,
                'uom_id': move.uom_id.id,
            })
        move.with_context(supply_internal=True).supply_line_id = line
        return line

    def action_print_quotation(self):
        self.ensure_one()
        return self.env.ref('supply_order.action_report_supply_quotation').report_action(self)

    def _link_moves_to_document_lines(self, field):
        """Point the supply moves to the sale/purchase line created from the same supply line."""
        for order in self:
            wh = order._get_warehouse()
            rule = order._get_delivery_rule(wh)
            for line in order.line_ids:
                doc_line = line[field]
                moves = line.move_ids.filtered(
                    lambda m: m.state != 'cancel' and m.product_id == doc_line.product_id)
                if not moves or not doc_line:
                    continue
                vals = {field: doc_line.id}
                if field == 'sale_line_id':
                    vals.update(rule_id=rule.id, warehouse_id=wh.id)
                moves.write(vals)

    def action_create_sale_order(self):
        self.ensure_one()
        if self.order_type != 'sale':
            raise UserError(_("Only customer supply orders can create a sales order."))
        so = self.env['sale.order'].create({
            'partner_id': self.partner_id.id,
            'company_id': self.company_id.id,
            'supply_order_id': self.id,
            'origin': self.name,
            'order_line': [Command.create({
                'product_id': l.product_id.id,
                'product_uom_qty': l.qty_requested,
                'product_uom_id': l.uom_id.id,
                'price_unit': l.price_unit,
                'discount': l.discount,
                'tax_ids': [Command.set(l.tax_ids.ids)],
                'supply_line_id': l.id,
            }) for l in self.line_ids],
        })
        for line in self.line_ids:
            line.sale_line_id = so.order_line.filtered(lambda s: s.supply_line_id == line)[:1]
        self._link_moves_to_document_lines('sale_line_id')
        self._post_app(_("Sales order %s created.", so.name))
        return so

    def action_create_purchase_order(self):
        self.ensure_one()
        if self.order_type != 'purchase':
            raise UserError(_("Only purchase supply orders can create a purchase order."))
        po = self.env['purchase.order'].create({
            'partner_id': self.partner_id.id,
            'company_id': self.company_id.id,
            'supply_order_id': self.id,
            'origin': self.name,
            'order_line': [Command.create({
                'product_id': l.product_id.id,
                'product_qty': l.qty_requested,
                'uom_id': l.uom_id.id,
                'price_unit': l.price_unit,
                'discount': l.discount,
                'tax_ids': [Command.set(l.tax_ids.ids)],
                'supply_line_id': l.id,
            }) for l in self.line_ids],
        })
        for line in self.line_ids:
            line.purchase_line_id = po.order_line.filtered(lambda p: p.supply_line_id == line)[:1]
        self._link_moves_to_document_lines('purchase_line_id')
        self._post_app(_("Purchase order %s created.", po.name))
        return po

    # ------------------------------------------------------------------
    # invoicing (always from the real quantities)
    # ------------------------------------------------------------------
    def action_create_invoice(self):
        self.ensure_one()
        is_sale = self.order_type == 'sale'
        lines_vals = []
        for line, product, qty in self.line_ids._get_invoiceable():
            vals = {
                'product_id': product.id,
                'quantity': qty,
                'price_unit': line.price_unit,
                'discount': line.discount,
                'tax_ids': [Command.set(line.tax_ids.ids)],
                'product_uom_id': line.uom_id.id,
                'supply_line_id': line.id,
                'name': line.line_note or product.display_name,
            }
            doc_line = line.sale_line_id if is_sale else line.purchase_line_id
            if doc_line and doc_line.product_id == product:
                if is_sale:
                    vals['sale_line_ids'] = [Command.set(doc_line.ids)]
                else:
                    vals['purchase_line_id'] = doc_line.id
            lines_vals.append(Command.create(vals))
        if not lines_vals:
            raise UserError(_("Nothing to invoice: no delivered/received quantity is left uninvoiced."))
        move = self.env['account.move'].create({
            'move_type': 'out_invoice' if is_sale else 'in_invoice',
            'partner_id': self.partner_id.id,
            'company_id': self.company_id.id,
            'currency_id': self.currency_id.id,
            'invoice_origin': self.name,
            'supply_order_id': self.id,
            'invoice_line_ids': lines_vals,
        })
        self._post_app(_("Invoice %s created from actual quantities.", move.name or _('draft')))
        return move

    # ------------------------------------------------------------------
    # smart buttons
    # ------------------------------------------------------------------
    def _action_open(self, model, domain_field, name, view_mode='list,form'):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window', 'name': name, 'res_model': model,
            'view_mode': view_mode, 'domain': [(domain_field, '=', self.id)],
            'context': {'default_supply_order_id': self.id, 'create': False},
        }

    def action_view_sales(self):
        return self._action_open('sale.order', 'supply_order_id', _('Sales Orders'))

    def action_view_purchases(self):
        return self._action_open('purchase.order', 'supply_order_id', _('Purchase Orders'))

    def action_view_pickings(self):
        return self._action_open('stock.picking', 'supply_order_id', _('Transfers'))

    def action_view_deliveries(self):
        action = self._action_open('stock.picking', 'supply_order_id', _('Delivery'))
        action['domain'] += [('picking_type_code', '=', 'outgoing')]
        return action

    def action_view_receipts(self):
        action = self._action_open('stock.picking', 'supply_order_id', _('Receipts'))
        action['domain'] += [('picking_type_code', '=', 'incoming')]
        return action

    def action_view_invoices(self):
        return self._action_open('account.move', 'supply_order_id', _('Invoices'))
