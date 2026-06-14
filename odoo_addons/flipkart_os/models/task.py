# -*- coding: utf-8 -*-
from odoo import models, fields, api


class RobifelTask(models.Model):
    _name = 'robifel.task'
    _description = 'Robifel Task / Assignment'
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

    consignment_id = fields.Many2one('flipkart.consignment', string='Related Consignment')
    active = fields.Boolean(default=True)

    def action_start(self):
        self.write({'state': 'in_progress'})

    def action_done(self):
        self.write({'state': 'done', 'done_date': fields.Datetime.now()})

    def action_reset(self):
        self.write({'state': 'todo', 'done_date': False})
