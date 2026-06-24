# -*- coding: utf-8 -*-
from odoo import models, fields, api

_PRIORITY_LABEL = {'0': 'Low', '1': 'Normal', '2': 'High', '3': 'Urgent'}


class BizTask(models.Model):
    _name = 'biz.task'
    _description = 'Business Task / Assignment'
    _order = 'sequence, deadline asc, id desc'

    name = fields.Char(string='Task', required=True)
    description = fields.Text(string='Details')

    assignee_id = fields.Many2one(
        'res.users', string='Assigned To', required=True, index=True,
        default=lambda self: self.env.user)
    assigned_by_id = fields.Many2one(
        'res.users', string='Assigned By', readonly=True,
        default=lambda self: self.env.user)

    category = fields.Selection([
        # 'consignment' is kept as a generic label so the shared portal Tasks UI
        # (which lists it) can create biz.task rows without a value mismatch.
        ('consignment', 'Consignment'),
        ('inventory', 'Inventory'),
        ('sales', 'Sales'),
        ('purchase', 'Purchase'),
        ('ledger', 'Ledger / Settlement'),
        ('packing', 'Packing'),
        ('general', 'General'),
    ], string='Category', default='general', required=True)

    priority = fields.Selection([
        ('0', 'Low'),
        ('1', 'Normal'),
        ('2', 'High'),
        ('3', 'Urgent'),
    ], string='Priority', default='1', index=True)

    state = fields.Selection([
        ('todo', 'To Do'),
        ('in_progress', 'In Progress'),
        ('done', 'Done'),
    ], string='Status', default='todo', required=True, index=True)

    task_date = fields.Date(
        string='Task Date', default=fields.Date.context_today, index=True,
        help='The day this task is scheduled / assigned for.')
    deadline = fields.Datetime(string='Deadline')
    done_date = fields.Datetime(string='Completed On', readonly=True)

    points = fields.Integer(string='Points', default=10,
                            help='Reward points credited to the assignee when completed.')
    sequence = fields.Integer(default=10)
    color = fields.Integer(default=0)

    active = fields.Boolean(default=True)

    def action_start(self):
        self.write({'state': 'in_progress'})

    def action_done(self):
        self.write({'state': 'done', 'done_date': fields.Datetime.now()})

    def action_reset(self):
        self.write({'state': 'todo', 'done_date': False})

    def _fcm_notify_assignee(self, rec, prev_uid=None):
        """Fire FCM when a task is assigned / re-assigned. Best-effort — never raises."""
        try:
            new_uid = rec.assignee_id.id
            if not new_uid or new_uid == prev_uid or new_uid == self.env.user.id:
                return
            emp = self.env['hr.employee'].sudo().search(
                [('user_id', '=', new_uid)], limit=1)
            if not emp or not emp.fcm_token:
                return
            prio = _PRIORITY_LABEL.get(rec.priority or '1', 'Normal')
            self.env['robifel.hr.settings']._send_fcm_push(
                [emp.fcm_token],
                f'New Task — {prio} Priority',
                rec.name,
                {'taskId': str(rec.id), 'priority': rec.priority or '1',
                 'model': self._name},
            )
        except Exception:
            pass

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for rec in records:
            self._fcm_notify_assignee(rec)
        return records

    def write(self, vals):
        prev = {rec.id: rec.assignee_id.id for rec in self} if 'assignee_id' in vals else {}
        result = super().write(vals)
        if prev:
            for rec in self:
                self._fcm_notify_assignee(rec, prev.get(rec.id))
        return result
