# -*- coding: utf-8 -*-
from odoo import models, fields


class BizExpense(models.Model):
    _name = 'biz.expense'
    _description = 'Business Expense'
    _order = 'date desc, id desc'

    date        = fields.Date(required=True, default=fields.Date.today)
    amount      = fields.Float(required=True, digits=(12, 2))
    category    = fields.Selection([
        ('salary',      'Salary'),
        ('rent',        'Rent'),
        ('food',        'Food'),
        ('travel',      'Travel'),
        ('electricity', 'Electricity Bill'),
        ('development', 'Development'),
        ('withdrawal',  'Withdrawal'),
        ('other',       'Other'),
    ], required=True, default='other')
    description = fields.Char(required=True)
    paid_by_id  = fields.Many2one('biz.money.associate', string='Paid By')
    owner_id    = fields.Many2one('biz.owner', string='Owner / Recipient')
    employee_id = fields.Many2one('hr.employee', string='Employee (Salary)')
    note        = fields.Text()
