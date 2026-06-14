# -*- coding: utf-8 -*-
from odoo import models, fields, tools

class B2BLedgerSummary(models.Model):
    _name = 'b2b.ledger.summary'
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
            'name': 'Ledger Details: %s' % self.partner_id.name,
            'view_mode': 'list,pivot',
            'res_model': 'b2b.ledger',
            'type': 'ir.actions.act_window',
            'domain': [('partner_id', '=', self.partner_id.id)],
            'context': {
                'default_partner_id': self.partner_id.id,
                'search_default_group_partner': 0
            }
        }

class B2BLedger(models.Model):
    _name = 'b2b.ledger'
    _description = 'Partner Ledger (B2B OS)'
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
    
    
    def unlink(self):
        # Allow deleting directly from the ledger view by deleting the source
        # journal entry. This is an intentional B2B OS workflow.
        move_ids_to_check = set()
        for rec in self:
            try:
                if rec.exists() and rec.move_id:
                    move_ids_to_check.add(rec.move_id.id)
            except Exception:
                pass

        if move_ids_to_check:
            moves = self.env['account.move'].browse(list(move_ids_to_check)).exists()
            for move in moves:
                try:
                    if move.line_ids:
                        move.line_ids.remove_move_reconcile()

                    if move.state != 'draft':
                        move.button_draft()

                    move.with_context(force_delete=True).unlink()
                except Exception as e:
                    print(f"Error during move unlink: {e}")

        return True

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


