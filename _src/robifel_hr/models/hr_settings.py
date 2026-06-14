# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import AccessError


class RobifelHrSettings(models.Model):
    _name = 'robifel.hr.settings'
    _description = 'Robifel HR Global Settings (singleton)'

    name = fields.Char(default='HR Settings', readonly=True)
    # Work window during which employee (non-admin) accounts may use the app.
    work_start = fields.Char(string='Work Start (HH:MM)', default='10:00')
    work_end = fields.Char(string='Work End (HH:MM)', default='19:00')
    enforce_work_hours = fields.Boolean(string='Enforce Work Hours', default=True)
    # Weekly off day, 0=Mon … 6=Sun (Python weekday convention).
    weekly_off = fields.Selection([
        ('0', 'Monday'), ('1', 'Tuesday'), ('2', 'Wednesday'), ('3', 'Thursday'),
        ('4', 'Friday'), ('5', 'Saturday'), ('6', 'Sunday'),
    ], string='Weekly Off', default='6')
    # Live-location ping cadence for the employee app (seconds).
    ping_interval = fields.Integer(string='Location Ping Interval (s)', default=120)
    # How employees mark attendance.
    attendance_mode = fields.Selection([
        ('gps_selfie', 'GPS + Selfie'),
        ('nfc', 'NFC Tag Scan'),
    ], string='Attendance Method', default='gps_selfie')
    # Registered workplace NFC tag UIDs (comma-separated hex).
    nfc_tag_ids = fields.Char(string='Registered NFC Tags', default='')
    # Kiosk fallback: admin device scans an employee's personal NFC badge.
    kiosk_enabled = fields.Boolean(string='Enable Kiosk (badge scan)', default=True)

    @api.model
    def _singleton(self):
        rec = self.search([], limit=1)
        if not rec:
            rec = self.create({})
        return rec

    @api.model
    def get_settings(self):
        """Readable by any internal user — drives the work-hours gate + ping cadence."""
        rec = self._singleton()
        # nfc_tag_ids is workplace config, not employee data, but avoid leaking
        # the raw tag list to non-admins.
        is_admin = self.env.user.has_group('base.group_system')
        return {
            'work_start': rec.work_start or '10:00',
            'work_end': rec.work_end or '19:00',
            'enforce_work_hours': rec.enforce_work_hours,
            'weekly_off': rec.weekly_off or '6',
            'ping_interval': rec.ping_interval or 120,
            'attendance_mode': rec.attendance_mode or 'gps_selfie',
            'nfc_tag_ids': (rec.nfc_tag_ids or '') if is_admin else '',
            'kiosk_enabled': rec.kiosk_enabled,
            # Server-authoritative date (respects the user's timezone), so the
            # gate doesn't mis-match on a device with a skewed clock/timezone.
            'today': fields.Date.to_string(fields.Date.context_today(self)),
        }

    @api.model
    def save_settings(self, vals):
        """Admin-only."""
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("Only administrators can change HR settings."))
        rec = self._singleton()
        rec.write({k: v for k, v in vals.items() if k in (
            'work_start', 'work_end', 'enforce_work_hours', 'weekly_off',
            'ping_interval', 'attendance_mode', 'nfc_tag_ids', 'kiosk_enabled')})
        return self.get_settings()

    @api.model
    def _tag_set(self):
        rec = self._singleton()
        return {t.strip().upper() for t in (rec.nfc_tag_ids or '').split(',') if t.strip()}

    @api.model
    def register_nfc_tag(self, uid):
        """Admin one-time setup: add a scanned tag UID to the workplace tag list."""
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("Only administrators can register NFC tags."))
        rec = self._singleton()
        u = (uid or '').strip().upper()
        if not u:
            return self.get_settings()
        tags = self._tag_set()
        tags.add(u)
        rec.write({'nfc_tag_ids': ','.join(sorted(tags))})
        return self.get_settings()

    @api.model
    def is_valid_tag(self, uid):
        """True if the scanned UID matches a registered workplace tag."""
        return (uid or '').strip().upper() in self._tag_set()
