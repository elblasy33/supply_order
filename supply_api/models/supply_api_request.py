from odoo import api, fields, models


class SupplyApiRequest(models.Model):
    """Answer of a write already served, replayed when the app repeats the same ``idempotency_key``."""
    _name = 'supply.api.request'
    _description = 'Supply API request (idempotency)'
    _order = 'id desc'

    key = fields.Char(required=True, index=True)
    user_id = fields.Many2one('res.users', required=True, default=lambda self: self.env.user)
    method = fields.Char(required=True)
    response = fields.Text(required=True)

    _key_unique = models.Constraint('unique(key, user_id)', 'This idempotency key was already used.')

    @api.autovacuum
    def _gc_old_requests(self):
        """Keys are only useful while a client may still retry."""
        limit = fields.Datetime.subtract(fields.Datetime.now(), days=7)
        self.search([('create_date', '<', limit)]).unlink()
