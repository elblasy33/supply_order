from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.supply_api.models.supply_api import ApiError, endpoint, ROLE_MATRIX

ROLE_MATRIX.update({
    'cash_entry': {'accountant', 'manager'},
    'cash_transfer': {'accountant', 'manager'},
    'expense_create': {'accountant', 'manager'},
})
CASH_TYPES = ('cash', 'bank')


class SupplyApiCash(models.AbstractModel):
    _inherit = 'supply.api'

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _cash_journal(self, journal_id, field='journal_id'):
        journal = self._get('account.journal', journal_id, field)
        if journal.type not in CASH_TYPES:
            raise ApiError('validation_error', _("Choose a cash or bank journal."), field)
        if journal.currency_id and journal.currency_id != journal.company_id.currency_id:
            raise ApiError('validation_error', _("Journals in a foreign currency are not supported here."), field)
        return journal

    @staticmethod
    def _cash_amount(amount):
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            amount = 0.0
        if amount <= 0:
            raise ApiError('validation_error', _("The amount must be greater than zero."), 'amount')
        return amount

    def _cash_balance(self, journal):
        account = journal.default_account_id
        if not account:
            return 0.0
        groups = self.env['account.move.line']._read_group(
            [('journal_id', '=', journal.id), ('account_id', '=', account.id), ('parent_state', '=', 'posted')],
            [], ['balance:sum'])
        return groups[0][0] or 0.0

    def _cash_journal_data(self, journal):
        return {'id': journal.id, 'name': journal.name, 'type': journal.type, 'code': journal.code,
                'balance': self._cash_balance(journal), 'currency': journal.company_id.currency_id.name,
                'has_account': bool(journal.default_account_id)}

    def _cash_move_data(self, pay):
        transfer = pay.supply_cash_kind == 'transfer'
        other = pay.paired_internal_transfer_payment_id.journal_id
        return {
            'id': pay.id, 'name': pay.name or pay.move_id.name or '', 'kind': pay.supply_cash_kind or 'expense',
            'date': str(pay.date), 'ref': pay.memo or '', 'state': pay.state,
            'journal': {'id': pay.journal_id.id, 'name': pay.journal_id.name},
            'partner': {'id': pay.partner_id.id, 'name': pay.partner_id.name} if pay.partner_id and not transfer else None,
            'amount': pay.amount,
            'direction': pay.payment_type,
            'counter_journal': {'id': other.id, 'name': other.name} if transfer and other else None,
        }

    def _cash_payment(self, journal, payment_type, date, memo, partner, partner_type, amount, kind, account):
        """A real, posted payment that moves the treasury account directly (no 'payments in process' step)."""
        pay = self.env['account.payment'].create({
            'payment_type': payment_type, 'partner_type': partner_type, 'partner_id': partner.id,
            'amount': amount, 'journal_id': journal.id, 'date': date or fields.Date.context_today(self),
            'memo': memo or False, 'supply_cash_kind': kind, 'destination_account_id': account.id})
        # the treasury account itself, so the balance moves at once (not a 'payments in process' account)
        pay.outstanding_account_id = journal.default_account_id
        pay.action_post()
        return pay

    # ------------------------------------------------------------------
    # journals and history
    # ------------------------------------------------------------------
    @api.model
    @api.readonly
    @endpoint()
    def cash_journals(self):
        journals = self.env['account.journal'].search(
            [('type', 'in', CASH_TYPES), ('default_account_id', '!=', False), ('company_id', '=', self.env.company.id)],
            order='type, name')
        return [self._cash_journal_data(j) for j in journals]

    @api.model
    @api.readonly
    @endpoint()
    def cash_search(self, journal_id=None, kind=None, offset=0, limit=50):
        limit = max(1, min(int(limit or 50), 200))
        domain = [('supply_cash_kind', '!=', False), ('journal_id.type', 'in', CASH_TYPES)]
        if kind:
            domain.append(('supply_cash_kind', '=', kind))
        if journal_id:
            domain.append(('journal_id', '=', int(journal_id)))
        Pay = self.env['account.payment']
        moves = Pay.search(domain, offset=int(offset or 0), limit=limit, order='date desc, id desc')
        return {'_page': {'data': [self._cash_move_data(m) for m in moves], 'total': Pay.search_count(domain),
                          'offset': int(offset or 0), 'limit': limit}}

    # ------------------------------------------------------------------
    # receipts and payments: posted against the partner account, never reconciled
    # ------------------------------------------------------------------
    @api.model
    @endpoint(write=True)
    def cash_entry(self, journal_id, partner_id, direction, partner_kind, amount, date=None, ref=None):
        """Money in (``in``) or out (``out``) of a cash/bank journal for a customer or a vendor.

        The entry debits/credits the partner's receivable or payable account; it stays an open item on the
        partner (an advance or an amount on account) and is not matched to any invoice."""
        self._require('cash_entry')
        if direction not in ('in', 'out'):
            raise ApiError('validation_error', _("direction must be 'in' or 'out'."), 'direction')
        if partner_kind not in ('customer', 'vendor'):
            raise ApiError('validation_error', _("partner_kind must be 'customer' or 'vendor'."), 'partner_kind')
        journal = self._cash_journal(journal_id)
        if not journal.default_account_id:
            raise ApiError('validation_error', _("The journal has no default account."), 'journal_id')
        partner = self._get('res.partner', partner_id, 'partner_id').commercial_partner_id
        amount = self._cash_amount(amount)
        account = partner.property_account_receivable_id if partner_kind == 'customer' \
            else partner.property_account_payable_id
        pay = self._cash_payment(
            journal, 'inbound' if direction == 'in' else 'outbound', date, ref, partner,
            'customer' if partner_kind == 'customer' else 'supplier', amount,
            'receipt' if direction == 'in' else 'payment', account)
        return self._cash_move_data(pay)

    @api.model
    @endpoint(write=True)
    def cash_transfer(self, from_journal_id, to_journal_id, amount, date=None, ref=None):
        """Move money between two treasuries (cash <-> bank): one entry in the source journal."""
        self._require('cash_transfer')
        source = self._cash_journal(from_journal_id, 'from_journal_id')
        target = self._cash_journal(to_journal_id, 'to_journal_id')
        if source == target:
            raise ApiError('validation_error', _("Choose two different journals."), 'to_journal_id')
        if not source.default_account_id or not target.default_account_id:
            raise ApiError('validation_error', _("The journal has no default account."), 'from_journal_id')
        amount = self._cash_amount(amount)
        transit = source.company_id.transfer_account_id
        if not transit:
            raise ApiError('validation_error', _("Set the company's internal transfer account first."), 'from_journal_id')
        company_partner = source.company_id.partner_id
        out = self._cash_payment(source, 'outbound', date, ref, company_partner, 'supplier', amount, 'transfer', transit)
        inc = self._cash_payment(target, 'inbound', date, ref, company_partner, 'customer', amount, 'transfer', transit)
        out.paired_internal_transfer_payment_id, inc.paired_internal_transfer_payment_id = inc, out
        return self._cash_move_data(out)

    # ------------------------------------------------------------------
    # company-paid expenses (hr_expense)
    # ------------------------------------------------------------------
    def _expense_employee(self):
        """The one employee every company-paid expense is booked on (expenses are never an employee's)."""
        params = self.env['ir.config_parameter'].sudo()
        employee = self.env['hr.employee'].sudo().browse(params.get_int('supply_cash.expense_employee_id')).exists()
        if not employee:
            employee = self.env['hr.employee'].sudo().create({
                'name': _("Company expenses"), 'company_id': self.env.company.id})
            params.set_int('supply_cash.expense_employee_id', employee.id)
        return employee

    @api.model
    @api.readonly
    @endpoint()
    def expense_products(self, query=None, limit=30):
        limit = max(1, min(int(limit or 30), 100))
        domain = [('can_be_expensed', '=', True)]
        if query:
            domain += ['|', ('name', 'ilike', query), ('default_code', 'ilike', query)]
        return [{'id': p.id, 'name': p.display_name, 'code': p.default_code or '', 'cost': p.standard_price}
                for p in self.env['product.product'].search(domain, limit=limit, order='name')]

    @api.model
    @endpoint(write=True)
    def expense_create(self, journal_id, product_id, amount, date=None, name=None, notes=None):
        """A company-paid expense taken from a cash/bank journal; approved and posted at once."""
        self._require('expense_create')
        journal = self._cash_journal(journal_id)
        product = self._get('product.product', product_id, 'product_id')
        if not product.can_be_expensed:
            raise ApiError('validation_error', _("This product cannot be expensed."), 'product_id')
        amount = self._cash_amount(amount)
        line = journal.outbound_payment_method_line_ids[:1]
        if not line:
            raise ApiError('validation_error', _("The journal has no outgoing payment method."), 'journal_id')
        if not line.payment_account_id:
            # pay straight out of the treasury account (no 'payments in process' step), as the other vouchers do
            line.sudo().payment_account_id = journal.default_account_id
        employee = self._expense_employee()
        # Approval rights belong to the app's own role check, not to the integration user's Odoo groups.
        expense = self.env['hr.expense'].sudo().create({
            'name': name or product.display_name, 'employee_id': employee.id, 'product_id': product.id,
            'payment_mode': 'company_account', 'payment_method_line_id': line.id,
            'total_amount_currency': amount, 'quantity': 1,
            'date': date or fields.Date.context_today(self), 'description': notes or False,
            'company_id': journal.company_id.id})
        try:
            expense.action_submit()
            if expense.state == 'submitted':
                expense.action_approve()
        except ValidationError:
            raise
        move = expense.account_move_id
        # the entries of company-paid expenses are created as drafts: post them so the treasury balance moves
        (move | move.origin_payment_id.move_id).filtered(lambda m: m.state == 'draft').action_post()
        return {'id': expense.id, 'name': expense.name, 'state': expense.state, 'amount': expense.total_amount,
                'date': str(expense.date), 'product': {'id': product.id, 'name': product.display_name},
                'journal': {'id': journal.id, 'name': journal.name},
                'move': {'id': move.id, 'name': move.name} if move else None}

    @api.model
    @api.readonly
    @endpoint()
    def expense_search(self, journal_id=None, offset=0, limit=50):
        limit = max(1, min(int(limit or 50), 200))
        domain = [('payment_mode', '=', 'company_account'),
                  ('employee_id', '=', self._expense_employee().id)]
        if journal_id:
            domain.append(('payment_method_line_id.journal_id', '=', int(journal_id)))
        Expense = self.env['hr.expense'].sudo()  # visibility is the app's role check, not Odoo's expense rules
        rows = Expense.search(domain, offset=int(offset or 0), limit=limit, order='date desc, id desc')
        data = [{'id': e.id, 'name': e.name, 'state': e.state, 'amount': e.total_amount, 'date': str(e.date),
                 'product': {'id': e.product_id.id, 'name': e.product_id.display_name},
                 'journal': {'id': e.payment_method_line_id.journal_id.id,
                             'name': e.payment_method_line_id.journal_id.name}} for e in rows]
        return {'_page': {'data': data, 'total': Expense.search_count(domain), 'offset': int(offset or 0),
                          'limit': limit}}
