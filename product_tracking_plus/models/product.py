import re

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

SEQ_RE = re.compile(r'\{seq(?::(\d+))?\}')


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    lot_auto_generate = fields.Boolean(
        string='Auto-generate Lot Numbers',
        help="When receiving this product, lot numbers are generated at validation if none was entered.")
    lot_pattern = fields.Char(
        string='Lot Pattern', default='{code}-{date}-{seq}',
        help="Tokens: {code} product reference, {date} receipt date (YYMMDD), {vendor} vendor reference, "
             "{seq} or {seq:4} running number per product (zero padded).")

    @api.constrains('lot_auto_generate', 'lot_pattern')
    def _check_lot_pattern(self):
        for template in self.filtered('lot_auto_generate'):
            if not template.lot_pattern or not SEQ_RE.search(template.lot_pattern):
                raise ValidationError(_("The lot pattern must contain {seq} so that numbers never repeat."))


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def _lot_name_parts(self, partner, date):
        self.ensure_one()
        vendor = re.sub(r'[^A-Za-z0-9]', '', (partner.ref or partner.name or '')).upper()[:4]
        return {
            'code': re.sub(r'\s+', '', self.default_code or str(self.id)),
            'date': (date or fields.Date.context_today(self)).strftime('%y%m%d'),
            'vendor': vendor or 'NA',
        }

    def _generate_lot_name(self, partner=None, date=None, taken=()):
        """Next unique lot name from the product pattern. ``taken`` holds names handed out but not yet saved."""
        self.ensure_one()
        pattern = self.lot_pattern or '{code}-{date}-{seq}'
        parts = self._lot_name_parts(partner or self.env['res.partner'], date)
        base = pattern
        for key, value in parts.items():
            base = base.replace('{%s}' % key, value)
        m = SEQ_RE.search(base)
        width = int(m.group(1) or 3)
        prefix, suffix = base[:m.start()], base[m.end():]
        existing = self.env['stock.lot'].search([
            ('product_id', '=', self.id), ('name', '=like', '%s%%%s' % (prefix, suffix))]).mapped('name')
        number_re = re.compile('^%s(\\d+)%s$' % (re.escape(prefix), re.escape(suffix)))
        used = [int(n.group(1)) for n in map(number_re.match, list(existing) + list(taken)) if n]
        return '%s%s%s' % (prefix, str(max(used or [0]) + 1).zfill(width), suffix)
