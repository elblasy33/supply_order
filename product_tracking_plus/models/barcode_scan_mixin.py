from odoo import api, Command, fields, models, _


class BarcodeScanMixin(models.AbstractModel):
    """A scan field for document forms: a keyboard-wedge scanner types the code and Enter, the
    document adds the product (or raises its quantity) and the field is cleared, still focused."""
    _name = 'barcode.scan.mixin'
    _description = 'Barcode scanning field for document forms'

    _scan_lines_field = None
    _scan_product_field = 'product_id'
    _scan_qty_field = None

    scan_input = fields.Char(string='Scan', store=False, copy=False,
                             help="Scan a product barcode (or a lot number on supply orders), then Enter.")

    # lookups -------------------------------------------------------------
    def _scan_find_product(self, value):
        Product = self.env['product.product']
        return Product.search([('barcode', '=', value)], limit=1) or Product.search([('default_code', '=', value)], limit=1)

    def _scan_find_lot(self, value):
        return self.env['stock.lot'].search([('name', '=', value)])

    # onchange entry point --------------------------------------------------
    @api.onchange('scan_input')
    def _onchange_scan_input(self):
        value = (self.scan_input or '').strip()
        self.scan_input = False
        if not value:
            return
        return self._scan_process(value)

    def _scan_warning(self, message):
        return {'warning': {'title': _("Scan"), 'message': message}}

    def _scan_process(self, value):
        product = self._scan_find_product(value)
        if product:
            return self._scan_add_product(product)
        lots = self._scan_find_lot(value)
        if lots:
            return self._scan_add_lot(lots)
        return self._scan_unknown(value)

    def _scan_unknown(self, value):
        return self._scan_warning(_("Nothing found for “%s”: unknown barcode or lot number.", value))

    def _scan_add_lot(self, lots):
        return self._scan_warning(_("Lot numbers can be scanned on supply orders only."))

    # line handling ---------------------------------------------------------
    def _scan_increment(self):
        return (self.company_id or self.env.company).supply_barcode_increment

    def _scan_line_matches(self, line, product, lot):
        return line[self._scan_product_field] == product

    def _scan_line_vals(self, product, lot):
        return {self._scan_product_field: product.id, self._scan_qty_field: 1.0}

    def _scan_add_product(self, product, lot=None):
        lines = self[self._scan_lines_field]
        line = lines.filtered(lambda l: self._scan_line_matches(l, product, lot))[:1]
        if line and self._scan_increment():
            line[self._scan_qty_field] += 1
        else:
            self[self._scan_lines_field] = [Command.create(self._scan_line_vals(product, lot))]


class SaleOrder(models.Model):
    _inherit = ['sale.order', 'barcode.scan.mixin']
    _name = 'sale.order'
    _scan_lines_field = 'order_line'
    _scan_qty_field = 'product_uom_qty'


class PurchaseOrder(models.Model):
    _inherit = ['purchase.order', 'barcode.scan.mixin']
    _name = 'purchase.order'
    _scan_lines_field = 'order_line'
    _scan_qty_field = 'product_qty'
