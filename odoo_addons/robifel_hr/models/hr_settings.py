# -*- coding: utf-8 -*-
import secrets
from datetime import datetime
from math import radians, sin, cos, asin, sqrt

from odoo import models, fields, api, _
from odoo.exceptions import AccessError, UserError


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
        ('qr', 'QR Code'),
    ], string='Attendance Method', default='gps_selfie')

    # QR attendance — rotating or fixed token
    qr_fixed = fields.Boolean(string='Fixed QR (no rotation)', default=False)
    qr_daily_token = fields.Char(string='QR Token (current)', readonly=True)
    qr_token_date = fields.Date(string='QR Token Date', readonly=True)
    qr_token_at = fields.Datetime(string='QR Token Generated At', readonly=True)
    qr_token_prev = fields.Char(string='QR Token (previous)', readonly=True)

    # FCM push — service account JSON for HTTP v1 API (admin-only)
    fcm_service_account = fields.Text(string='FCM Service Account JSON', groups='base.group_system')
    # Registered workplace NFC tag UIDs (comma-separated hex).
    nfc_tag_ids = fields.Char(string='Registered NFC Tags', default='')
    # Kiosk fallback: admin device scans an employee's personal NFC badge.
    kiosk_enabled = fields.Boolean(string='Enable Kiosk (badge scan)', default=True)

    # ── Geofence (work-location lockout) ──────────────────────────────────
    # When enabled, a GPS check-in/out is rejected unless the punch is within
    # `geofence_radius` metres of (geofence_lat, geofence_lng).
    geofence_enabled = fields.Boolean(string='Enforce Work Location', default=False)
    geofence_lat = fields.Float(string='Workplace Latitude', digits=(10, 7))
    geofence_lng = fields.Float(string='Workplace Longitude', digits=(10, 7))
    geofence_radius = fields.Integer(string='Allowed Radius (m)', default=150)

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
            'qr_fixed': rec.qr_fixed,
            'geofence_enabled': rec.geofence_enabled,
            # Don't leak the exact workplace coordinates to non-admins.
            'geofence_lat': rec.geofence_lat if is_admin else 0.0,
            'geofence_lng': rec.geofence_lng if is_admin else 0.0,
            'geofence_radius': rec.geofence_radius or 150,
            'fcm_service_account_set': bool(rec.sudo().fcm_service_account) if is_admin else False,
            # Server-authoritative date (respects the user's timezone), so the
            # gate doesn't mis-match on a device with a skewed clock/timezone.
            'today': fields.Date.to_string(fields.Date.context_today(self)),
            # Server wall-clock in minutes from midnight so the portal can
            # detect a manipulated device clock.
            'server_now_minutes': datetime.now().hour * 60 + datetime.now().minute,
        }

    @api.model
    def save_settings(self, vals):
        """Admin-only."""
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("Only administrators can change HR settings."))
        rec = self._singleton()
        rec.write({k: v for k, v in vals.items() if k in (
            'work_start', 'work_end', 'enforce_work_hours', 'weekly_off',
            'ping_interval', 'attendance_mode', 'nfc_tag_ids', 'kiosk_enabled',
            'qr_fixed', 'geofence_enabled', 'geofence_lat', 'geofence_lng',
            'geofence_radius', 'fcm_service_account')})
        return self.get_settings()

    @staticmethod
    def _haversine_m(lat1, lng1, lat2, lng2):
        """Great-circle distance between two lat/lng points, in metres."""
        earth_r = 6371000.0
        dlat = radians(lat2 - lat1)
        dlng = radians(lng2 - lng1)
        a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
        return 2 * earth_r * asin(sqrt(a))

    @api.model
    def assert_within_geofence(self, lat, lng):
        """Raise a UserError if the geofence is on and (lat, lng) is outside the
        allowed radius. Returns the distance in metres (0.0 when geofence is off
        or no workplace centre has been set yet)."""
        rec = self._singleton()
        if not rec.geofence_enabled:
            return 0.0
        # Geofence enabled but no centre captured yet -> don't lock anyone out.
        if not (rec.geofence_lat or rec.geofence_lng):
            return 0.0
        try:
            lat, lng = float(lat or 0.0), float(lng or 0.0)
        except (TypeError, ValueError):
            lat = lng = 0.0
        if not lat and not lng:
            raise UserError(_(
                "Location is required to mark attendance. Turn on GPS / grant "
                "location permission and try again."))
        dist = self._haversine_m(rec.geofence_lat, rec.geofence_lng, lat, lng)
        radius = rec.geofence_radius or 150
        if dist > radius:
            raise UserError(_(
                "You're about %dm from the workplace (allowed: %dm). Move closer "
                "to the work location to mark attendance.") % (int(dist), int(radius)))
        return dist

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

    @api.model
    def get_daily_qr(self):
        """Admin-only. Returns the current QR URL; token rotates every 2 minutes."""
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("Only administrators can view the daily QR code."))
        from datetime import timedelta
        rec = self._singleton()
        now = datetime.now()
        today = fields.Date.context_today(self)
        if rec.qr_fixed:
            # Fixed mode: generate once, never rotate
            needs_rotate = not rec.qr_daily_token
        else:
            needs_rotate = (
                not rec.qr_daily_token
                or not rec.qr_token_at
                or rec.qr_token_date != today
                or (now - rec.qr_token_at).total_seconds() >= 120
            )
        if needs_rotate:
            rec.write({
                'qr_token_prev': rec.qr_daily_token,
                'qr_daily_token': secrets.token_urlsafe(24),
                'qr_token_date': today,
                'qr_token_at': fields.Datetime.now(),
            })
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        today_str = fields.Date.to_string(today)
        url = f"{base_url}/qr?t={rec.qr_daily_token}&d={today_str}"
        return {'token': rec.qr_daily_token, 'date': today_str, 'url': url}

    @api.model
    def punch_by_qr(self, token, date_str, lat=False, lng=False, selfie=False):
        """Any employee. Validates the QR token (current or previous window) then punches."""
        rec = self._singleton()
        today_str = fields.Date.to_string(fields.Date.context_today(self))
        if rec.qr_token_date != fields.Date.from_string(today_str) or date_str != today_str:
            raise UserError(_("This QR code has expired. Ask your manager to refresh it."))
        valid_tokens = {t for t in (rec.qr_daily_token, rec.qr_token_prev) if t}
        if token not in valid_tokens:
            raise UserError(_("Invalid QR code."))
        emp = self.env['hr.employee'].search([('user_id', '=', self.env.user.id)], limit=1)
        if not emp:
            raise UserError(_("No employee record is linked to your account."))
        return self.env['robifel.attendance.day'].punch(emp.id, 'auto', lat, lng, selfie)

    @api.model
    def save_fcm_token(self, token):
        """Any logged-in user can register their device's FCM push token."""
        if not token:
            return False
        emp = self.env['hr.employee'].sudo().search(
            [('user_id', '=', self.env.user.id)], limit=1)
        if emp:
            emp.write({'fcm_token': token.strip()})
        return True

    @api.model
    def _fcm_oauth_token(self):
        """Mint a short-lived OAuth2 bearer token for FCM HTTP v1 using the stored
        service account JSON.  Returns None if the service account is not configured
        or if any step fails."""
        import json as _json, time as _time, base64 as _b64
        try:
            import requests as _req
            from cryptography.hazmat.primitives import hashes as _h, serialization as _ser
            from cryptography.hazmat.primitives.asymmetric import padding as _pad
        except ImportError:
            return None

        rec = self._singleton()
        sa_raw = rec.sudo().fcm_service_account
        if not sa_raw:
            return None
        try:
            sa = _json.loads(sa_raw)
            client_email = sa['client_email']
            private_key_pem = sa['private_key']

            def _b64u(data):
                if isinstance(data, str):
                    data = data.encode()
                return _b64.urlsafe_b64encode(data).rstrip(b'=').decode()

            now = int(_time.time())
            header = _b64u(_json.dumps({"alg": "RS256", "typ": "JWT"}))
            claim = _b64u(_json.dumps({
                "iss": client_email,
                "scope": "https://www.googleapis.com/auth/firebase.messaging",
                "aud": "https://oauth2.googleapis.com/token",
                "iat": now,
                "exp": now + 3600,
            }))
            signing_input = f"{header}.{claim}".encode()
            pk = _ser.load_pem_private_key(private_key_pem.encode(), password=None)
            sig = pk.sign(signing_input, _pad.PKCS1v15(), _h.SHA256())
            jwt = f"{header}.{claim}.{_b64u(sig)}"

            resp = _req.post(
                "https://oauth2.googleapis.com/token",
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                      "assertion": jwt},
                timeout=10,
            )
            return resp.json().get("access_token")
        except Exception:
            return None

    _FCM_PRIORITY_CHANNEL = {
        '3': 'tasks_urgent', '2': 'tasks_high', '1': 'tasks_normal', '0': 'tasks_low',
    }

    @api.model
    def _send_fcm_push(self, tokens, title, body, data=None):
        """Send an FCM push via HTTP v1 API (service account OAuth2).
        tokens — list of FCM registration tokens.
        Silent no-op when service account not configured or any error occurs."""
        if not tokens:
            return
        clean = [t for t in (tokens if isinstance(tokens, list) else [tokens]) if t]
        if not clean:
            return
        rec = self._singleton()
        if not rec.sudo().fcm_service_account:
            return
        bearer = self._fcm_oauth_token()
        if not bearer:
            return
        try:
            import json as _json
            import requests as _req
            sa = _json.loads(rec.sudo().fcm_service_account)
            project_id = sa.get('project_id', 'bizopease')
            d = data or {}
            channel_id = self._FCM_PRIORITY_CHANNEL.get(str(d.get('priority', '1')), 'tasks_normal')
            url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
            headers = {"Authorization": f"Bearer {bearer}", "Content-Type": "application/json"}
            for token in clean:
                payload = {
                    "message": {
                        "token": token,
                        "notification": {"title": title, "body": body},
                        "data": {k: str(v) for k, v in d.items()},
                        "android": {
                            "priority": "high",
                            "notification": {"channel_id": channel_id},
                        },
                    }
                }
                _req.post(url, json=payload, headers=headers, timeout=8)
        except Exception:
            pass
