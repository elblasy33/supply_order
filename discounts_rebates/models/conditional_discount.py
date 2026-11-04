from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class ConditionalDiscountRule(models.Model):
    """Automatic discount on the line when the unit price exceeds a threshold: "price above X → discount Y"."""
    _name = 'conditional.discount.rule'
    _description = 'Conditional price discount'
    _order = 'sequence, id'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    sequence = fields.Integer(default=10, help="Lowest number wins when several rules match.")
    company_id = fields.Many2one('res.company', default=lambda self: self.env.company, index=True)
    applies_to = fields.Selection([('sale', 'Sales'), ('purchase', 'Purchases'), ('both', 'Both')],
                                  required=True, default='sale')
    product_ids = fields.Many2many('product.product', string='Products')
    category_ids = fields.Many2many('product.category', string='Product Categories')
    min_price = fields.Float(string='Price above', required=True, digits='Product Price',
                             help="The rule applies when the unit price is strictly above this amount.")
    discount_type = fields.Selection([('percent', 'Percentage'), ('amount', 'Amount per unit')],
                                     required=True, default='percent')
    value = fields.Float(string='Discount', required=True, digits='Product Price')
    date_from = fields.Date(string='Start')
    date_to = fields.Date(string='End')

    @api.constrains('value', 'discount_type', 'date_from', 'date_to')
    def _check_values(self):
        for rule in self:
            if rule.value <= 0 or (rule.discount_type == 'percent' and rule.value > 100):
                raise ValidationError(_("The discount must be positive (and at most 100%)."))
            if rule.date_from and rule.date_to and rule.date_from > rule.date_to:
                raise ValidationError(_("The end date must be after the start date."))

    def _matches(self, product, price_unit, date, kind, company):
        self.ensure_one()
        if self.company_id and self.company_id != company:
            return False
        if self.applies_to not in ('both', kind) or not price_unit > self.min_price:
            return False
        if (self.date_from and date < self.date_from) or (self.date_to and date > self.date_to):
            return False
        if not self.product_ids and not self.category_ids:
            return True
        return product in self.product_ids or product.categ_id in self.category_ids

    def _percent_for(self, price_unit):
        self.ensure_one()
        if self.discount_type == 'percent':
            return self.value
        return min(100.0, self.value / price_unit * 100.0) if price_unit else 0.0

    @api.model
    def _conditional_discount(self, product, price_unit, date, kind, company):
        """Percentage granted by the first matching rule (0.0 when none)."""
        if not product or not price_unit:
            return 0.0
        date = fields.Date.to_date(date) or fields.Date.context_today(self)
        rules = self.sudo().search([('active', '=', True), '|', ('company_id', '=', False),
                                    ('company_id', '=', company.id)])
        for rule in rules:
            if rule._matches(product, price_unit, date, kind, company):
                return rule._percent_for(price_unit)
        return 0.0


class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    @api.depends('product_id', 'product_uom_id', 'product_uom_qty', 'price_unit')
    def _compute_discount(self):
        super()._compute_discount()
        rules = self.env['conditional.discount.rule']
        for line in self:
            # a discount already given by the pricelist is never stacked
            if line.display_type or not line.product_id or line.discount:
                continue
            line.discount = rules._conditional_discount(
                line.product_id, line.price_unit, line.order_id.date_order, 'sale', line.company_id)


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    def _compute_price_unit_and_date_planned_and_name(self):
        super()._compute_price_unit_and_date_planned_and_name()
        rules = self.env['conditional.discount.rule']
        for line in self:
            if line.display_type or not line.product_id or line.discount:
                continue  # a vendor price-list discount is never stacked
            line.discount = rules._conditional_discount(
                line.product_id, line.price_unit, line.order_id.date_order, 'purchase', line.company_id)


class SupplyOrderLine(models.Model):
    _inherit = 'supply.order.line'

    discount = fields.Float(compute='_compute_discount', store=True, readonly=False)

    @api.depends('product_id', 'price_unit', 'order_id.order_type')
    def _compute_discount(self):
        rules = self.env['conditional.discount.rule']
        for line in self:
            if not line.product_id:
                continue
            line.discount = rules._conditional_discount(
                line.product_id, line.price_unit, line.order_id.date_order,
                'purchase' if line.order_id.order_type == 'purchase' else 'sale', line.company_id)
