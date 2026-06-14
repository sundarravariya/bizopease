# -*- coding: utf-8 -*-
from odoo import models, fields


class StockMove(models.Model):
    _inherit = 'stock.move'

    daily_order_id = fields.Many2one('flipkart.daily.order', string='Flipkart Daily Order')
    return_id = fields.Many2one('flipkart.return.management', string='Flipkart Return Record')
