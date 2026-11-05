from odoo import _, api, fields, models

from .supply_api import ApiError, endpoint, ROLE_MATRIX

ROLE_MATRIX['partner_ledger'] = {'accountant', 'manager'}
ACCOUNT_TYPE = {'customer': 'asset_receivable', 'vendor': 'liability_payable'}


class SupplyApiPartner(models.AbstractModel):
    _inherit = 'supply.api'

    def _ledger_kind(self, kind):
        if kind not in ACCOUNT_TYPE:
            raise ApiError('validation_error', _("kind must be 'customer' or 'vendor'."), 'kind')
        return kind, 1 if kind == 'customer' else -1

    def _ledger_domain(self, kind):
        return [('account_id.account_type', '=', ACCOUNT_TYPE[kind]), ('parent_state', '=', 'posted'),
                ('partner_id', '!=', False)]

    @api.model
    @api.readonly
    @endpoint()
    def partner_balances(self, kind, query=None, include_zero=False, offset=0, limit=50):
        """Each customer's (they owe us) or vendor's (we owe them) open balance, from posted entries."""
        self._require('partner_ledger')
        kind, sign = self._ledger_kind(kind)
        limit = max(1, min(int(limit or 50), 200))
        domain = self._ledger_domain(kind)
        if query:
            domain.append(('partner_id', 'ilike', query))
        rows = self.env['account.move.line']._read_group(
            domain, ['partner_id'], ['debit:sum', 'credit:sum', 'balance:sum', 'amount_residual:sum', 'date:max'])
        data = [{'partner': {'id': p.id, 'name': p.display_name}, 'debit': d, 'credit': c, 'balance': sign * b,
                 'last_date': str(last) if last else None}
                for p, d, c, b, _res, last in rows]
        if not include_zero:
            data = [r for r in data if abs(r['balance']) > 0.004]
        data.sort(key=lambda r: -abs(r['balance']))
        total = sum(r['balance'] for r in data)
        page = data[int(offset or 0):int(offset or 0) + limit]
        return {'_page': {'data': page, 'total': len(data), 'offset': int(offset or 0), 'limit': limit,
                          'balance_total': total}}

    @api.model
    @api.readonly
    @endpoint()
    def partner_statement(self, kind, partner_id, date_from=None, date_to=None):
        """Statement of account: opening balance, every posted entry with a running balance, closing balance.
        The balance is what the partner owes us (customer) or what we owe the partner (vendor)."""
        self._require('partner_ledger')
        kind, sign = self._ledger_kind(kind)
        partner = self._get('res.partner', partner_id, 'partner_id')
        Line = self.env['account.move.line']
        base = self._ledger_domain(kind) + [('partner_id', '=', partner.id)]
        opening = 0.0
        if date_from:
            opening = sign * sum(Line.search(base + [('date', '<', date_from)]).mapped('balance'))
        domain = list(base)
        if date_from:
            domain.append(('date', '>=', date_from))
        if date_to:
            domain.append(('date', '<=', date_to))
        lines = Line.search(domain, order='date, id', limit=2000)
        running, out = opening, []
        for l in lines:
            running += sign * l.balance
            out.append({
                'id': l.id, 'date': str(l.date), 'due': str(l.date_maturity) if l.date_maturity else None,
                'document': {'id': l.move_id.id, 'name': l.move_id.name}, 'journal': l.journal_id.name,
                'label': l.name or l.move_id.ref or '', 'debit': l.debit, 'credit': l.credit, 'balance': running,
                'open_amount': abs(l.amount_residual), 'reconciled': bool(l.reconciled)})
        return {
            'partner': {'id': partner.id, 'name': partner.display_name, 'phone': partner.phone or '',
                        'ref': partner.ref or ''},
            'kind': kind, 'date_from': date_from or None, 'date_to': date_to or None,
            'opening': opening, 'debit': sum(lines.mapped('debit')), 'credit': sum(lines.mapped('credit')),
            'closing': running, 'currency': self.env.company.currency_id.name, 'lines': out,
            'truncated': len(lines) >= 2000}
