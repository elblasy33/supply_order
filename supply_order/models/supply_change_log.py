from odoo import fields, models, _
from odoo.exceptions import UserError


class SupplyOrderChangeLog(models.Model):
    """Append-only audit trail of changes made to a supply order."""
    _name = 'supply.order.change.log'
    _description = 'Supply order change log'
    _order = 'id desc'

    order_id = fields.Many2one('supply.order', required=True, ondelete='cascade', index=True)
    line_id = fields.Many2one('supply.order.line', ondelete='set null')
    line_desc = fields.Char(string='Item')
    change_type = fields.Selection(
        [('add', 'Added'), ('remove', 'Removed'), ('substitute', 'Substituted'),
         ('qty', 'Quantity changed'), ('price', 'Price changed')],
        required=True)
    field_name = fields.Char()
    old_value = fields.Char()
    new_value = fields.Char()
    reason = fields.Char()
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user, readonly=True)
    ext_user_id = fields.Many2one('external.user', string='App User', readonly=True)
    create_date = fields.Datetime(readonly=True)

    def write(self, vals):
        raise UserError(_("The change log cannot be modified."))

    def unlink(self):
        if self.env.context.get('module_uninstall'):
            return super().unlink()
        raise UserError(_("The change log cannot be deleted."))
