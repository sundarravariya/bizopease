# -*- coding: utf-8 -*-
from odoo import _, fields, models, tools
from odoo.exceptions import UserError


def _format_current_balance(env, balance):
    currency = env.company.currency_id
    symbol = currency.symbol or currency.name or ''
    amount_text = f"{abs(balance):,.2f}"
    prefix = '-' if balance < 0 else ''
    return f"{prefix}{symbol} {amount_text}".strip()


class BizUnifiedLedgerLine(models.Model):
    _name = 'biz.unified.ledger.line'
    _description = 'Biz Unified Ledger Line'
    _auto = False
    _order = 'date desc, id desc'

    date = fields.Date(string='Date', readonly=True)
    party_id = fields.Integer(string='Party ID', readonly=True)
    party_type = fields.Selection([
        ('partner', 'Partner'),
        ('vendor', 'Vendor'),
        ('associate', 'Associate'),
        ('agent', 'Agent'),
    ], string='Party Type', readonly=True)
    party_name = fields.Char(string='Party', readonly=True)
    source_model = fields.Char(string='Source Model', readonly=True)
    source_record_id = fields.Integer(string='Source ID', readonly=True)
    entry_type = fields.Char(string='Entry Type', readonly=True)
    reference = fields.Char(string='Reference', readonly=True)
    details = fields.Text(string='Details', readonly=True)
    debit = fields.Float(string='Debit', readonly=True)
    credit = fields.Float(string='Credit', readonly=True)
    balance = fields.Float(string='Balance', readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    aml.id AS id,
                    aml.date AS date,
                    aml.partner_id AS party_id,
                    'partner'::varchar AS party_type,
                    COALESCE(partner.name, 'Unknown Partner') AS party_name,
                    'account.move'::varchar AS source_model,
                    aml.move_id AS source_record_id,
                    COALESCE(move.move_type, 'journal_entry') AS entry_type,
                    COALESCE(move.name, aml.ref, '') AS reference,
                    COALESCE(aml.name, aml.ref, move.ref, '') AS details,
                    COALESCE(aml.debit, 0.0) AS debit,
                    COALESCE(aml.credit, 0.0) AS credit,
                    COALESCE(aml.debit, 0.0) - COALESCE(aml.credit, 0.0) AS balance
                FROM account_move_line aml
                JOIN account_account account ON aml.account_id = account.id
                JOIN account_move move ON aml.move_id = move.id
                JOIN res_partner partner ON aml.partner_id = partner.id
                WHERE account.account_type IN ('asset_receivable', 'liability_payable')
                  AND move.state = 'posted'
                  AND aml.partner_id IS NOT NULL

                UNION ALL

                SELECT
                    100000000 + tx.id AS id,
                    tx.date AS date,
                    tx.vendor_id AS party_id,
                    'vendor'::varchar AS party_type,
                    COALESCE(vendor.name, 'Unknown Vendor') AS party_name,
                    'biz.bill.payment.transaction'::varchar AS source_model,
                    tx.id AS source_record_id,
                    'bill_payment'::varchar AS entry_type,
                    COALESCE(tx.name, '') AS reference,
                    COALESCE(tx.note, 'Bill/Payment transaction') AS details,
                    COALESCE(tx.transfer_amount, 0.0) AS debit,
                    COALESCE(tx.deduction_amount, 0.0)
                        + CASE
                            WHEN tx.payment_received THEN
                                COALESCE(NULLIF(tx.actual_cash_received, 0.0), tx.expected_cash_amount, 0.0)
                            ELSE 0.0
                          END AS credit,
                    COALESCE(tx.transfer_amount, 0.0)
                        - COALESCE(tx.deduction_amount, 0.0)
                        - CASE
                            WHEN tx.payment_received THEN
                                COALESCE(NULLIF(tx.actual_cash_received, 0.0), tx.expected_cash_amount, 0.0)
                            ELSE 0.0
                          END AS balance
                FROM biz_bill_payment_transaction tx
                JOIN biz_bill_payment_vendor vendor ON tx.vendor_id = vendor.id
                WHERE tx.vendor_id IS NOT NULL

                UNION ALL

                SELECT
                    200000000 + ledger.id AS id,
                    ledger.date AS date,
                    ledger.associate_id AS party_id,
                    'associate'::varchar AS party_type,
                    COALESCE(associate.name, 'Unknown Associate') AS party_name,
                    'biz.associate.ledger'::varchar AS source_model,
                    ledger.id AS source_record_id,
                    COALESCE(ledger.entry_type, '') AS entry_type,
                    COALESCE(ledger.reference, '') AS reference,
                    COALESCE(ledger.note, '') AS details,
                    CASE
                        WHEN ledger.entry_type IN ('cash_received', 'transfer_in')
                            THEN COALESCE(ledger.amount, 0.0)
                        ELSE 0.0
                    END AS debit,
                    CASE
                        WHEN ledger.entry_type IN ('expense', 'transfer_out')
                            THEN COALESCE(ledger.amount, 0.0)
                        ELSE 0.0
                    END AS credit,
                    CASE
                        WHEN ledger.entry_type IN ('cash_received', 'transfer_in')
                            THEN COALESCE(ledger.amount, 0.0)
                        ELSE -COALESCE(ledger.amount, 0.0)
                    END AS balance
                FROM biz_associate_ledger ledger
                JOIN biz_money_associate associate ON ledger.associate_id = associate.id
                WHERE ledger.associate_id IS NOT NULL

                UNION ALL

                SELECT
                    300000000 + ledger.id AS id,
                    ledger.date AS date,
                    ledger.agent_id AS party_id,
                    'agent'::varchar AS party_type,
                    COALESCE(agent.name, 'Unknown Agent') AS party_name,
                    'biz.agent.ledger'::varchar AS source_model,
                    ledger.id AS source_record_id,
                    COALESCE(ledger.entry_type, '') AS entry_type,
                    COALESCE(ledger.reference, '') AS reference,
                    COALESCE(ledger.notes, '') AS details,
                    CASE
                        WHEN ledger.entry_type = 'payment' THEN COALESCE(ledger.amount_inr, 0.0)
                        ELSE 0.0
                    END AS debit,
                    CASE
                        WHEN ledger.entry_type = 'payment' THEN 0.0
                        ELSE COALESCE(ledger.amount_inr, 0.0)
                    END AS credit,
                    CASE
                        WHEN ledger.entry_type = 'payment' THEN COALESCE(ledger.amount_inr, 0.0)
                        ELSE -COALESCE(ledger.amount_inr, 0.0)
                    END AS balance
                FROM biz_agent_ledger ledger
                JOIN biz_carrying_agent agent ON ledger.agent_id = agent.id
                WHERE ledger.agent_id IS NOT NULL
            )
        """ % self._table)

    def action_open_source(self):
        self.ensure_one()
        if not self.source_model or not self.source_record_id:
            raise UserError(_('No source record is linked to this ledger line.'))
        record = self.env[self.source_model].browse(self.source_record_id).exists()
        if not record:
            raise UserError(_('The linked source record no longer exists.'))
        return {
            'name': _('Source: %s') % (self.reference or self.entry_type or self.source_model),
            'type': 'ir.actions.act_window',
            'res_model': self.source_model,
            'res_id': record.id,
            'view_mode': 'form',
            'target': 'current',
        }


class BizUnifiedLedgerSummary(models.Model):
    _name = 'biz.unified.ledger.summary'
    _description = 'Biz Unified Ledger Summary'
    _auto = False
    _order = 'party_type, party_name'

    party_type = fields.Selection([
        ('partner', 'Partner'),
        ('vendor', 'Vendor'),
        ('associate', 'Associate'),
        ('agent', 'Agent'),
    ], string='Party Type', readonly=True)
    party_id = fields.Integer(string='Party ID', readonly=True)
    party_name = fields.Char(string='Party', readonly=True)
    debit = fields.Float(string='Debit', readonly=True)
    credit = fields.Float(string='Credit', readonly=True)
    balance = fields.Float(string='Balance', readonly=True)

    def init(self):
        self.env['biz.unified.ledger.line'].init()
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    ROW_NUMBER() OVER (ORDER BY party_type, party_name)::integer AS id,
                    party_type,
                    party_id,
                    party_name,
                    SUM(debit) AS debit,
                    SUM(credit) AS credit,
                    SUM(balance) AS balance
                FROM biz_unified_ledger_line
                GROUP BY party_type, party_id, party_name
            )
        """ % self._table)

    def action_view_ledger(self):
        self.ensure_one()
        if self.party_type == 'partner':
            return {
                'name': _('Partner Ledger: %(party)s | Balance: %(balance)s',
                          party=self.party_name,
                          balance=_format_current_balance(self.env, self.balance)),
                'type': 'ir.actions.act_window',
                'res_model': 'biz.ledger',
                'view_mode': 'list,pivot',
                'domain': [('partner_id', '=', self.party_id)],
                'context': {'default_partner_id': self.party_id},
            }
        if self.party_type == 'vendor':
            return {
                'name': _('Vendor Ledger: %(party)s | Balance: %(balance)s',
                          party=self.party_name,
                          balance=_format_current_balance(self.env, self.balance)),
                'type': 'ir.actions.act_window',
                'res_model': 'biz.bill.payment.transaction',
                'view_mode': 'list',
                'domain': [('vendor_id', '=', self.party_id)],
                'context': {'default_vendor_id': self.party_id},
            }
        if self.party_type == 'associate':
            return {
                'name': _('Associate Ledger: %(party)s | Balance: %(balance)s',
                          party=self.party_name,
                          balance=_format_current_balance(self.env, self.balance)),
                'type': 'ir.actions.act_window',
                'res_model': 'biz.associate.ledger',
                'view_mode': 'list,form',
                'domain': [('associate_id', '=', self.party_id)],
                'context': {'default_associate_id': self.party_id},
            }
        if self.party_type == 'agent':
            return {
                'name': _('Agent Ledger: %(party)s | Balance: %(balance)s',
                          party=self.party_name,
                          balance=_format_current_balance(self.env, self.balance)),
                'type': 'ir.actions.act_window',
                'res_model': 'biz.agent.ledger',
                'view_mode': 'list,form',
                'domain': [('agent_id', '=', self.party_id)],
                'context': {'default_agent_id': self.party_id},
            }
        raise UserError(_('No detailed ledger is available for this party.'))
