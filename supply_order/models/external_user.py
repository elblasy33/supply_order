from odoo import api, fields, models


class ExternalUser(models.Model):
    _name = 'external.user'
    _description = 'External application user'
    _order = 'name'

    name = fields.Char(required=True)
    login = fields.Char(required=True, index=True)
    role = fields.Selection(
        [('sales', 'Sales Rep'), ('warehouse', 'Warehouse Keeper'),
         ('accountant', 'Accountant'), ('manager', 'Manager')],
        required=True, default='sales')
    external_id = fields.Char(string='External ID', index=True)
    active = fields.Boolean(default=True)

    _login_unique = models.Constraint('unique(login)', 'External login must be unique.')


class ExternalUserStamp(models.AbstractModel):
    """Stamp records with the real (external) user acting through the service account.

    ``ext_user_id`` in the context is honoured only when the current Odoo user is
    the configured service user (``supply_order.service_user_id``); otherwise ignored.
    """
    _name = 'external.user.stamp'
    _description = 'External user stamp'

    created_ext_user_id = fields.Many2one('external.user', string='Created by (App)', readonly=True, copy=False)
    write_ext_user_id = fields.Many2one('external.user', string='Last edited by (App)', readonly=True, copy=False)

    @api.model
    def _get_ext_user(self):
        ext_id = self.env.context.get('ext_user_id')
        if not ext_id:
            return self.env['external.user']
        service = self.env['ir.config_parameter'].sudo().get_int('supply_order.service_user_id')
        if not service or service != self.env.uid:
            return self.env['external.user']
        return self.env['external.user'].sudo().browse(int(ext_id)).exists()

    @api.model_create_multi
    def create(self, vals_list):
        ext = self._get_ext_user()
        if ext:
            vals_list = [dict(v, created_ext_user_id=ext.id, write_ext_user_id=ext.id) for v in vals_list]
        return super().create(vals_list)

    def write(self, vals):
        ext = self._get_ext_user()
        if ext and 'write_ext_user_id' not in vals:
            vals = dict(vals, write_ext_user_id=ext.id)
        return super().write(vals)
