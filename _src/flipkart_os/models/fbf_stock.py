# -*- coding: utf-8 -*-
from odoo import models, fields, api


class FlipkartFbfStock(models.Model):
    _name = 'flipkart.fbf.stock'
    _description = 'FBF Inventory per FSN per Warehouse'
    _order = 'days_remaining asc'
    _rec_name = 'sku'

    account_id = fields.Many2one(
        'flipkart.account', string='Account', required=True, ondelete='cascade')
    warehouse_config_id = fields.Many2one(
        'flipkart.warehouse.config', string='FBF Warehouse', required=True, ondelete='cascade')
    warehouse_name = fields.Char(related='warehouse_config_id.name', store=True)
    product_id = fields.Many2one(
        'product.product', string='Product',
        help='Resolved from FSN via multi-barcode lookup')

    # Identification
    flipkart_warehouse_id = fields.Char(string='Warehouse Code')
    sku = fields.Char(string='SKU')
    title = fields.Char(string='Title')
    listing_id = fields.Char(string='Listing ID')
    fsn = fields.Char(string='FSN', required=True, index=True)
    brand = fields.Char(string='Brand')
    selling_price = fields.Float(string='Selling Price', digits=(12, 2))

    # Live & sales
    qty_live = fields.Float(string='Available to Sell', digits=(12, 0))
    sales_7d = fields.Float(string='Sales 7D', digits=(12, 0))
    sales_14d = fields.Float(string='Sales 14D', digits=(12, 0))
    sales_30d = fields.Float(string='Sales 30D', digits=(12, 0))
    sales_60d = fields.Float(string='Sales 60D', digits=(12, 0))
    sales_90d = fields.Float(string='Sales 90D', digits=(12, 0))

    # Inbound
    b2b_scheduled = fields.Float(string='B2B Scheduled', digits=(12, 0))
    transfers_scheduled = fields.Float(string='Transfers Scheduled', digits=(12, 0))
    b2b_shipped = fields.Float(string='B2B Shipped', digits=(12, 0))
    transfers_shipped = fields.Float(string='Transfers Shipped', digits=(12, 0))
    b2b_receiving = fields.Float(string='B2B Receiving', digits=(12, 0))
    transfers_receiving = fields.Float(string='Transfers Receiving', digits=(12, 0))

    # Reserved
    reserved_orders = fields.Float(string='Reserved for Orders & Recalls', digits=(12, 0))
    reserved_internal = fields.Float(string='Reserved Internal Processing', digits=(12, 0))
    returns_processing = fields.Float(string='Returns Processing', digits=(12, 0))

    # Outbound
    orders_to_dispatch = fields.Float(string='Orders to Dispatch', digits=(12, 0))
    recalls_to_dispatch = fields.Float(string='Recalls to Dispatch', digits=(12, 0))

    # Unsellable
    damaged = fields.Float(string='Damaged', digits=(12, 0))
    qc_reject = fields.Float(string='QC Reject', digits=(12, 0))
    catalog_reject = fields.Float(string='Catalogue Reject', digits=(12, 0))
    returns_reject = fields.Float(string='Returns Reject', digits=(12, 0))
    seller_return_reject = fields.Float(string='Seller Return Reject', digits=(12, 0))
    miscellaneous = fields.Float(string='Miscellaneous', digits=(12, 0))

    # Dimensions
    length_cm = fields.Float(string='Length (cm)')
    breadth_cm = fields.Float(string='Breadth (cm)')
    height_cm = fields.Float(string='Height (cm)')
    weight_kg = fields.Float(string='Weight (kg)')

    # Metadata
    fulfilment_type = fields.Char(string='Fulfilment Type')
    f_assured = fields.Char(string='F-Assured Badge')
    last_upload_date = fields.Date(string='Last Upload', default=fields.Date.context_today)

    # Computed
    daily_velocity = fields.Float(
        string='Daily Velocity', compute='_compute_velocity', store=True, digits=(12, 2))
    days_remaining = fields.Integer(
        string='Days Remaining', compute='_compute_velocity', store=True, group_operator='avg')
    status = fields.Selection([
        ('critical', 'Critical'),
        ('moderate', 'Moderate'),
        ('healthy', 'Healthy'),
    ], string='Status', compute='_compute_velocity', store=True)

    _sql_constraints = [
        ('fsn_wh_account_unique', 'UNIQUE(fsn, warehouse_config_id, account_id)',
         'Only one record per FSN per warehouse per account!'),
    ]

    @api.depends('qty_live', 'sales_7d', 'sales_14d')
    def _compute_velocity(self):
        for rec in self:
            ws = rec.sales_14d or rec.sales_7d or 0
            rec.daily_velocity = ws / 14.0 if rec.sales_14d else (ws / 7.0 if rec.sales_7d else 0)
            if rec.daily_velocity > 0:
                rec.days_remaining = int(rec.qty_live / rec.daily_velocity)
            else:
                rec.days_remaining = 999
            if rec.days_remaining < 10:
                rec.status = 'critical'
            elif rec.days_remaining < 30:
                rec.status = 'moderate'
            else:
                rec.status = 'healthy'
