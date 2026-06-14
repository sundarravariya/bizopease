# -*- coding: utf-8 -*-
from odoo import models, fields, api, _, tools
from odoo.exceptions import UserError
from .ledger_statement_mixin import LedgerStatementMixin


def _format_current_balance(env, balance):
    currency = env.company.currency_id
    symbol = currency.symbol or currency.name or ''
    amount_text = f"{abs(balance):,.2f}"
    prefix = '-' if balance < 0 else ''
    return f"{prefix}{symbol} {amount_text}".strip()


class FlipkartBillPaymentVendor(models.Model):
    _name = 'flipkart.bill.payment.vendor'
    _description = 'Bill/Payment Vendor'
    _order = 'name asc'

    name = fields.Char(string='Vendor Name', required=True)
    deduction_percent = fields.Float(string='Bill Percentage Deducted', default=0.0)
    phone = fields.Char(string='Phone')
    notes = fields.Text(string='Notes')
    transaction_ids = fields.One2many('flipkart.bill.payment.transaction', 'vendor_id', string='Transactions')
    ledger_ids = fields.One2many('flipkart.bill.vendor.ledger', 'vendor_id', string='Ledger')
    balance = fields.Float(string='Balance', compute='_compute_balance', store=False)

    @api.depends(
        'transaction_ids.transfer_amount',
        'transaction_ids.deduction_amount',
        'transaction_ids.payment_received',
        'transaction_ids.actual_cash_received',
        'transaction_ids.expected_cash_amount',
        'transaction_ids.agent_payment_source',
        'transaction_ids.agent_payment_amount',
    )
    def _compute_balance(self):
        for vendor in self:
            balance = 0.0
            for tx in vendor.transaction_ids:
                cash_received = tx.actual_cash_received if tx.payment_received else 0.0
                agent_paid = tx.agent_payment_amount if tx.agent_payment_source == 'vendor' else 0.0
                balance += tx.transfer_amount - tx.deduction_amount - cash_received - agent_paid
            vendor.balance = balance

    def action_view_transactions(self):
        self.ensure_one()
        return {
            'name': _('Bill/Payment Transactions'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.bill.payment.transaction',
            'view_mode': 'list,form',
            'domain': [('vendor_id', '=', self.id)],
            'context': {'default_vendor_id': self.id},
        }

    def action_view_ledger(self):
        self.ensure_one()
        return {
            'name': _('Vendor Ledger'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.bill.payment.transaction',
            'view_mode': 'list',
            'domain': [('vendor_id', '=', self.id)],
            'views': [(self.env.ref('flipkart_os.view_flipkart_bill_payment_vendor_ledger_transaction_list').id, 'list')],
            'context': {'default_vendor_id': self.id},
        }


class FlipkartMoneyAssociate(models.Model):
    _name = 'flipkart.money.associate'
    _description = 'Money Associate'
    _order = 'name asc'

    name = fields.Char(string='Associate Name', required=True)
    phone = fields.Char(string='Phone')
    notes = fields.Text(string='Notes')
    transaction_ids = fields.One2many('flipkart.bill.payment.transaction', 'received_by_id', string='Handled Transactions')
    ledger_ids = fields.One2many('flipkart.associate.ledger', 'associate_id', string='Ledger')
    balance = fields.Float(string='Balance', compute='_compute_balance', store=True)

    @api.depends('ledger_ids.amount', 'ledger_ids.entry_type')
    def _compute_balance(self):
        for associate in self:
            balance = 0.0
            for line in associate.ledger_ids:
                if line.entry_type in ('cash_received', 'transfer_in'):
                    balance += line.amount
                elif line.entry_type in ('agent_payment', 'expense', 'transfer_out'):
                    balance -= line.amount
            associate.balance = balance

    def action_view_ledger(self):
        self.ensure_one()
        return {
            'name': _('Associate Ledger'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.associate.ledger',
            'view_mode': 'list,form',
            'domain': [('associate_id', '=', self.id)],
            'context': {'default_associate_id': self.id},
        }


class FlipkartBillPaymentTransaction(models.Model, LedgerStatementMixin):
    _name = 'flipkart.bill.payment.transaction'
    _description = 'Bill/Payment Transaction'
    _order = 'date desc, id desc'

    name = fields.Char(string='Reference', default='New', copy=False)
    display_name = fields.Char(compute='_compute_display_name', recursive=True)
    date = fields.Date(string='Date', required=True, default=fields.Date.context_today)
    vendor_id = fields.Many2one('flipkart.bill.payment.vendor', string='Bill/Payment Vendor', required=True)
    transfer_amount = fields.Float(string='Bank Transfer Amount', required=True)
    deduction_percent = fields.Float(string='Deduction %')
    deduction_amount = fields.Float(string='Deducted Amount', compute='_compute_amounts', store=True)
    expected_cash_amount = fields.Float(string='Expected Cash', compute='_compute_amounts', store=True)
    vendor_settled_amount = fields.Float(string='Settled Amount', compute='_compute_vendor_amounts', store=False)
    vendor_balance_amount = fields.Float(string='Vendor Balance', compute='_compute_vendor_amounts', store=False)
    payment_received = fields.Boolean(string='Payment Received')
    received_by_id = fields.Many2one('flipkart.money.associate', string='Received By')
    received_date = fields.Date(string='Received Date')
    actual_cash_received = fields.Float(string='Actual Cash Received')
    agent_payment_amount = fields.Float(string='Paid to Carrying Agent')
    agent_payment_source = fields.Selection([
        ('none', 'No Agent Payment'),
        ('vendor', 'Bill/Payment Vendor Paid Agent'),
        ('associate', 'Associate Paid Agent'),
    ], string='Agent Payment Source', default='none', required=True)
    carrying_agent_id = fields.Many2one('flipkart.carrying.agent', string='Carrying Agent')
    note = fields.Text(string='Notes')
    filter_date_from = fields.Date(string='From', store=False)
    filter_date_to = fields.Date(string='To', store=False)
    state = fields.Selection([
        ('pending', 'Pending Cash'),
        ('received', 'Cash Received'),
        ('agent_paid', 'Agent Paid'),
    ], string='Status', compute='_compute_state', store=True)

    vendor_ledger_ids = fields.One2many('flipkart.bill.vendor.ledger', 'transaction_id', string='Vendor Ledger')
    associate_ledger_ids = fields.One2many('flipkart.associate.ledger', 'transaction_id', string='Associate Ledger')
    agent_ledger_id = fields.Many2one('flipkart.agent.ledger', string='Agent Ledger Entry', copy=False)
    ledger_count = fields.Integer(string='Ledger Entries', compute='_compute_ledger_count')

    @api.depends('name', 'vendor_id.name', 'transfer_amount')
    def _compute_display_name(self):
        for rec in self:
            if rec.transfer_amount:
                rec.display_name = '%s - %s - %.2f' % (
                    rec.name or _('New'),
                    rec.vendor_id.name or '',
                    rec.transfer_amount,
                )
            else:
                rec.display_name = rec.name or _('New')

    @api.onchange('vendor_id')
    def _onchange_vendor_id(self):
        if self.vendor_id:
            self.deduction_percent = self.vendor_id.deduction_percent

    @api.depends('transfer_amount', 'deduction_percent')
    def _compute_amounts(self):
        for rec in self:
            percent = min(max(rec.deduction_percent or 0.0, 0.0), 100.0)
            rec.deduction_amount = rec.transfer_amount * percent / 100.0
            rec.expected_cash_amount = rec.transfer_amount - rec.deduction_amount

    @api.depends('payment_received', 'agent_payment_amount')
    def _compute_state(self):
        for rec in self:
            if rec.agent_payment_amount:
                rec.state = 'agent_paid'
            elif rec.payment_received:
                rec.state = 'received'
            else:
                rec.state = 'pending'

    def _compute_ledger_count(self):
        for rec in self:
            rec.ledger_count = len(rec.vendor_ledger_ids) + len(rec.associate_ledger_ids) + (1 if rec.agent_ledger_id else 0)

    def _compute_vendor_amounts(self):
        for rec in self:
            cash_received = rec.actual_cash_received if rec.payment_received else 0.0
            agent_paid = rec.agent_payment_amount if rec.agent_payment_source == 'vendor' else 0.0
            rec.vendor_settled_amount = rec.deduction_amount + cash_received + agent_paid
            rec.vendor_balance_amount = rec.transfer_amount - rec.vendor_settled_amount

    def _statement_balance_field(self):
        return 'vendor_balance_amount'

    def _statement_row_labels(self, label):
        return {
            'name': label,
            'note': 'Carry-forward balance' if label == 'Opening Balance' else 'Balance after selected range',
        }

    @api.model
    @api.readonly
    def web_search_read(self, domain, specification, offset=0, limit=None, order=None, count_limit=None):
        result = super().web_search_read(domain, specification, offset=offset, limit=limit, order=order, count_limit=count_limit)
        return self._append_statement_rows(domain, specification, result, offset)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('flipkart.bill.payment.transaction') or 'New'
            if vals.get('vendor_id') and not vals.get('deduction_percent'):
                vendor = self.env['flipkart.bill.payment.vendor'].browse(vals['vendor_id'])
                vals['deduction_percent'] = vendor.deduction_percent
        records = super().create(vals_list)
        records._sync_ledgers()
        return records

    def write(self, vals):
        res = super().write(vals)
        if not self.env.context.get('skip_bill_payment_sync'):
            self._sync_ledgers()
        return res

    def unlink(self):
        self.mapped('vendor_ledger_ids').unlink()
        self.mapped('associate_ledger_ids').unlink()
        self.mapped('agent_ledger_id').unlink()
        return super().unlink()

    def action_mark_cash_received(self):
        today = fields.Date.context_today(self)
        for rec in self:
            rec.write({
                'payment_received': True,
                'received_date': rec.received_date or today,
                'actual_cash_received': rec.actual_cash_received or rec.expected_cash_amount,
            })
        return True

    def action_reset_cash_received(self):
        self.write({
            'payment_received': False,
            'received_date': False,
            'actual_cash_received': 0.0,
            'received_by_id': False,
        })
        return True

    def action_view_ledgers(self):
        self.ensure_one()
        return {
            'name': _('Transaction: %s') % self.name,
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.bill.payment.transaction',
            'view_mode': 'form',
            'res_id': self.id,
        }

    def _sync_ledgers(self):
        for rec in self:
            rec.vendor_ledger_ids.unlink()
            rec.associate_ledger_ids.unlink()
            if rec.agent_ledger_id:
                agent_ledger = rec.agent_ledger_id
                rec.with_context(skip_bill_payment_sync=True).agent_ledger_id = False
                agent_ledger.unlink()

            if rec.payment_received:
                received_amount = rec.actual_cash_received or rec.expected_cash_amount
                if rec.received_by_id:
                    self.env['flipkart.associate.ledger'].create({
                        'transaction_id': rec.id,
                        'associate_id': rec.received_by_id.id,
                        'date': rec.received_date or rec.date,
                        'entry_type': 'cash_received',
                        'amount': received_amount,
                        'reference': rec.name,
                        'note': _('Collected from %s') % rec.vendor_id.name,
                    })

            if rec.agent_payment_amount and rec.carrying_agent_id:
                source_name = rec.vendor_id.name
                if rec.agent_payment_source == 'associate' and rec.received_by_id:
                    source_name = rec.received_by_id.name
                    self.env['flipkart.associate.ledger'].create({
                        'transaction_id': rec.id,
                        'associate_id': rec.received_by_id.id,
                        'date': rec.date,
                        'entry_type': 'agent_payment',
                        'amount': rec.agent_payment_amount,
                        'reference': rec.name,
                        'note': _('Paid to carrying agent %s') % rec.carrying_agent_id.name,
                    })

                agent_ledger = self.env['flipkart.agent.ledger'].create({
                    'agent_id': rec.carrying_agent_id.id,
                    'date': rec.date,
                    'entry_type': 'payment',
                    'amount_inr': rec.agent_payment_amount,
                    'reference': rec.name,
                    'notes': _('Direct payment by %s') % source_name,
                })
                rec.with_context(skip_bill_payment_sync=True).agent_ledger_id = agent_ledger.id


class FlipkartBillVendorLedger(models.Model):
    _name = 'flipkart.bill.vendor.ledger'
    _description = 'Bill/Payment Vendor Ledger'
    _order = 'date desc, id desc'

    transaction_id = fields.Many2one('flipkart.bill.payment.transaction', string='Transaction', ondelete='cascade')
    vendor_id = fields.Many2one('flipkart.bill.payment.vendor', string='Vendor', required=True, ondelete='cascade')
    date = fields.Date(string='Date', required=True)
    entry_type = fields.Selection([
        ('bank_transfer', 'Bank Transfer'),
        ('deduction', 'Deduction'),
        ('cash_received', 'Cash Received'),
        ('agent_payment', 'Agent Payment'),
    ], string='Type', required=True)
    amount = fields.Float(string='Amount', required=True)
    debit = fields.Float(string='Debit', compute='_compute_debit_credit', store=False)
    credit = fields.Float(string='Credit', compute='_compute_debit_credit', store=False)
    balance = fields.Float(string='Balance', compute='_compute_debit_credit', store=False)
    reference = fields.Char(string='Reference')
    note = fields.Text(string='Notes')
    filter_date_from = fields.Date(string='From', store=False)
    filter_date_to = fields.Date(string='To', store=False)

    def _compute_debit_credit(self):
        for line in self:
            if line.entry_type in ('deduction', 'cash_received', 'agent_payment'):
                line.debit = 0.0
                line.credit = line.amount
            else:
                line.debit = line.amount
                line.credit = 0.0
            line.balance = line.debit - line.credit


class FlipkartAssociateLedger(models.Model, LedgerStatementMixin):
    _name = 'flipkart.associate.ledger'
    _description = 'Money Associate Ledger'
    _order = 'date desc, id desc'

    transaction_id = fields.Many2one('flipkart.bill.payment.transaction', string='Transaction', ondelete='cascade')
    associate_id = fields.Many2one('flipkart.money.associate', string='Associate', required=True, ondelete='cascade')
    date = fields.Date(string='Date', required=True)
    entry_type = fields.Selection([
        ('cash_received', 'Cash Received'),
        ('agent_payment', 'Agent Payment'),
        ('expense', 'Expenses'),
        ('transfer_in', 'Transfer In'),
        ('transfer_out', 'Transfer Out'),
    ], string='Type', required=True)
    amount = fields.Float(string='Amount', required=True)
    debit = fields.Float(string='Debit', compute='_compute_debit_credit', store=False)
    credit = fields.Float(string='Credit', compute='_compute_debit_credit', store=False)
    balance = fields.Float(string='Balance', compute='_compute_debit_credit', store=False)
    reference = fields.Char(string='Reference')
    note = fields.Text(string='Notes')
    filter_date_from = fields.Date(string='From', store=False)
    filter_date_to = fields.Date(string='To', store=False)

    def _compute_debit_credit(self):
        for line in self:
            if line.entry_type in ('cash_received', 'transfer_in'):
                line.debit = line.amount
                line.credit = 0.0
            else:
                line.debit = 0.0
                line.credit = line.amount
            line.balance = line.debit - line.credit

    def _statement_row_labels(self, label):
        return {
            'reference': label,
            'note': 'Carry-forward balance' if label == 'Opening Balance' else 'Balance after selected range',
        }

    @api.model
    @api.readonly
    def web_search_read(self, domain, specification, offset=0, limit=None, order=None, count_limit=None):
        result = super().web_search_read(domain, specification, offset=offset, limit=limit, order=order, count_limit=count_limit)
        return self._append_statement_rows(domain, specification, result, offset)


class FlipkartBillVendorLedgerSummary(models.Model):
    _name = 'flipkart.bill.vendor.ledger.summary'
    _description = 'Bill/Payment Vendor Ledger Summary'
    _auto = False
    _order = 'vendor_id'

    vendor_id = fields.Many2one('flipkart.bill.payment.vendor', string='Vendor', readonly=True)
    debit = fields.Float(string='Total Debit', readonly=True)
    credit = fields.Float(string='Total Credit', readonly=True)
    balance = fields.Float(string='Net Balance', readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    vendor_id as id,
                    vendor_id as vendor_id,
                    SUM(debit) as debit,
                    SUM(credit) as credit,
                    SUM(debit - credit) as balance
                FROM (
                    SELECT
                        vendor_id,
                        transfer_amount as debit,
                        deduction_amount
                            + CASE WHEN payment_received THEN COALESCE(NULLIF(actual_cash_received, 0), expected_cash_amount) ELSE 0 END
                            + CASE WHEN agent_payment_source = 'vendor' THEN agent_payment_amount ELSE 0 END as credit
                    FROM flipkart_bill_payment_transaction
                ) tx
                WHERE vendor_id IS NOT NULL
                GROUP BY vendor_id
            )
        """ % self._table)

    def action_open_ledger_details(self):
        self.ensure_one()
        return {
            'name': _('Vendor Ledger: %(party)s | Current Balance: %(balance)s', party=self.vendor_id.name, balance=_format_current_balance(self.env, self.balance)),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.bill.payment.transaction',
            'view_mode': 'list',
            'domain': [('vendor_id', '=', self.vendor_id.id)],
            'views': [(self.env.ref('flipkart_os.view_flipkart_bill_payment_vendor_ledger_transaction_list').id, 'list')],
            'context': {'default_vendor_id': self.vendor_id.id},
        }


class FlipkartAssociateLedgerSummary(models.Model):
    _name = 'flipkart.associate.ledger.summary'
    _description = 'Money Associate Ledger Summary'
    _auto = False
    _order = 'associate_id'

    associate_id = fields.Many2one('flipkart.money.associate', string='Associate', readonly=True)
    debit = fields.Float(string='Total Debit', readonly=True)
    credit = fields.Float(string='Total Credit', readonly=True)
    balance = fields.Float(string='Net Balance', readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    associate_id as id,
                    associate_id as associate_id,
                    SUM(CASE WHEN entry_type IN ('cash_received', 'transfer_in') THEN amount ELSE 0 END) as debit,
                    SUM(CASE WHEN entry_type IN ('agent_payment', 'expense', 'transfer_out') THEN amount ELSE 0 END) as credit,
                    SUM(CASE WHEN entry_type IN ('cash_received', 'transfer_in') THEN amount ELSE -amount END) as balance
                FROM flipkart_associate_ledger
                WHERE associate_id IS NOT NULL
                GROUP BY associate_id
            )
        """ % self._table)

    def action_open_ledger_details(self):
        self.ensure_one()
        return {
            'name': _('Associate Ledger: %(party)s | Current Balance: %(balance)s', party=self.associate_id.name, balance=_format_current_balance(self.env, self.balance)),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.associate.ledger',
            'view_mode': 'list',
            'domain': [('associate_id', '=', self.associate_id.id)],
            'context': {'default_associate_id': self.associate_id.id},
        }


class FlipkartBillPaymentEntryWizard(models.TransientModel):
    _name = 'flipkart.bill.payment.entry.wizard'
    _description = 'Create Bill/Payment Entry'

    entry_type = fields.Selection([
        ('bank_transfer', 'Bank Transfer'),
        ('receive_payment', 'Receive Cash'),
        ('agent_payment', 'Carrying Agent Payment'),
        ('expense', 'Expenses'),
        ('associate_transfer', 'Associate to Associate Transfer'),
    ], string='Entry Type', required=True, default='bank_transfer')
    transaction_id = fields.Many2one(
        'flipkart.bill.payment.transaction',
        string='Bank Transfer',
        domain="[('vendor_id', '=', vendor_id), ('payment_received', '=', False)]",
    )
    date = fields.Date(string='Date', required=True, default=fields.Date.context_today)
    vendor_id = fields.Many2one('flipkart.bill.payment.vendor', string='Bill/Payment Vendor')
    transfer_amount = fields.Float(string='Bank Transfer Amount')
    deduction_percent = fields.Float(string='Deduction %')
    expected_cash_amount = fields.Float(string='Expected Cash', compute='_compute_expected_cash')
    received_by_id = fields.Many2one('flipkart.money.associate', string='Received By')
    to_associate_id = fields.Many2one('flipkart.money.associate', string='Transfer To')
    actual_cash_received = fields.Float(string='Cash Received')
    agent_payment_source = fields.Selection([
        ('vendor', 'Bill/Payment Vendor Paid Agent'),
        ('associate', 'Associate Paid Agent'),
    ], string='Paid By', default='vendor')
    carrying_agent_id = fields.Many2one('flipkart.carrying.agent', string='Carrying Agent')
    agent_payment_amount = fields.Float(string='Amount Paid to Agent')
    note = fields.Text(string='Notes')

    @api.onchange('vendor_id')
    def _onchange_vendor_id(self):
        if self.vendor_id and self.entry_type == 'bank_transfer':
            self.deduction_percent = self.vendor_id.deduction_percent

    @api.onchange('transaction_id')
    def _onchange_transaction_id(self):
        tx = self.transaction_id
        if not tx:
            return
        self.vendor_id = tx.vendor_id
        self.deduction_percent = tx.deduction_percent
        if self.entry_type == 'receive_payment':
            self.actual_cash_received = tx.actual_cash_received or tx.expected_cash_amount
            self.received_by_id = tx.received_by_id
            self.date = tx.received_date or fields.Date.context_today(self)
        elif self.entry_type == 'agent_payment':
            self.agent_payment_source = tx.agent_payment_source if tx.agent_payment_source != 'none' else 'vendor'
            self.carrying_agent_id = tx.carrying_agent_id
            self.agent_payment_amount = tx.agent_payment_amount

    @api.onchange('entry_type')
    def _onchange_entry_type(self):
        self.transaction_id = False
        if self.entry_type in ('receive_payment', 'agent_payment', 'expense', 'associate_transfer'):
            self.transfer_amount = 0.0

    @api.depends('transfer_amount', 'deduction_percent')
    def _compute_expected_cash(self):
        for wizard in self:
            percent = min(max(wizard.deduction_percent or 0.0, 0.0), 100.0)
            wizard.expected_cash_amount = wizard.transfer_amount - (wizard.transfer_amount * percent / 100.0)

    def action_apply(self):
        self.ensure_one()
        Transaction = self.env['flipkart.bill.payment.transaction']

        if self.entry_type == 'bank_transfer':
            tx = Transaction.create({
                'date': self.date,
                'vendor_id': self.vendor_id.id,
                'transfer_amount': self.transfer_amount,
                'deduction_percent': self.deduction_percent,
                'note': self.note,
            })
        elif self.entry_type == 'expense':
            return self._create_expense()
        elif self.entry_type == 'associate_transfer':
            return self._create_associate_transfer()
        else:
            tx = self.transaction_id
            if self.entry_type == 'agent_payment' and self.agent_payment_source == 'associate' and not tx and not self.vendor_id:
                return self._create_standalone_associate_agent_payment()
            if not tx:
                domain = [('vendor_id', '=', self.vendor_id.id), ('payment_received', '=', False)]
                if self.entry_type == 'agent_payment':
                    domain = [('vendor_id', '=', self.vendor_id.id)]
                tx = Transaction.search(domain, order='date asc, id asc', limit=1)
            if not tx:
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('No Bank Transfer Found'),
                        'message': _('No matching bank transfer was found for this vendor.'),
                        'type': 'warning',
                        'sticky': False,
                    }
                }
            vals = {'note': self.note or tx.note}
            if self.entry_type == 'receive_payment':
                vals.update({
                    'payment_received': True,
                    'received_date': self.date,
                    'received_by_id': self.received_by_id.id,
                    'actual_cash_received': self.actual_cash_received or tx.expected_cash_amount,
                })
            else:
                if self.agent_payment_source == 'associate' and not self.received_by_id:
                    raise UserError(_('Please select the associate who paid the carrying agent.'))
                vals.update({
                    'agent_payment_source': self.agent_payment_source,
                    'carrying_agent_id': self.carrying_agent_id.id,
                    'agent_payment_amount': self.agent_payment_amount,
                    'received_by_id': self.received_by_id.id if self.agent_payment_source == 'associate' else tx.received_by_id.id,
                })
            tx.write(vals)

        return {
            'name': _('Bill/Payment Transaction'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.bill.payment.transaction',
            'res_id': tx.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def _create_expense(self):
        self.ensure_one()
        if not self.received_by_id:
            raise UserError(_('Please select the associate for this expense.'))
        if not self.actual_cash_received:
            raise UserError(_('Please enter the expense amount.'))

        expense_line = self.env['flipkart.associate.ledger'].create({
            'associate_id': self.received_by_id.id,
            'date': self.date,
            'entry_type': 'expense',
            'amount': self.actual_cash_received,
            'reference': _('Expense'),
            'note': self.note or _('Expense'),
        })
        return {
            'name': _('Associate Ledger'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.associate.ledger',
            'res_id': expense_line.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def _create_associate_transfer(self):
        self.ensure_one()
        if not self.received_by_id or not self.to_associate_id:
            raise UserError(_('Please select both associates.'))
        if self.received_by_id == self.to_associate_id:
            raise UserError(_('From and To associates must be different.'))
        if not self.actual_cash_received:
            raise UserError(_('Please enter the transfer amount.'))

        reference = _('Associate Transfer')
        self.env['flipkart.associate.ledger'].create({
            'associate_id': self.received_by_id.id,
            'date': self.date,
            'entry_type': 'transfer_out',
            'amount': self.actual_cash_received,
            'reference': reference,
            'note': _('Transferred to %s') % self.to_associate_id.name,
        })
        in_line = self.env['flipkart.associate.ledger'].create({
            'associate_id': self.to_associate_id.id,
            'date': self.date,
            'entry_type': 'transfer_in',
            'amount': self.actual_cash_received,
            'reference': reference,
            'note': _('Received from %s') % self.received_by_id.name,
        })
        return {
            'name': _('Associate Ledger'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.associate.ledger',
            'res_id': in_line.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def _create_standalone_associate_agent_payment(self):
        self.ensure_one()
        if not self.received_by_id:
            raise UserError(_('Please select the associate who paid the carrying agent.'))
        if not self.carrying_agent_id or not self.agent_payment_amount:
            raise UserError(_('Please select the carrying agent and payment amount.'))

        self.env['flipkart.associate.ledger'].create({
            'associate_id': self.received_by_id.id,
            'date': self.date,
            'entry_type': 'agent_payment',
            'amount': self.agent_payment_amount,
            'reference': _('Direct Agent Payment'),
            'note': _('Paid to carrying agent %s') % self.carrying_agent_id.name,
        })
        agent_ledger = self.env['flipkart.agent.ledger'].create({
            'agent_id': self.carrying_agent_id.id,
            'date': self.date,
            'entry_type': 'payment',
            'amount_inr': self.agent_payment_amount,
            'reference': _('Direct Agent Payment'),
            'notes': _('Direct payment by %s') % self.received_by_id.name,
        })
        return {
            'name': _('Agent Ledger'),
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.agent.ledger',
            'res_id': agent_ledger.id,
            'view_mode': 'form',
            'target': 'current',
        }
