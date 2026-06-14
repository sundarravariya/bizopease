# -*- coding: utf-8 -*-
import calendar
from datetime import date, timedelta

from odoo import models, fields, api


class RobifelSalaryPeriod(models.Model):
    _name = 'robifel.salary.period'
    _description = 'Robifel Monthly Salary'
    _order = 'period_start desc, employee_id'
    _rec_name = 'employee_id'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True, index=True, ondelete='cascade')
    period_start = fields.Date(string='Month', required=True, index=True,
                               help='First day of the salary month.')

    # Snapshot of config at compute time.
    monthly_wage = fields.Float(string='Monthly Wage')
    per_day_rate = fields.Float(string='Per-day Rate')
    days_in_month = fields.Integer(string='Days in Month')

    # Computed day tallies.
    present_days = fields.Float(string='Present')
    half_days = fields.Integer(string='Half Days')
    paid_leave_days = fields.Integer(string='Paid Leave')
    week_off_days = fields.Integer(string='Weekly Offs')
    holiday_days = fields.Integer(string='Holidays')
    absent_days = fields.Integer(string='Absent')
    forfeited_offs = fields.Integer(string='Forfeited Offs (sandwich)')
    payable_days = fields.Float(string='Payable Days')

    ot_hours = fields.Float(string='Overtime Hours')
    ot_amount = fields.Float(string='Overtime Pay')

    # Manual adjustments (admin editable).
    advance_deduction = fields.Float(string='Advances / Loans', default=0.0)
    fine_deduction = fields.Float(string='Fines', default=0.0)
    bonus_addition = fields.Float(string='Bonus', default=0.0)

    gross_pay = fields.Float(string='Gross Pay')
    net_pay = fields.Float(string='Net Payable')

    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('paid', 'Paid'),
    ], string='Status', default='draft', index=True)
    paid_on = fields.Date(string='Paid On')
    note = fields.Char(string='Note')

    _sql_constraints = [
        ('employee_period_uniq', 'unique(employee_id, period_start)',
         'A salary record already exists for this employee and month.'),
    ]

    # ── Salary engine ────────────────────────────────────────────────
    def _status_map(self, weekly_off_wd, first_day, last_day):
        """Return {date: status} for the month, filling unmarked days.

        Unmarked weekly-off weekday -> 'week_off'; any other unmarked day -> 'absent'.
        """
        self.ensure_one()
        recs = self.env['robifel.attendance.day'].search([
            ('employee_id', '=', self.employee_id.id),
            ('date', '>=', first_day), ('date', '<=', last_day),
        ])
        marked = {r.date: r for r in recs}
        out = {}
        d = first_day
        while d <= last_day:
            rec = marked.get(d)
            if rec:
                out[d] = rec.status
            else:
                out[d] = 'week_off' if d.weekday() == weekly_off_wd else 'absent'
            d += timedelta(days=1)
        return out, recs

    def compute_salary(self):
        """Recompute all tallies and pay for each period. Callable from RPC."""
        for period in self:
            cfg = self.env['robifel.salary.config'].search(
                [('employee_id', '=', period.employee_id.id)], limit=1)
            first_day = period.period_start.replace(day=1)
            dim = calendar.monthrange(first_day.year, first_day.month)[1]
            last_day = first_day.replace(day=dim)
            weekly_off_wd = int(cfg.weekly_off) if cfg else 6
            sandwich = cfg.sandwich_rule if cfg else True

            status, recs = period._status_map(weekly_off_wd, first_day, last_day)

            present = half = paid_leave = week_off = holiday = absent = 0
            for st in status.values():
                if st == 'present':
                    present += 1
                elif st == 'half':
                    half += 1
                elif st == 'paid_leave':
                    paid_leave += 1
                elif st == 'week_off':
                    week_off += 1
                elif st == 'holiday':
                    holiday += 1
                elif st == 'absent':
                    absent += 1

            # Sandwich rule: a weekly-off bordered by an absence is forfeited.
            forfeited = 0
            if sandwich:
                for d, st in status.items():
                    if st != 'week_off':
                        continue
                    prev_st = status.get(d - timedelta(days=1))
                    next_st = status.get(d + timedelta(days=1))
                    if prev_st == 'absent' or next_st == 'absent':
                        forfeited += 1

            payable = (present + 0.5 * half + paid_leave + holiday
                       + (week_off - forfeited))

            per_day = cfg.per_day_rate(dim) if cfg else 0.0
            ot_hours = sum(recs.mapped('ot_hours'))
            ot_rate = cfg.ot_hourly_rate if cfg else 0.0
            ot_amount = ot_hours * ot_rate
            gross = payable * per_day
            net = (gross + ot_amount + period.bonus_addition
                   - period.advance_deduction - period.fine_deduction)

            period.write({
                'monthly_wage': cfg.monthly_wage if cfg else 0.0,
                'per_day_rate': per_day,
                'days_in_month': dim,
                'present_days': present,
                'half_days': half,
                'paid_leave_days': paid_leave,
                'week_off_days': week_off,
                'holiday_days': holiday,
                'absent_days': absent,
                'forfeited_offs': forfeited,
                'payable_days': payable,
                'ot_hours': ot_hours,
                'ot_amount': ot_amount,
                'gross_pay': gross,
                'net_pay': net,
            })
        return True

    @api.model
    def get_or_create_period(self, employee_id, period_start):
        """Fetch (creating if needed) a month's salary record and compute it."""
        if isinstance(period_start, str):
            period_start = fields.Date.to_date(period_start)
        period_start = period_start.replace(day=1)
        rec = self.search([('employee_id', '=', employee_id),
                           ('period_start', '=', period_start)], limit=1)
        if not rec:
            rec = self.create({'employee_id': employee_id, 'period_start': period_start})
        rec.compute_salary()
        return rec.id

    def action_mark_paid(self):
        self.write({'state': 'paid', 'paid_on': fields.Date.context_today(self)})
        return True
