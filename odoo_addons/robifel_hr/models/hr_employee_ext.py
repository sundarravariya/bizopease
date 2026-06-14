# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import AccessError


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    # Personal NFC badge UID (hex). Read/write restricted to admins — it's a
    # credential, employees should not see it. Used by the kiosk fallback so a
    # worker whose own phone has no NFC can still be scanned in on the admin phone.
    robifel_nfc_badge = fields.Char(string='NFC Badge UID', copy=False,
                                    groups='base.group_system')

    @api.model
    def register_badge(self, employee_id, uid):
        """Admin assigns a scanned NFC card UID to an employee (kiosk badge)."""
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("Only administrators can register badges."))
        u = (uid or '').strip().upper()
        if not u:
            return {'ok': False, 'error': 'Empty tag.'}
        dup = self.sudo().search(
            [('robifel_nfc_badge', '=', u), ('id', '!=', employee_id)], limit=1)
        if dup:
            return {'ok': False, 'error': 'Badge already assigned to %s.' % dup.name}
        self.sudo().browse(employee_id).write({'robifel_nfc_badge': u})
        return {'ok': True}

    @api.model
    def clear_badge(self, employee_id):
        if not self.env.user.has_group('base.group_system'):
            raise AccessError(_("Only administrators can change badges."))
        self.sudo().browse(employee_id).write({'robifel_nfc_badge': False})
        return {'ok': True}
