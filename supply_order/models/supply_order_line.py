from collections import defaultdict

from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_is_zero


class SupplyOrderLine(models.Model):
    _name = 'supply.order.line'
    _description = 'Supply Order Line'
    _inherit = ['line.numbering.mixin', 'external.user.stamp']
    _line_parent_field = 'order_id'
    _order = 'order_id, line_no, id'

    order_id = fields.Many2one('supply.order', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='order_id.company_id', store=True)
    currency_id = fields.Many2one(related='order_id.currency_id')
    order_type = fields.Selection(related='order_id.order_type')
    order_state = fields.Selection(related='order_id.state')
    requested_product_id = fields.Many2one('product.product', string='Requested Item', readonly=True, copy=False,
                                           help="Original item asked for. Kept when the actual item is substituted.")
    product_id = fields.Many2one('product.product', string='Actual Item', required=True,
                                 domain=[('type', '=', 'consu')])
    substitution_reason = fields.Char(readonly=True, copy=False)
    qty_initial = fields.Float(string='Original Qty', digits='Product Unit', readonly=True, copy=False,
                               help="Quantity asked for when the order was confirmed. 0 for items added afterwards.")
    qty_requested = fields.Float(string='Current Qty', digits='Product Unit', default=1.0)
    qty_change = fields.Float(string='Change', digits='Product Unit', compute='_compute_qty_change',
                              help="Current quantity minus original quantity.")
    line_origin = fields.Selection([('requested', 'Requested'), ('added', 'Added')], string='Origin',
                                   default='requested', readonly=True, copy=False)
    uom_id = fields.Many2one('uom.uom', string='Unit', compute='_compute_uom', store=True, readonly=False,
                             precompute=True)
    price_unit = fields.Float(digits='Product Price', compute='_compute_price_unit', store=True,
                              readonly=False, precompute=True)
    discount = fields.Float(string='Disc.%', digits='Discount')
    tax_ids = fields.Many2many('account.tax', string='Taxes', check_company=True,
                               compute='_compute_tax_ids', store=True, readonly=False)
    price_subtotal = fields.Monetary(compute='_compute_price_subtotal', store=True)
    price_total = fields.Monetary(compute='_compute_price_subtotal', store=True)
    invoice_group_name = fields.Char(string='Invoice Group')

    move_ids = fields.One2many('stock.move', 'supply_line_id', string='Stock Moves')
    invoice_line_ids = fields.One2many('account.move.line', 'supply_line_id', string='Invoice Lines')
    sale_line_id = fields.Many2one('sale.order.line', copy=False, index='btree_not_null', ondelete='set null')
    purchase_line_id = fields.Many2one('purchase.order.line', copy=False, index='btree_not_null', ondelete='set null')
    qty_unplanned = fields.Float(compute='_compute_qty_planned', digits='Product Unit')
    has_done_moves = fields.Boolean(compute='_compute_has_done_moves')
    qty_done = fields.Float(string='Done', compute='_compute_qty_done', store=True, digits='Product Unit',
                            help="Quantity really delivered (sale) or received (purchase), net of returns.")
    qty_invoiced = fields.Float(string='Invoiced', compute='_compute_qty_invoiced', store=True,
                                digits='Product Unit')

    # ------------------------------------------------------------------
    # computes
    # ------------------------------------------------------------------
    @api.depends('product_id')
    def _compute_uom(self):
        for line in self:
            if line.product_id and (not line.uom_id or not line.uom_id._has_common_reference(line.product_id.uom_id)):
                line.uom_id = line.product_id.uom_id

    @api.depends('product_id', 'order_id.order_type')
    def _compute_price_unit(self):
        for line in self:
            if not line.product_id or line.price_unit:
                continue
            line.price_unit = line.product_id.lst_price if line.order_type != 'purchase' else line.product_id.standard_price

    @api.depends('product_id', 'order_id.order_type', 'company_id')
    def _compute_tax_ids(self):
        for line in self:
            taxes = line.product_id.taxes_id if line.order_type != 'purchase' else line.product_id.supplier_taxes_id
            line.tax_ids = taxes.filtered(lambda t: t.company_id == line.company_id)

    @api.depends('qty_requested', 'price_unit', 'discount', 'tax_ids')
    def _compute_price_subtotal(self):
        for line in self:
            price = line.price_unit * (1 - (line.discount or 0.0) / 100.0)
            taxes = line.tax_ids.compute_all(price, line.currency_id, line.qty_requested, product=line.product_id)
            line.price_subtotal = taxes['total_excluded']
            line.price_total = taxes['total_included']

    @api.depends('qty_requested', 'qty_initial')
    def _compute_qty_change(self):
        for line in self:
            line.qty_change = line.qty_requested - line.qty_initial if line.order_state != 'draft' else 0.0

    @api.depends('move_ids.state', 'move_ids.product_uom_qty', 'move_ids.quantity',
                 'move_ids.location_id', 'move_ids.location_dest_id', 'qty_requested')
    def _compute_qty_planned(self):
        for line in self:
            planned = 0.0
            for move in line.move_ids.filtered(lambda m: m.state != 'cancel'):
                qty = move.quantity if move.state == 'done' else move.product_uom_qty
                planned += line._signed_move_qty(move, qty)
            line.qty_unplanned = line.qty_requested - planned

    @api.depends('move_ids.state')
    def _compute_has_done_moves(self):
        for line in self:
            line.has_done_moves = any(m.state == 'done' for m in line.move_ids)

    def _signed_move_qty(self, move, qty=None):
        """Quantity of a move in line UoM: + towards the partner (sale) / from the vendor (purchase),
        negative for returns. ``qty`` defaults to the done quantity of the move."""
        self.ensure_one()
        qty = move.uom_id._compute_quantity(move.quantity if qty is None else qty, self.uom_id)
        if self.order_type == 'sale':
            if move.location_dest_id.usage == 'customer':
                return qty
            if move.location_id.usage == 'customer':
                return -qty
        else:
            if move.location_id.usage == 'supplier':
                return qty
            if move.location_dest_id.usage == 'supplier':
                return -qty
        return 0.0

    @api.depends('move_ids.state', 'move_ids.quantity', 'move_ids.location_id', 'move_ids.location_dest_id')
    def _compute_qty_done(self):
        for line in self:
            line.qty_done = sum(line._signed_move_qty(m) for m in line.move_ids if m.state == 'done')

    @api.depends('invoice_line_ids.quantity', 'invoice_line_ids.move_id.state', 'invoice_line_ids.move_id.move_type')
    def _compute_qty_invoiced(self):
        for line in self:
            total = 0.0
            for inv in line.invoice_line_ids.filtered(lambda l: l.move_id.state != 'cancel'):
                qty = inv.product_uom_id._compute_quantity(inv.quantity, line.uom_id) if inv.product_uom_id else inv.quantity
                total += -qty if inv.move_id.move_type in ('out_refund', 'in_refund') else qty
            line.qty_invoiced = total

    def _get_invoiceable(self):
        """[(line, product, qty)] still to invoice, split per *actual* product moved.

        A substituted line may have moved two different products; each is invoiced
        at its own real quantity.
        """
        res = []
        for line in self:
            done = defaultdict(float)
            for move in line.move_ids.filtered(lambda m: m.state == 'done'):
                done[move.product_id] += line._signed_move_qty(move)
            invoiced = defaultdict(float)
            for inv in line.invoice_line_ids.filtered(lambda l: l.move_id.state != 'cancel'):
                qty = inv.quantity * (-1 if inv.move_id.move_type in ('out_refund', 'in_refund') else 1)
                invoiced[inv.product_id] += qty
            for product, qty in done.items():
                remaining = qty - invoiced.get(product, 0.0)
                if float_compare(remaining, 0, precision_digits=4) > 0:
                    res.append((line, product, remaining))
        return res

    # ------------------------------------------------------------------
    # change tracking after confirmation
    # ------------------------------------------------------------------
    def _check_can_edit(self, orders):
        if self.env.context.get('supply_internal'):
            return
        for order in orders:
            if order.state in ('closed', 'cancel'):
                raise UserError(_("Order %s is %s and cannot be modified.", order.name, order.state))
            if order.state == 'confirmed' and not self.env.user.has_group('supply_order.group_supply_manager'):
                raise UserError(_("Only a supply manager can modify a confirmed order."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('product_id') and not vals.get('requested_product_id'):
                vals['requested_product_id'] = vals['product_id']
        orders = self.env['supply.order'].browse([v['order_id'] for v in vals_list if v.get('order_id')])
        self._check_can_edit(orders)
        for vals in vals_list:
            if vals.get('order_id') and self.env['supply.order'].browse(vals['order_id']).state != 'draft':
                vals.setdefault('line_origin', 'added')
        lines = super().create(vals_list)
        for line in lines.filtered(lambda l: l.order_id.state != 'draft'):
            line.order_id._log(line, 'add', 'qty_requested', '', str(line.qty_requested))
        lines.order_id._auto_plan_transfer()
        return lines

    def write(self, vals):
        tracked = {'qty_requested': 'qty', 'price_unit': 'price', 'discount': 'price', 'product_id': 'substitute'}
        changes = []
        if any(f in vals for f in tracked):
            self._check_can_edit(self.order_id)
            if 'product_id' in vals and not self.env.context.get('supply_internal'):
                if any(l.order_id.state != 'draft' for l in self):
                    raise UserError(_("Use the Substitute action to change an item after confirmation."))
            for line in self.filtered(lambda l: l.order_id.state != 'draft'):
                for fname, ctype in tracked.items():
                    if fname in vals and fname != 'product_id':
                        old, new = line[fname], vals[fname]
                        if old != new:
                            changes.append((line, ctype, fname, str(old), str(new)))
        res = super().write(vals)
        for line, ctype, fname, old, new in changes:
            line.order_id._log(line, ctype, fname, old, new)
        if 'qty_requested' in vals:
            self.order_id._auto_plan_transfer()
        return res

    def unlink(self):
        self._check_can_edit(self.order_id)
        for line in self.filtered(lambda l: l.order_id.state != 'draft'):
            if line.move_ids.filtered(lambda m: m.state == 'done'):
                raise UserError(_("Cannot delete a line that already has done stock moves."))
            line.order_id._log(line, 'remove', 'qty_requested', str(line.qty_requested), '')
            line.move_ids.filtered(lambda m: m.state not in ('done', 'cancel'))._action_cancel()
        return super().unlink()

    # ------------------------------------------------------------------
    # substitution
    # ------------------------------------------------------------------
    def _return_done_moves(self):
        """Return what was already delivered/received of the current item (path B of the design:
        a done move is never edited, it is reversed by a return)."""
        self.ensure_one()
        returns = self.env['stock.picking']
        for picking in self.move_ids.filtered(lambda m: m.state == 'done' and m.product_id == self.product_id).picking_id:
            mine = picking.move_ids.filtered(
                lambda m: m.supply_line_id == self and m.product_id == self.product_id and m.state == 'done'
                and not m.origin_returned_move_id)
            to_return = {}
            for orig in mine:
                already = sum(orig.returned_move_ids.filtered(lambda r: r.state == 'done').mapped('quantity'))
                left = orig.quantity - already
                if float_compare(left, 0, precision_digits=4) > 0:
                    to_return[orig] = left
            if not to_return:
                continue
            ret = picking._create_return()
            for rmove in ret.move_ids:
                orig = rmove.origin_returned_move_id
                if orig not in to_return:
                    rmove.unlink()
                    continue
                rmove.write({'product_uom_qty': to_return[orig], 'to_refund': True,
                             'supply_line_id': self.id, 'sale_line_id': orig.sale_line_id.id,
                             'purchase_line_id': orig.purchase_line_id.id,
                             'rule_id': orig.rule_id.id, 'warehouse_id': orig.warehouse_id.id})
            ret.action_confirm()
            ret.action_assign()
            for rmove in ret.move_ids:
                rmove.quantity = rmove.product_uom_qty
                rmove.picked = True
            ret.with_context(skip_backorder=True).button_validate()
            returns |= ret
        return returns

    def action_substitute(self, new_product, reason='', return_done=False):
        """Replace the item still to be moved by ``new_product``.

        Path A (default): acts on moves not yet done.
        Path B (``return_done``): what was already moved of the old item is returned first, then the
        full quantity is planned again with the new item. Done moves are never edited.
        """
        self.ensure_one()
        order = self.order_id
        if order.state != 'confirmed':
            raise UserError(_("Only confirmed orders can have items substituted."))
        self._check_can_edit(order)
        if new_product == self.product_id:
            raise UserError(_("The substitute is the same item."))
        if not new_product.uom_id._has_common_reference(self.uom_id):
            raise UserError(_("The substitute must use a compatible unit of measure."))
        if return_done and order.order_type == 'purchase' and self.purchase_line_id:
            raise UserError(_("Substituting an item on a purchase order already created is not supported yet."))
        old_product = self.product_id
        returned = self.env['stock.picking']
        if (not return_done and self.has_done_moves
                and not self.move_ids.filtered(lambda m: m.state not in ('done', 'cancel'))
                and float_compare(self.qty_unplanned, 0, precision_digits=4) <= 0):
            raise UserError(_("Everything was already moved for %s. Tick 'Also return what was already moved' "
                              "to replace it.", old_product.display_name))
        if return_done:
            returned = self._return_done_moves()
            if not returned:
                raise UserError(_("Nothing was delivered/received of %s: nothing to return.", old_product.display_name))
        open_moves = self.move_ids.filtered(lambda m: m.state not in ('done', 'cancel')).with_context(supply_internal=True)
        moved_qty = sum(open_moves.mapped('product_uom_qty'))
        if return_done:
            self.invalidate_recordset(['qty_unplanned'])
            moved_qty += max(self.qty_unplanned, 0.0)
        new_doc_line = False
        if open_moves:
            open_moves._do_unreserve()
        if order.order_type == 'sale' and self.sale_line_id and moved_qty:
            old_sol = self.sale_line_id
            ctx = dict(skip_procurement=True)
            new_doc_line = self.env['sale.order.line'].with_context(**ctx).create({
                'order_id': old_sol.order_id.id,
                'product_id': new_product.id,
                'product_uom_qty': moved_qty,
                'product_uom_id': self.uom_id.id,
                'price_unit': self.price_unit,
                'discount': self.discount,
                'tax_ids': [(6, 0, self.tax_ids.ids)],
                'supply_line_id': self.id,
            })
            if open_moves:
                wh = order._get_warehouse()
                rule = order._get_delivery_rule(wh)
                open_moves.write({'product_id': new_product.id, 'sale_line_id': new_doc_line.id,
                                  'rule_id': rule.id, 'warehouse_id': wh.id})
            if not return_done:
                old_sol.with_context(**ctx).product_uom_qty = old_sol.product_uom_qty - moved_qty
        elif order.order_type == 'purchase' and self.purchase_line_id and moved_qty:
            raise UserError(_("Substituting an item on a purchase order already created is not supported yet."))
        elif open_moves:
            open_moves.write({'product_id': new_product.id})
        if open_moves:
            open_moves._action_assign()
        invoiced_old = sum(inv.quantity * (-1 if inv.move_id.move_type in ('out_refund', 'in_refund') else 1)
                           for inv in self.invoice_line_ids.filtered(
                               lambda l: l.move_id.state != 'cancel' and l.product_id == old_product))
        self.with_context(supply_internal=True).write({
            'product_id': new_product.id,
            'substitution_reason': reason,
            'sale_line_id': new_doc_line.id if new_doc_line else self.sale_line_id.id,
        })
        order.with_context(change_reason=reason)._log(
            self, 'substitute', 'product_id', old_product.display_name, new_product.display_name)
        order._post_app(_("Item substituted: %(old)s → %(new)s.", old=old_product.display_name,
                          new=new_product.display_name))
        if return_done:
            order._post_app(_("Returned via %s.", ", ".join(returned.mapped('name'))))
            if invoiced_old:
                order._post_app(_("%(qty)s of %(item)s were already invoiced: issue a credit note for them.",
                                  qty=invoiced_old, item=old_product.display_name))
            order._auto_plan_transfer()
        return True

    def action_open_substitute_wizard(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window', 'name': _('Substitute Item'),
            'res_model': 'supply.substitute.wizard', 'view_mode': 'form', 'target': 'new',
            'context': {'default_line_id': self.id},
        }

    def _sync_requested_with_moves(self):
        """Lines added from a transfer follow what that transfer plans or delivers."""
        for line in self.filtered(lambda l: l.line_origin == 'added'):
            planned = sum(m.uom_id._compute_quantity(m.quantity if m.state == 'done' else m.product_uom_qty, line.uom_id)
                          for m in line.move_ids if m.state != 'cancel')
            if float_compare(planned, line.qty_requested, precision_digits=4) != 0:
                line.with_context(supply_internal=True, skip_auto_plan=True).qty_requested = planned

    def _bump_to_done(self):
        """Delivered/received more than the current quantity: raise the current quantity and log it."""
        for line in self:
            if line.order_state != 'confirmed':
                continue
            if float_compare(line.qty_done, line.qty_requested, precision_digits=4) > 0:
                line.with_context(supply_internal=True, skip_auto_plan=True,
                                  change_reason=_("More was moved than requested")).qty_requested = line.qty_done
