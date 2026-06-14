# -*- coding: utf-8 -*-
from odoo import models, fields


class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    # Optional geo + method enrichment on Odoo's native attendance, for teams
    # that also use hr.attendance directly. The portal primarily drives
    # robifel.attendance.day, but these keep the native model in sync-friendly.
    geo_lat = fields.Float(string='Latitude', digits=(10, 7))
    geo_lng = fields.Float(string='Longitude', digits=(10, 7))
    selfie_photo = fields.Binary(string='Selfie', attachment=True)
    method = fields.Selection([
        ('self', 'Self (employee app)'),
        ('admin', 'Admin marked'),
        ('auto', 'Auto / system'),
    ], string='Source', default='self')
