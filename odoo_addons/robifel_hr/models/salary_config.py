# -*- coding: utf-8 -*-
from odoo import models, fields, api


class RobifelSalaryConfig(models.Model):
    _name = 'robifel.salary.config'
    _description = 'Robifel Employee Salary Config'
    _rec_name = 'employee_id'
    _order = 'employee_id'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True, index=True, ondelete='cascade')
    user_id = fields.Many2one(
        'res.users', string='Login User', related='employee_id.user_id',
        store=True, readonly=True,
        help='The portal/app login linked to this employee (used to attribute self check-ins and live location).')

    monthly_wage = fields.Float(string='Monthly Wage', default=0.0)

    # How the per-day rate is derived from the monthly wage.
    per_day_basis = fields.Selection([
        ('30', 'Monthly ÷ 30 (fixed)'),
        ('actual', 'Monthly ÷ days in month'),
        ('26', 'Monthly ÷ 26 (excl. weekly-offs)'),
    ], string='Per-day Basis', default='30', required=True)

    # 0=Mon … 6=Sun (matches Python date.weekday()).
    weekly_off = fields.Selection([
        ('0', 'Monday'), ('1', 'Tuesday'), ('2', 'Wednesday'),
        ('3', 'Thursday'), ('4', 'Friday'), ('5', 'Saturday'), ('6', 'Sunday'),
    ], string='Weekly Off', default='6', required=True)

    # When True, an absence on the day immediately before/after the weekly-off
    # forfeits the (otherwise paid) weekly-off too — the "sandwich" rule.
    sandwich_rule = fields.Boolean(string='Sandwich Rule', default=True)

    ot_hourly_rate = fields.Float(string='Overtime Hourly Rate', default=0.0)
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ('employee_uniq', 'unique(employee_id)',
         'A salary config already exists for this employee.'),
    ]

    def per_day_rate(self, days_in_month):
        """Per-day wage for a given month length, per the configured basis."""
        self.ensure_one()
        if self.per_day_basis == '30':
            divisor = 30.0
        elif self.per_day_basis == '26':
            divisor = 26.0
        else:
            divisor = float(days_in_month or 30)
        return (self.monthly_wage or 0.0) / divisor if divisor else 0.0
