# -*- coding: utf-8 -*-
from odoo import _, api, models, fields, tools
from .ledger_statement_mixin import LedgerStatementMixin


def _format_current_balance(env, balance):
    currency = env.company.currency_id
    symbol = currency.symbol or currency.name or ''
    amount_text = f"{abs(balance):,.2f}"
    prefix = '-' if balance < 0 else ''
    return f"{prefix}{symbol} {amount_text}".strip()


class BusinessLedgerSummary(models.Model):
    _name = 'business.ledger.summary'
    _description = 'Partner Ledger Summary (Tally Group View)'
    _auto = False
    _order = 'partner_id'

    partner_id = fields.Many2one('res.partner', string='Partner', readonly=True)
    debit = fields.Float(string='Total Debit', readonly=True)
    credit = fields.Float(string='Total Credit', readonly=True)
    balance = fields.Float(string='Net Balance (Dr - Cr)', readonly=True)
    
    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT 
                    aml.partner_id as id,
                    aml.partner_id as partner_id,
                    SUM(aml.debit) as debit,
                    SUM(aml.credit) as credit,
                    SUM(aml.debit - aml.credit) as balance
                FROM account_move_line aml
                JOIN account_account acc ON aml.account_id = acc.id
                JOIN account_move move ON aml.move_id = move.id
                WHERE acc.account_type IN ('asset_receivable', 'liability_payable')
                  AND move.state = 'posted'
                  AND aml.partner_id IS NOT NULL
                GROUP BY aml.partner_id
            )
        """ % (self._table,))

    def action_open_ledger_details(self):
        self.ensure_one()
        return {
            'name': _('Partner Ledger: %(party)s | Current Balance: %(balance)s', party=self.partner_id.name, balance=_format_current_balance(self.env, self.balance)),
            'view_mode': 'list,pivot',
            'res_model': 'business.ledger',
            'type': 'ir.actions.act_window',
            'domain': [('partner_id', '=', self.partner_id.id)],
            'context': {
                'default_partner_id': self.partner_id.id,
                'search_default_group_partner': 0
            }
        }

class BusinessLedger(models.Model, LedgerStatementMixin):
    _name = 'business.ledger'
    _description = 'Partner Ledger (Business OS)'
    _auto = False
    _order = 'date desc, id desc'

    date = fields.Date(string='Date', readonly=True)
    partner_id = fields.Many2one('res.partner', string='Partner', readonly=True)
    move_id = fields.Many2one('account.move', string='Journal Entry', readonly=True)
    name = fields.Char(string='Label', readonly=True)
    ref = fields.Char(string='Reference', readonly=True)
    debit = fields.Float(string='Debit', readonly=True)
    credit = fields.Float(string='Credit', readonly=True)
    balance = fields.Float(string='Net Balance (Dr - Cr)', readonly=True)
    amount_currency = fields.Float(string='Amount in Currency', readonly=True)
    currency_id = fields.Many2one('res.currency', string='Currency', readonly=True)
    account_id = fields.Many2one('account.account', string='Account', readonly=True)
    company_id = fields.Many2one('res.company', string='Company', readonly=True)
    filter_date_from = fields.Date(string='From', store=False)
    filter_date_to = fields.Date(string='To', store=False)
    
    
    def unlink(self):
        # Allow deleting directly from the ledger view
        # This will securely try to cancel and delete the underlying Journal Entry
        move_ids_to_check = set()
        for rec in self:
            try:
                if rec.exists() and rec.move_id:
                    move_ids_to_check.add(rec.move_id.id)
            except:
                pass
        
        if move_ids_to_check:
            moves = self.env['account.move'].browse(list(move_ids_to_check)).exists()
            for move in moves:
                try:
                    # Unreconcile first if needed
                    if move.line_ids:
                        move.line_ids.remove_move_reconcile()
                    
                    # Reset to draft
                    if move.state != 'draft':
                        move.button_draft()
                        
                    # Delete the original Move
                    move.with_context(force_delete=True).unlink()
                except Exception as e:
                    print(f"Error during move unlink: {e}")
                
        # Since business.ledger is a SQL view, returning True bypasses the generic SQL deletion
        return True

    def _statement_row_labels(self, label):
        return {
            'name': label,
            'ref': 'Carry-forward balance' if label == 'Opening Balance' else 'Balance after selected range',
        }

    @api.model
    @api.readonly
    def web_search_read(self, domain, specification, offset=0, limit=None, order=None, count_limit=None):
        result = super().web_search_read(domain, specification, offset=offset, limit=limit, order=order, count_limit=count_limit)
        return self._append_statement_rows(domain, specification, result, offset)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    aml.id as id,
                    aml.date as date,
                    aml.partner_id as partner_id,
                    aml.move_id as move_id,
                    aml.name as name,
                    aml.ref as ref,
                    aml.debit as debit,
                    aml.credit as credit,
                    (aml.debit - aml.credit) as balance,
                    aml.amount_currency as amount_currency,
                    aml.currency_id as currency_id,
                    aml.account_id as account_id,
                    aml.company_id as company_id
                FROM account_move_line aml
                JOIN account_account acc ON aml.account_id = acc.id
                JOIN account_move move ON aml.move_id = move.id
                WHERE acc.account_type IN ('asset_receivable', 'liability_payable')
                  AND move.state = 'posted'
                  AND aml.partner_id IS NOT NULL
            )
        """ % (self._table,))