class B2BManualEntryWizard(models.TransientModel):
    _name = 'b2b.manual.entry.wizard'
    _description = 'Create Manual Ledger Entry'

    partner_id = fields.Many2one('res.partner', string='Partner', required=True)
    date = fields.Date(string='Date', required=True, default=fields.Date.context_today)
    narration = fields.Char(string='Narration / Label', default='B2B Automated Settlement')
    payment_details = fields.Char(string='Payment Details')
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

    def _b2b_get_target_lines(self):
        self.ensure_one()
        if self.line_ids:
            target_lines = self.line_ids
        else:
            if self.entry_type == 'credit':
                domain = [
                    ('partner_id', '=', self.partner_id.id),
                    ('amount_residual', '>', 0),
                    ('account_id.account_type', '=', 'asset_receivable'),
                    ('parent_state', '=', 'posted'),
                ]
            elif self.entry_type == 'debit':
                domain = [
                    ('partner_id', '=', self.partner_id.id),
                    ('amount_residual', '<', 0),
                    ('account_id.account_type', '=', 'liability_payable'),
                    ('parent_state', '=', 'posted'),
                ]
            else:
                domain = [
                    ('partner_id', '=', self.partner_id.id),
                    ('amount_residual', '!=', 0),
                    ('account_id.account_type', 'in', ('asset_receivable', 'liability_payable')),
                    ('parent_state', '=', 'posted'),
                ]
            target_lines = self.env['account.move.line'].search(domain, order='date asc, move_name asc, id asc')

        if self.entry_type == 'credit':
            return target_lines.filtered(lambda line: line.amount_residual > 0).sorted(
                key=lambda line: (line.date or fields.Date.today(), line.move_name or '', line.id)
            )
        if self.entry_type == 'debit':
            return target_lines.filtered(lambda line: line.amount_residual < 0).sorted(
                key=lambda line: (line.date or fields.Date.today(), line.move_name or '', line.id)
            )
        return target_lines.sorted(key=lambda line: (line.date or fields.Date.today(), line.move_name or '', line.id))
    
    def action_post_entry(self):
        self.ensure_one()
        if self.amount <= 0:
            return

        entry_label = (self.payment_details or self.narration or '').strip() or 'B2B Automated Settlement'
        move_ref = 'Manual: %s' % entry_label
        if self.entry_type == 'credit':
            move_ref = 'Credit - %s' % entry_label
            
        move_obj = self.env['account.move']
        
        # 1. Get/Create "B2B OS Manual" Journal
        journal = self.env['account.journal'].search([('code', '=', 'BOSM')], limit=1)
        if not journal:
            journal = self.env['account.journal'].create({
                'name': 'B2B OS Manual',
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
                ar_acc = self.partner_id.property_account_receivable_id
                ap_acc = self.partner_id.property_account_payable_id
                lines.append((0, 0, {'name': self.narration, 'partner_id': self.partner_id.id, 'account_id': ap_acc.id, 'debit': self.amount, 'credit': 0.0}))
                lines.append((0, 0, {'name': self.narration, 'partner_id': self.partner_id.id, 'account_id': ar_acc.id, 'debit': 0.0, 'credit': self.amount}))
            else:
                remaining_reduce_ar = self.amount
                remaining_reduce_ap = self.amount

                for sel in self.line_ids:
                    if sel.amount_residual > 0 and remaining_reduce_ar > 0:
                        alloc = min(remaining_reduce_ar, sel.amount_residual)
                        lines.append((0, 0, {'name': 'Set-off '+sel.move_id.name, 'partner_id': self.partner_id.id, 'account_id': sel.account_id.id, 'debit': 0.0, 'credit': alloc}))
                        remaining_reduce_ar -= alloc
                    elif sel.amount_residual < 0 and remaining_reduce_ap > 0:
                        alloc = min(remaining_reduce_ap, abs(sel.amount_residual))
                        lines.append((0, 0, {'name': 'Set-off '+sel.move_id.name, 'partner_id': self.partner_id.id, 'account_id': sel.account_id.id, 'debit': alloc, 'credit': 0.0}))
                        remaining_reduce_ap -= alloc

                if remaining_reduce_ar > 0:
                    lines.append((0, 0, {'name': 'Unallocated Set-off AR', 'partner_id': self.partner_id.id, 'account_id': self.partner_id.property_account_receivable_id.id, 'debit': 0.0, 'credit': remaining_reduce_ar}))
                if remaining_reduce_ap > 0:
                    lines.append((0, 0, {'name': 'Unallocated Set-off AP', 'partner_id': self.partner_id.id, 'account_id': self.partner_id.property_account_payable_id.id, 'debit': remaining_reduce_ap, 'credit': 0.0}))

        # -- NORMAL PAYMENT LOGIC --
        else:
            target_lines = self._b2b_get_target_lines()
            if self.entry_type == 'credit':
                partner_acc = self.partner_id.property_account_receivable_id
                lines.append((0, 0, {
                    'name': entry_label,
                    'partner_id': self.partner_id.id,
                    'account_id': partner_acc.id,
                    'debit': 0.0,
                    'credit': self.amount,
                }))
                lines.append((0, 0, {
                    'name': entry_label,
                    'account_id': contra_acc.id,
                    'debit': self.amount,
                    'credit': 0.0,
                }))
            elif self.entry_type == 'debit':
                partner_acc = self.partner_id.property_account_payable_id
                lines.append((0, 0, {
                    'name': entry_label,
                    'partner_id': self.partner_id.id,
                    'account_id': partner_acc.id,
                    'debit': self.amount,
                    'credit': 0.0,
                }))
                lines.append((0, 0, {
                    'name': entry_label,
                    'account_id': contra_acc.id,
                    'debit': 0.0,
                    'credit': self.amount,
                }))

            if not target_lines and not lines:
                partner_acc = self.partner_id.property_account_receivable_id if self.entry_type == 'debit' else self.partner_id.property_account_payable_id
                if self.entry_type == 'debit':
                    lines.append((0, 0, {'name': entry_label, 'partner_id': self.partner_id.id, 'account_id': partner_acc.id, 'debit': self.amount, 'credit': 0.0}))
                    lines.append((0, 0, {'name': entry_label, 'account_id': contra_acc.id, 'debit': 0.0, 'credit': self.amount}))
                else:
                    lines.append((0, 0, {'name': entry_label, 'partner_id': self.partner_id.id, 'account_id': partner_acc.id, 'debit': 0.0, 'credit': self.amount}))
                    lines.append((0, 0, {'name': entry_label, 'account_id': contra_acc.id, 'debit': self.amount, 'credit': 0.0}))

        move = move_obj.create({
            'journal_id': journal.id,
            'date': self.date,
            'ref': move_ref,
            'line_ids': lines,
        })
        move.action_post()
        
        target_lines = self._b2b_get_target_lines()
        if target_lines:
            if self.entry_type in ('credit', 'debit'):
                payment_line = move.line_ids.filtered(
                    lambda l: l.partner_id == self.partner_id and l.account_id in target_lines.mapped('account_id')
                )[:1]
                for target in target_lines:
                    if not payment_line or not payment_line.exists():
                        break
                    if not payment_line.amount_residual:
                        break
                    if not target.exists() or not target.amount_residual:
                        continue
                    (target | payment_line).reconcile()
            else:
                for acc in target_lines.mapped('account_id'):
                    target_sel = target_lines.filtered(lambda l: l.account_id == acc)
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
