# -*- coding: utf-8 -*-
from odoo import models, fields


class FlipkartSalesDashboard(models.Model):
    _name = 'flipkart.sales.dashboard'
    _description = 'Flipkart Sales Dashboard'
    _order = 'order_date desc, id desc'

    account_id = fields.Many2one('flipkart.account', string='Account', required=True)
    partner_id = fields.Many2one('res.partner', string='Customer')
    sale_order_line_id = fields.Many2one('sale.order.line', string='Originating Sale Line', ondelete='cascade')
    order_number = fields.Char(string='Order #')

    order_date = fields.Date(string='Order Date', required=True)
    product_id = fields.Many2one('product.product', string='Odoo Product', help='Mapped via SKU or FSN')
    sku_id = fields.Char(string='SKU ID / FSN')

    category = fields.Char(string='Category')
    brand = fields.Char(string='Brand')
    vertical = fields.Char(string='Vertical')
    fulfillment_type = fields.Char(string='Fulfillment Type')
    location_id = fields.Char(string='Location Id')

    gross_units = fields.Integer(string='Gross Units')
    gmv = fields.Float(string='GMV', digits=(12, 2))
    cancellation_units = fields.Integer(string='Cancellation Units')
    cancel_amount = fields.Float(string='Cancellation Amount', digits=(12, 2))
    return_units = fields.Integer(string='Return Units')
    return_amount = fields.Float(string='Return Amount', digits=(12, 2))

    final_sale_units = fields.Integer(string='Final Sale Units')
    final_sale_amount = fields.Float(string='Final Sale Amount', digits=(12, 2))

    _sql_constraints = [
        ('date_sku_unique', 'UNIQUE(account_id, order_date, sku_id, location_id, fulfillment_type, sale_order_line_id)',
         'Sales record must be unique per Account, Date, SKU, Location, and Fulfillment Type!')
    ]
