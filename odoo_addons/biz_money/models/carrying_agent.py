# -*- coding: utf-8 -*-
# Generic (non-Flipkart) carrying / transport agent ledger. Mirrors the
# Business OS agent ledger without any Flipkart purchase-settlement coupling:
# balances are driven purely by manual bill / payment / adjustment entries.
from odoo import models, fields, api, _, tools
from .ledger_statement_mixin import LedgerStatementMixin


def _format_current_balance(env, balance):
    currency = env.company.currency_id
    symbol = currency.symbol or currency.name or ''
    amount_text = f"{abs(balance):,.2f}"
    prefix = '-' if balance < 0 else ''
    return f"{prefix}{symbol} {amount_text}".strip()


class BizCarryingAgent(models.Model):
    _name = 'biz.carrying.agent'
    _description = 'Carrying Agent'
    _inherit = ['mail.thread']
    _order = 'name asc'

    name = fields.Char(string='Agent Name', required=True)
    contact_details = fields.Text(string='Contact Details')

    outstanding_balance = fields.Float(
        string='Outstanding Balance',
        compute='_compute_balance',
        inverse='_inverse_outstanding_balance',
        store=True,
        tracking=True,
    )

    ledger_ids = fields.One2many('biz.agent.ledger', 'agent_id', string='Ledger Entries')

    @api.depends('ledger_ids', 'ledger_ids.amount_inr', 'ledger_ids.entry_type')
    def _compute_balance(self):
        for agent in self:
            balance = 0.0
            for entry in agent.ledger_ids:
                if entry.entry_type == 'bill':
                    balance += entry.amount_inr
                elif entry.entry_type == 'payment':
                    balance -= entry.amount_inr
                elif entry.entry_type == 'adjustment':
                    balance += entry.amount_inr
            agent.outstanding_balance = balance

    def _inverse_outstanding_balance(self):
        for agent in self:
            current_balance = 0.0
            for entry in agent.ledger_ids:
                if entry.entry_type == 'bill':
                    current_balance += entry.amount_inr
                elif entry.entry_type == 'payment':
                    current_balance -= entry.amount_inr
                elif entry.entry_type == 'adjustment':
                    current_balance += entry.amount_inr

            delta = agent.outstanding_balance - current_balance
            if abs(delta) < 0.01:
                continue

            self.env['biz.agent.ledger'].create({
                'agent_id': agent.id,
                'date': fields.Date.context_today(agent),
                'entry_type': 'adjustment',
                'amount_inr': delta,
                'reference': _('Manual Balance Adjustment'),
                'notes': _('Adjusted outstanding balance from %(old).2f to %(new).2f') % {
                    'old': current_balance,
                    'new': agent.outstanding_balance,
                },
            })

    def action_view_ledger(self):
        self.ensure_one()
        return {
            'name': _('Agent Ledger'),
            'type': 'ir.actions.act_window',
            'res_model': 'biz.agent.ledger',
            'view_mode': 'list,form',
            'domain': [('agent_id', '=', self.id)],
            'context': {'default_agent_id': self.id},
        }


class BizAgentLedger(models.Model, LedgerStatementMixin):
    _name = 'biz.agent.ledger'
    _description = 'Carrying Agent Ledger'
    _order = 'date desc, id desc'

    agent_id = fields.Many2one(
        'biz.carrying.agent', string='Carrying Agent', required=True, ondelete='cascade')
    date = fields.Date(string='Date', required=True, default=fields.Date.context_today)

    entry_type = fields.Selection([
        ('bill', 'Bill (+)'),
        ('payment', 'Payment (-)'),
        ('adjustment', 'Manual Adjustment (+/-)'),
    ], string='Entry Type', required=True, default='payment')

    amount_inr = fields.Float(string='Amount', required=True)
    debit = fields.Float(string='Debit', compute='_compute_debit_credit', store=False)
    credit = fields.Float(string='Credit', compute='_compute_debit_credit', store=False)
    balance = fields.Float(string='Balance', compute='_compute_debit_credit', store=False)

    reference = fields.Char(string='Reference')
    notes = fields.Text(string='Notes')
    filter_date_from = fields.Date(string='From', store=False)
    filter_date_to = fields.Date(string='To', store=False)

    def _compute_debit_credit(self):
        for line in self:
            if line.entry_type == 'payment':
                line.debit = 0.0
                line.credit = line.amount_inr
            else:
                line.debit = line.amount_inr
                line.credit = 0.0
            line.balance = line.debit - line.credit

    def _statement_row_labels(self, label):
        return {
            'reference': label,
            'notes': 'Carry-forward balance' if label == 'Opening Balance' else 'Balance after selected range',
        }

    @api.model
    @api.readonly
    def web_search_read(self, domain, specification, offset=0, limit=None, order=None, count_limit=None):
        result = super().web_search_read(domain, specification, offset=offset, limit=limit, order=order, count_limit=count_limit)
        return self._append_statement_rows(domain, specification, result, offset)


class BizAgentLedgerSummary(models.Model):
    _name = 'biz.agent.ledger.summary'
    _description = 'Carrying Agent Ledger Summary'
    _auto = False
    _order = 'agent_id'

    agent_id = fields.Many2one('biz.carrying.agent', string='Carrying Agent', readonly=True)
    debit = fields.Float(string='Total Debit', readonly=True)
    credit = fields.Float(string='Total Credit', readonly=True)
    balance = fields.Float(string='Net Balance', readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    agent_id as id,
                    agent_id as agent_id,
                    SUM(CASE WHEN entry_type = 'payment' THEN 0 ELSE amount_inr END) as debit,
                    SUM(CASE WHEN entry_type = 'payment' THEN amount_inr ELSE 0 END) as credit,
                    SUM(CASE WHEN entry_type = 'payment' THEN -amount_inr ELSE amount_inr END) as balance
                FROM biz_agent_ledger
                WHERE agent_id IS NOT NULL
                GROUP BY agent_id
            )
        """ % self._table)

    def action_open_ledger_details(self):
        self.ensure_one()
        return {
            'name': _('Agent Ledger: %(party)s | Current Balance: %(balance)s', party=self.agent_id.name, balance=_format_current_balance(self.env, self.balance)),
            'type': 'ir.actions.act_window',
            'res_model': 'biz.agent.ledger',
            'view_mode': 'list,form',
            'domain': [('agent_id', '=', self.agent_id.id)],
            'context': {'default_agent_id': self.agent_id.id},
        }
