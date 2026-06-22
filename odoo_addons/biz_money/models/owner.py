# -*- coding: utf-8 -*-
from odoo import models, fields


class BizOwner(models.Model):
    _name = 'biz.owner'
    _description = 'Business Owner / Recipient'
    _order = 'name'

    name = fields.Char(required=True, string='Name')
    notes = fields.Text(string='Notes')