class BusinessManualEntryWizard(models.TransientModel):
    _name = 'business.manual.entry.wizard'
    _description = 'Create Manual Ledger Entry'

    partner_id = fields.Many2one('res.partner', string='Partner', required=True)
    date = fields.Date(string='Date', required=True, default=fields.Date.context_today)
    narration = fields.Char(string='Narration / Label', default='OS Automated Settlement')
    amount = fields.Float(string='Amount', required=True)
    entry_type = fields.Selection([
        ('debit', 'Debit (Increase what they owe you / You paid them)'),
        ('credit', 'Credit (Increase what you owe them / They paid you)'),
        ('setoff', 'Internal Set-Off / Contra (Reconcile Bills & Invoices)')
    ], string='Entry Type', required=True, default='credit')
    
    line_ids = fields.Many2many(
        'account.move.line',
        string='Pending Items to Settle',
        domain="[('partner_id', '=', partner_id), ('amount_residual', '!=', 0), ('account_id.account_type', 'in', ('asset_receivable', 'liability_payable')), ('parent_state', '=', 'posted')]"
    )
    
    def action_post_entry(self):
        self.ensure_one()
        if self.amount <= 0:
            return
            
        move_obj = self.env['account.move']
        
        # 1. Get/Create "Business OS Manual" Journal
        journal = self.env['account.journal'].search([('code', '=', 'BOSM')], limit=1)
        if not journal:
            journal = self.env['account.journal'].create({
                'name': 'Business OS Manual',
                'code': 'BOSM',
                'type': 'general',
                'company_id': self.env.company.id,
                'show_on_dashboard': False,
            })
            
        # Contra Account (Suspense / Bank)
        contra_acc = journal.default_account_id or self.env.company.account_journal_suspense_account_id
        if not contra_acc:
            contra_acc = self.env['account.account'].search([('account_type', 'in', ['asset_current', 'equity_unallocated', 'liability_current'])], limit=1)

        lines = []

        # -- SET OFF CONTRA LOGIC --
        if self.entry_type == 'setoff':
            if not self.line_ids:
                # If they forgot to select lines, just do a generic AR/AP swap
                ar_acc = self.partner_id.property_account_receivable_id
                ap_acc = self.partner_id.property_account_payable_id
                lines.append((0, 0, {'name': self.narration, 'partner_id': self.partner_id.id, 'account_id': ap_acc.id, 'debit': self.amount, 'credit': 0.0}))
                lines.append((0, 0, {'name': self.narration, 'partner_id': self.partner_id.id, 'account_id': ar_acc.id, 'debit': 0.0, 'credit': self.amount}))
            else:
                # Allocate Debits & Credits intelligently based on selected lines
                remaining_reduce_ar = self.amount  # We need to Credit AR by Amount
                remaining_reduce_ap = self.amount  # We need to Debit AP by Amount

                for sel in self.line_ids:
                    # Invoice (AR) -> Residual > 0 -> Needs Credit to set off
                    if sel.amount_residual > 0 and remaining_reduce_ar > 0:
                        alloc = min(remaining_reduce_ar, sel.amount_residual)
                        lines.append((0, 0, {'name': 'Set-off '+sel.move_id.name, 'partner_id': self.partner_id.id, 'account_id': sel.account_id.id, 'debit': 0.0, 'credit': alloc}))
                        remaining_reduce_ar -= alloc
                    # Bill (AP) -> Residual < 0 -> Needs Debit to set off
                    elif sel.amount_residual < 0 and remaining_reduce_ap > 0:
                        alloc = min(remaining_reduce_ap, abs(sel.amount_residual))
                        lines.append((0, 0, {'name': 'Set-off '+sel.move_id.name, 'partner_id': self.partner_id.id, 'account_id': sel.account_id.id, 'debit': alloc, 'credit': 0.0}))
                        remaining_reduce_ap -= alloc

                # Any unallocated Set-Off goes to their default accounts
                if remaining_reduce_ar > 0:
                    lines.append((0, 0, {'name': 'Unallocated Set-off AR', 'partner_id': self.partner_id.id, 'account_id': self.partner_id.property_account_receivable_id.id, 'debit': 0.0, 'credit': remaining_reduce_ar}))
                if remaining_reduce_ap > 0:
                    lines.append((0, 0, {'name': 'Unallocated Set-off AP', 'partner_id': self.partner_id.id, 'account_id': self.partner_id.property_account_payable_id.id, 'debit': remaining_reduce_ap, 'credit': 0.0}))

        # -- NORMAL PAYMENT LOGIC --
        else:
            if self.line_ids:
                remaining = self.amount
                for sel in self.line_ids:
                    if remaining <= 0: break
                    alloc = min(remaining, abs(sel.amount_residual))
                    remaining -= alloc
                    
                    if self.entry_type == 'credit': # E.g. Receiving money, paying off an AR invoice
                        lines.append((0, 0, {'name': 'Settle '+sel.move_id.name, 'partner_id': self.partner_id.id, 'account_id': sel.account_id.id, 'debit': 0.0, 'credit': alloc}))
                    elif self.entry_type == 'debit': # E.g. Paying money, paying off an AP bill
                        lines.append((0, 0, {'name': 'Settle '+sel.move_id.name, 'partner_id': self.partner_id.id, 'account_id': sel.account_id.id, 'debit': alloc, 'credit': 0.0}))
                
                # Bank/Contra Side
                if self.entry_type == 'credit':
                    lines.append((0, 0, {'name': self.narration, 'account_id': contra_acc.id, 'debit': self.amount, 'credit': 0.0}))
                    if remaining > 0:
                        lines.append((0, 0, {'name': 'Overpayment', 'partner_id': self.partner_id.id, 'account_id': self.partner_id.property_account_receivable_id.id, 'debit': 0.0, 'credit': remaining}))
                else:
                    lines.append((0, 0, {'name': self.narration, 'account_id': contra_acc.id, 'debit': 0.0, 'credit': self.amount}))
                    if remaining > 0:
                        lines.append((0, 0, {'name': 'Overpayment', 'partner_id': self.partner_id.id, 'account_id': self.partner_id.property_account_payable_id.id, 'debit': remaining, 'credit': 0.0}))
            else:
                # No line_ids selected - fallback native behavior
                partner_acc = self.partner_id.property_account_receivable_id if self.entry_type == 'debit' else self.partner_id.property_account_payable_id
                if self.entry_type == 'debit':
                    lines.append((0, 0, {'name': self.narration, 'partner_id': self.partner_id.id, 'account_id': partner_acc.id, 'debit': self.amount, 'credit': 0.0}))
                    lines.append((0, 0, {'name': self.narration, 'account_id': contra_acc.id, 'debit': 0.0, 'credit': self.amount}))
                else:
                    lines.append((0, 0, {'name': self.narration, 'partner_id': self.partner_id.id, 'account_id': partner_acc.id, 'debit': 0.0, 'credit': self.amount}))
                    lines.append((0, 0, {'name': self.narration, 'account_id': contra_acc.id, 'debit': self.amount, 'credit': 0.0}))

        # 4. Post Move
        move = move_obj.create({
            'journal_id': journal.id,
            'date': self.date,
            'ref': 'Manual: %s' % self.narration,
            'line_ids': lines,
        })
        move.action_post()
        
        # 5. RECONCILE!
        if self.line_ids:
            for acc in self.line_ids.mapped('account_id'):
                target_sel = self.line_ids.filtered(lambda l: l.account_id == acc)
                target_new = move.line_ids.filtered(lambda l: l.account_id == acc and l.partner_id == self.partner_id)
                if target_sel and target_new:
                    (target_sel | target_new).reconcile()
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Entry Posted',
                'message': 'Successfully posted entry for %s.' % self.partner_id.name,
                'sticky': False,
                'type': 'success',
            }
        }
