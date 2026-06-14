# -*- coding: utf-8 -*-
from odoo import models, fields, api


class RobifelEmployeeLocation(models.Model):
    _name = 'robifel.employee.location'
    _description = 'Robifel Employee Live Location Ping'
    _order = 'create_date desc'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True, index=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', string='User', index=True)
    lat = fields.Float(string='Latitude', digits=(10, 7))
    lng = fields.Float(string='Longitude', digits=(10, 7))
    accuracy = fields.Float(string='Accuracy (m)')
    battery = fields.Integer(string='Battery %')
    is_moving = fields.Boolean(string='Moving')
    logged_at = fields.Datetime(string='Logged At', default=fields.Datetime.now, index=True)

    @api.model
    def ping(self, employee_id, lat, lng, accuracy=False, battery=False, is_moving=False):
        """Record a live-location ping. Non-admins always log against their OWN
        employee, regardless of the employee_id passed in."""
        if not self.env.user.has_group('base.group_system'):
            emp = self.env['hr.employee'].search(
                [('user_id', '=', self.env.user.id)], limit=1)
            if not emp:
                return False
            employee_id = emp.id
        return self.create({
            'employee_id': employee_id,
            'user_id': self.env.user.id,
            'lat': lat, 'lng': lng,
            'accuracy': accuracy or 0.0,
            'battery': int(battery or 0),
            'is_moving': bool(is_moving),
            'logged_at': fields.Datetime.now(),
        }).id

    @api.model
    def latest_positions(self):
        """Most recent ping per employee — powers the admin live map. Admin only
        (raw SQL bypasses record rules, so guard explicitly)."""
        if not self.env.user.has_group('base.group_system'):
            return []
        self.env.cr.execute("""
            SELECT DISTINCT ON (employee_id)
                   employee_id, lat, lng, accuracy, battery, is_moving, logged_at
            FROM robifel_employee_location
            ORDER BY employee_id, logged_at DESC
        """)
        rows = self.env.cr.dictfetchall()
        emp_names = {e.id: e.name for e in self.env['hr.employee'].browse(
            [r['employee_id'] for r in rows])}
        for r in rows:
            r['employee_name'] = emp_names.get(r['employee_id'])
            r['logged_at'] = fields.Datetime.to_string(r['logged_at']) if r['logged_at'] else False
        return rows
