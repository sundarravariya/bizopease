# -*- coding: utf-8 -*-
from odoo import models, fields

class FlipkartOwner(models.Model):
    _name = 'flipkart.owner'
    _description = 'Business Owner / Recipient'
    _order = 'name'

    name = fields.Char(required=True, string='Name')
    notes = fields.Text(string='Notes')
