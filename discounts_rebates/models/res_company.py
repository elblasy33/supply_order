from odoo import fields, models, _
from odoo.exceptions import UserError


class ResCompany(models.Model):
    _inherit = 'res.company'

    rebate_journal_id = fields.Many2one('account.journal', string='Rebate journal', domain="[('type', '=', 'general')]",
                                        check_company=True)
    rebate_expense_account_id = fields.Many2one(
        'account.account', string='Rebates granted (expense)', check_company=True,
        help="Debited when a rebate owed to a customer is provisioned.")
    rebate_accrual_sale_account_id = fields.Many2one(
        'account.account', string='Accrued rebates payable', check_company=True,
        help="Credited by the provision; the customer credit note is posted against it, not against revenue.")
    rebate_income_account_id = fields.Many2one(
        'account.account', string='Rebates received (income)', check_company=True,
        help="Credited when a rebate due from a vendor is provisioned.")
    rebate_accrual_purchase_account_id = fields.Many2one(
        'account.account', string='Accrued rebates receivable', check_company=True,
        help="Debited by the provision; the vendor credit note is posted against it, not against purchases.")

    def action_create_suggested_rebate_accounts(self):
        """Proposal of accounts and journal, to be reviewed with the accountant (codes and names can be changed)."""
        self.ensure_one()
        Account = self.env['account.account']
        plan = [
            ('rebate_expense_account_id', 'Rebates granted to customers (proposal)', 'expense'),
            ('rebate_accrual_sale_account_id', 'Accrued rebates payable to customers (proposal)', 'liability_current'),
            ('rebate_income_account_id', 'Rebates received from vendors (proposal)', 'income'),
            ('rebate_accrual_purchase_account_id', 'Accrued rebates receivable from vendors (proposal)', 'asset_current'),
        ]
        for index, (field, name, account_type) in enumerate(plan, start=1):
            if self[field]:
                continue
            code = 'RBT%02d' % index
            while Account.with_company(self).search_count([('code', '=', code), ('company_ids', 'in', self.id)]):
                code += 'x'
            self[field] = Account.with_company(self).create({
                'name': name, 'code': code, 'account_type': account_type, 'company_ids': [(6, 0, [self.id])]})
        if not self.rebate_journal_id:
            self.rebate_journal_id = self.env['account.journal'].create({
                'name': 'Rebates (proposal)', 'code': 'REB', 'type': 'general', 'company_id': self.id})
        return True

    def _check_rebate_setup(self, applies_to):
        self.ensure_one()
        needed = ['rebate_journal_id'] + (
            ['rebate_expense_account_id', 'rebate_accrual_sale_account_id'] if applies_to == 'sale'
            else ['rebate_income_account_id', 'rebate_accrual_purchase_account_id'])
        missing = [self._fields[f].string for f in needed if not self[f]]
        if missing:
            raise UserError(_("Set the rebate accounts first (Company → Discounts & Rebates). Missing: %s",
                              ', '.join(missing)))
