# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError, AccessError


class RobifelAttendanceDay(models.Model):
    _name = 'robifel.attendance.day'
    _description = 'Robifel Daily Attendance'
    _order = 'date desc, employee_id'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True, index=True, ondelete='cascade')
    date = fields.Date(string='Date', required=True, index=True,
                       default=fields.Date.context_today)

    status = fields.Selection([
        ('present', 'Present'),
        ('half', 'Half Day'),
        ('absent', 'Absent'),
        ('paid_leave', 'Paid Leave'),
        ('week_off', 'Weekly Off'),
        ('holiday', 'Holiday'),
    ], string='Status', default='present', required=True, index=True)

    ot_hours = fields.Float(string='Overtime Hours', default=0.0)

    # Audit / source of the record.
    method = fields.Selection([
        ('self', 'Self (employee app)'),
        ('admin', 'Admin marked'),
        ('auto', 'Auto / system'),
    ], string='Source', default='admin')
    is_manual = fields.Boolean(string='Manually Edited', default=False,
                               help='Set when an admin overrides the punched/auto value.')
    marked_by_uid = fields.Many2one('res.users', string='Marked By', readonly=True)

    # Punch timestamps (optional — present when actually punched).
    check_in = fields.Datetime(string='Check In')
    check_out = fields.Datetime(string='Check Out')

    # Geo + photo proof at punch.
    geo_lat_in = fields.Float(string='Check-in Lat', digits=(10, 7))
    geo_lng_in = fields.Float(string='Check-in Lng', digits=(10, 7))
    geo_lat_out = fields.Float(string='Check-out Lat', digits=(10, 7))
    geo_lng_out = fields.Float(string='Check-out Lng', digits=(10, 7))
    selfie_in = fields.Binary(string='Check-in Selfie', attachment=True)
    selfie_out = fields.Binary(string='Check-out Selfie', attachment=True)

    note = fields.Char(string='Note')

    _sql_constraints = [
        ('employee_date_uniq', 'unique(employee_id, date)',
         'This employee already has an attendance record for this date.'),
    ]

    @api.model
    def punch(self, employee_id, kind, lat=False, lng=False, selfie=False, when=False):
        """Create/update today's record from a check-in or check-out punch.

        kind: 'in' | 'out'. Returns the record id. Idempotent per (employee, date).
        Non-admins can only punch for their OWN employee, regardless of the
        employee_id passed in.
        """
        if not self.env.user.has_group('base.group_system'):
            emp = self.env['hr.employee'].search(
                [('user_id', '=', self.env.user.id)], limit=1)
            if not emp:
                raise UserError(_("No employee is linked to your account."))
            employee_id = emp.id
        if kind not in ('in', 'out', 'auto'):
            raise UserError(_("Invalid punch type."))
        day = fields.Date.context_today(self)
        rec = self.search([('employee_id', '=', employee_id), ('date', '=', day)], limit=1)
        # 'auto' = toggle: if already checked in today and not out yet -> out, else in.
        if kind == 'auto':
            kind = 'out' if (rec and rec.check_in and not rec.check_out) else 'in'
        ts = when or fields.Datetime.now()
        if kind == 'in':
            vals = {'status': 'present', 'check_in': ts, 'method': 'self',
                    'geo_lat_in': lat or 0.0, 'geo_lng_in': lng or 0.0}
            if selfie:
                vals['selfie_in'] = selfie
        else:
            vals = {'check_out': ts, 'geo_lat_out': lat or 0.0, 'geo_lng_out': lng or 0.0}
            if selfie:
                vals['selfie_out'] = selfie
        if rec:
            rec.write(vals)
        else:
            vals.update({'employee_id': employee_id, 'date': day})
            rec = self.create(vals)
        return rec.id

    @api.model
    def punch_by_badge(self, uid, kind, lat=False, lng=False):
        """Kiosk fallback: an ADMIN device scans an employee's personal NFC badge
        and marks that employee in/out (with the kiosk device's GPS). Returns a
        result dict for the kiosk UI."""
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("The kiosk requires an administrator account."))
        u = (uid or '').strip().upper()
        if not u:
            return {'ok': False, 'error': 'Empty tag.'}
        emp = self.env['hr.employee'].sudo().search(
            [('robifel_nfc_badge', '=', u)], limit=1)
        if not emp:
            return {'ok': False, 'error': 'This badge is not assigned to any employee.'}
        self.punch(emp.id, kind, lat, lng, False)
        return {'ok': True, 'employee_id': emp.id, 'employee_name': emp.name, 'kind': kind}
