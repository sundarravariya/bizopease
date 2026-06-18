# -*- coding: utf-8 -*-
from datetime import date, timedelta
from odoo import models, fields, api


class FlipkartFbfReplenishment(models.Model):
    _name = 'flipkart.fbf.replenishment'
    _description = 'FBF Replenishment Recommendation'
    _order = 'urgency_sequence asc, qty_to_send desc'
    _rec_name = 'product_id'

    account_id = fields.Many2one('flipkart.account', string='Account', required=True)
    warehouse_config_id = fields.Many2one(
        'flipkart.warehouse.config', string='FBF Warehouse', required=True)
    warehouse_name = fields.Char(related='warehouse_config_id.name', store=True)
    product_id = fields.Many2one('product.product', string='Product', required=True)
    sku = fields.Char(related='product_id.default_code', store=True)
    fsn = fields.Char(string='FSN')

    # Toggle for consignment creation
    selected = fields.Boolean(string='Select', default=False)

    # Inputs from FBF stock
    fbf_stock = fields.Float(string='FBF Stock', digits=(12, 0))
    sales_7d = fields.Float(string='Sales 7D', digits=(12, 0))
    sales_14d = fields.Float(string='Sales 14D', digits=(12, 0))
    in_transit = fields.Float(string='In Transit', digits=(12, 0))
    transit_days = fields.Integer(related='warehouse_config_id.transit_days', store=True)
    target_cover_days = fields.Integer(string='Target Cover Days', default=14)
    critical_days = fields.Integer(string='Critical Below Days', default=7)
    moderate_days = fields.Integer(string='Moderate Below Days', default=21)

    # Computed
    daily_sales = fields.Float(
        string='Daily Sales', compute='_compute_replenishment', store=True, digits=(12, 2))
    qty_to_send = fields.Float(
        string='Qty to Send', compute='_compute_replenishment', store=True, digits=(12, 0))
    days_cover_after = fields.Float(
        string='Days Cover After', compute='_compute_replenishment', store=True, digits=(12, 1))
    urgency = fields.Selection([
        ('critical', 'Critical'),
        ('moderate', 'Moderate'),
        ('healthy', 'Healthy'),
    ], string='Urgency', compute='_compute_replenishment', store=True)
    urgency_sequence = fields.Integer(compute='_compute_replenishment', store=True)
    uses_flipkart_fallback = fields.Boolean(
        string='Using Flipkart Velocity (no FBF sales)', compute='_compute_replenishment', store=True)

    @api.depends('fbf_stock', 'sales_7d', 'sales_14d', 'in_transit', 'transit_days',
                 'target_cover_days', 'critical_days', 'moderate_days', 'fsn', 'account_id')
    def _compute_replenishment(self):
        cutoff_str = fields.Date.to_string(date.today() - timedelta(days=14))
        for rec in self:
            # FBF velocity from the FBF warehouse sales
            ws = rec.sales_14d or rec.sales_7d or 0
            fbf_daily = ws / 14.0 if rec.sales_14d else (ws / 7.0 if rec.sales_7d else 0)

            # When FBF sales are zero, fall back to Flipkart platform sales
            rec.uses_flipkart_fallback = False
            flipkart_daily = 0.0
            if fbf_daily == 0 and rec.fsn and rec.account_id:
                groups = rec.env['flipkart.sales.dashboard'].read_group(
                    domain=[
                        ('account_id', '=', rec.account_id.id),
                        ('sku_id', '=', rec.fsn),
                        ('is_fsn_row', '=', True),
                        ('order_date', '>=', cutoff_str),
                    ],
                    fields=['final_sale_units:sum'],
                    groupby=[],
                )
                total_units = (groups[0].get('final_sale_units', 0.0) or 0.0) if groups else 0.0
                if total_units > 0:
                    # Divide by number of FBF warehouses carrying this FSN so per-warehouse velocity is accurate
                    wh_count = max(1, rec.search_count([
                        ('account_id', '=', rec.account_id.id),
                        ('fsn', '=', rec.fsn),
                    ]))
                    flipkart_daily = (total_units / 14.0) / wh_count
                    rec.uses_flipkart_fallback = True

            rec.daily_sales = fbf_daily if fbf_daily > 0 else flipkart_daily

            if rec.daily_sales > 0:
                transit_buffer = rec.daily_sales * rec.transit_days
                target = (rec.daily_sales * rec.target_cover_days) + transit_buffer
                rec.qty_to_send = max(0, target - rec.fbf_stock - rec.in_transit)
                days_now = rec.fbf_stock / rec.daily_sales
            else:
                rec.qty_to_send = 0
                days_now = 999

            # Days cover after sending
            if rec.daily_sales > 0 and rec.qty_to_send > 0:
                rec.days_cover_after = (rec.fbf_stock + rec.in_transit + rec.qty_to_send) / rec.daily_sales
            else:
                rec.days_cover_after = days_now

            # Urgency
            if days_now < rec.critical_days and rec.qty_to_send > 0:
                rec.urgency = 'critical'
                rec.urgency_sequence = 1
            elif days_now < rec.moderate_days and rec.qty_to_send > 0:
                rec.urgency = 'moderate'
                rec.urgency_sequence = 2
            else:
                rec.urgency = 'healthy'
                rec.urgency_sequence = 3


class FlipkartFbfReplenishmentGenerate(models.TransientModel):
    _name = 'flipkart.fbf.replenishment.generate'
    _description = 'Generate FBF Replenishment'

    account_id = fields.Many2one('flipkart.account', string='Account', required=True)

    def _get_config_int(self, key, default):
        value = self.env['ir.config_parameter'].sudo().get_param(key, default)
        try:
            return max(1, int(value))
        except (TypeError, ValueError):
            return default

    def action_generate(self):
        self.ensure_one()
        Replenishment = self.env['flipkart.fbf.replenishment']
        FbfStock = self.env['flipkart.fbf.stock']
        ConsignmentLine = self.env['flipkart.consignment.line']
        target_cover_days = self._get_config_int('flipkart_os.fbf_target_cover_days', 14)
        critical_days = self._get_config_int('flipkart_os.fbf_critical_days', 7)
        moderate_days = self._get_config_int('flipkart_os.fbf_moderate_days', 21)

        # Clear old for this account
        Replenishment.search([('account_id', '=', self.account_id.id)]).unlink()

        # 1. Aggregate Odoo Transit from existing Consignments (Draft, RTD, Picked Up)
        # Consignment account selection is ('robifel', 'roxxcart')
        # Account ID name is likely ('Robifel', 'Roxxcart')
        acc_key = str(self.account_id.name).lower()
        
        c_lines = ConsignmentLine.search([
            ('consignment_id.account', '=', acc_key),
            ('consignment_id.state', 'in', ('draft', 'rtd', 'picked_up')),
            ('fsn', '!=', False)
        ])
        
        odoo_transit_map = {} # (fsn, warehouse_id) -> total_qty
        for line in c_lines:
            key = (line.fsn, line.consignment_id.warehouse_id.id)
            odoo_transit_map[key] = odoo_transit_map.get(key, 0.0) + (line.quantity_sent or 0.0)

        stocks = FbfStock.search([
            ('account_id', '=', self.account_id.id),
            ('product_id', '!=', False),
        ])

        # Build set of FSNs with any Flipkart platform sales in last 14 days (for zero-FBF products)
        cutoff_str = fields.Date.to_string(date.today() - timedelta(days=14))
        fk_sales_groups = self.env['flipkart.sales.dashboard'].read_group(
            domain=[
                ('account_id', '=', self.account_id.id),
                ('is_fsn_row', '=', True),
                ('order_date', '>=', cutoff_str),
            ],
            fields=['sku_id'],
            groupby=['sku_id'],
        )
        fsn_with_flipkart_sales = {g['sku_id'] for g in fk_sales_groups if g.get('sku_id')}

        for s in stocks:
            if s.sales_14d > 0 or s.sales_7d > 0 or s.qty_live < 5 or s.fsn in fsn_with_flipkart_sales:
                # Add Odoo Transit if warehouse configuration matchesbackend warehouse on consignment
                odoo_key = (s.fsn, s.warehouse_config_id.backend_warehouse_id.id)
                odoo_t = odoo_transit_map.get(odoo_key, 0.0)
                
                Replenishment.create({
                    'account_id': self.account_id.id,
                    'warehouse_config_id': s.warehouse_config_id.id,
                    'product_id': s.product_id.id,
                    'fsn': s.fsn,
                    'fbf_stock': s.qty_live,
                    'sales_7d': s.sales_7d,
                    'sales_14d': s.sales_14d,
                    'in_transit': (s.b2b_shipped or 0) + (s.transfers_shipped or 0) + odoo_t,
                    'target_cover_days': target_cover_days,
                    'critical_days': critical_days,
                    'moderate_days': moderate_days,
                })

        return {
            'name': 'FBF Replenishment',
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.fbf.replenishment',
            'view_mode': 'list',
            'domain': [('account_id', '=', self.account_id.id)],
            'context': {'search_default_filter_needs_action': 1},
        }
