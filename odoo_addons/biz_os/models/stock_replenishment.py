# -*- coding: utf-8 -*-
from odoo import models, fields, api
from datetime import timedelta


class BizSupplierReorder(models.Model):
    _name = 'biz.supplier.reorder'
    _description = 'Supplier Reorder Recommendation (native sales)'
    _order = 'urgency_sequence asc, reorder_qty desc'
    _rec_name = 'product_id'

    product_id = fields.Many2one('product.product', string='Product', required=True)
    sku = fields.Char(related='product_id.default_code', store=True)

    # Stock
    physical_stock = fields.Float(string='Main WH Stock', digits=(12, 0))
    incoming_qty = fields.Float(string='Incoming (PO) Qty', digits=(12, 0))
    next_po_arrival_date = fields.Date(string='Next PO Arrival')
    pipeline_lowest_days = fields.Float(
        string='Pipeline Low Days', compute='_compute_reorder', store=True, digits=(12, 1))

    total_available = fields.Float(
        string='Total Projected Stock', compute='_compute_reorder', store=True, digits=(12, 0))

    # Sales velocity
    daily_avg_sales = fields.Float(string='Daily Avg Sales (30D)', digits=(12, 2))

    # Config
    lead_time_days = fields.Integer(string='Lead Time (Days)', default=60)
    target_cover_days = fields.Integer(string='Min On Hand Days', default=30)
    order_cycle_days = fields.Integer(string='Order Cycle (Days)', default=30)

    # Computed
    days_in_hand = fields.Integer(
        string='Days in Hand', compute='_compute_reorder', store=True)
    stockout_date = fields.Date(
        string='Stockout Date', compute='_compute_reorder', store=True)
    order_now_qty = fields.Float(
        string='Order Now', compute='_compute_reorder', store=True, digits=(12, 0))
    next_order_date = fields.Date(
        string='Next Order Date', compute='_compute_reorder', store=True)
    next_order_qty = fields.Float(
        string='Next Order Qty', compute='_compute_reorder', store=True, digits=(12, 0))
    reorder_trigger_date = fields.Date(
        string='Reorder By', compute='_compute_reorder', store=True)
    reorder_qty = fields.Float(
        string='Reorder Qty', compute='_compute_reorder', store=True, digits=(12, 0))
    action_required = fields.Boolean(
        string='Action Required', compute='_compute_reorder', store=True)
    urgency = fields.Selection([
        ('critical', 'Critical'),
        ('moderate', 'Moderate'),
        ('healthy', 'Healthy'),
    ], string='Urgency', compute='_compute_reorder', store=True)
    urgency_sequence = fields.Integer(compute='_compute_reorder', store=True)

    @api.depends('physical_stock', 'incoming_qty', 'daily_avg_sales',
                 'next_po_arrival_date', 'lead_time_days', 'target_cover_days', 'order_cycle_days')
    def _compute_reorder(self):
        today = fields.Date.context_today(self)
        for rec in self:
            current_stock = rec.physical_stock
            rec.total_available = current_stock + rec.incoming_qty
            if rec.daily_avg_sales > 0:
                rec.days_in_hand = int(current_stock / rec.daily_avg_sales)
                rec.stockout_date = today + timedelta(days=rec.days_in_hand)
                min_stock = rec.daily_avg_sales * rec.target_cover_days
                cycle_qty = rec.daily_avg_sales * rec.order_cycle_days

                if rec.next_po_arrival_date:
                    days_until_po = max(0, (rec.next_po_arrival_date - today).days)
                    stock_before_next_po = current_stock - (rec.daily_avg_sales * days_until_po)
                    rec.pipeline_lowest_days = stock_before_next_po / rec.daily_avg_sales
                    pipeline_gap = stock_before_next_po < min_stock
                    rec.next_order_date = max(today, rec.next_po_arrival_date - timedelta(days=rec.lead_time_days))
                else:
                    rec.pipeline_lowest_days = 0
                    pipeline_gap = True
                    rec.next_order_date = today

                rec.order_now_qty = cycle_qty if pipeline_gap else 0
                rec.next_order_qty = cycle_qty
                rec.reorder_trigger_date = rec.next_order_date
                rec.reorder_qty = rec.order_now_qty
            else:
                rec.days_in_hand = 999
                rec.stockout_date = today + timedelta(days=365)
                rec.pipeline_lowest_days = 999
                rec.order_now_qty = 0
                rec.next_order_date = today + timedelta(days=365)
                rec.next_order_qty = 0
                rec.reorder_trigger_date = today + timedelta(days=365)
                rec.reorder_qty = 0
            rec.action_required = rec.order_now_qty > 0 or rec.days_in_hand < rec.target_cover_days
            if rec.days_in_hand < rec.target_cover_days or rec.pipeline_lowest_days < 0:
                rec.urgency = 'critical'; rec.urgency_sequence = 1
            elif rec.action_required:
                rec.urgency = 'moderate'; rec.urgency_sequence = 2
            else:
                rec.urgency = 'healthy'; rec.urgency_sequence = 3


class BizSupplierReorderGenerate(models.TransientModel):
    _name = 'biz.supplier.reorder.generate'
    _description = 'Generate Supplier Reorder'

    warehouse_id = fields.Many2one('stock.warehouse', string='Main Warehouse', required=True)

    def _get_config_int(self, key, default):
        value = self.env['ir.config_parameter'].sudo().get_param(key, default)
        try:
            return max(1, int(value))
        except (TypeError, ValueError):
            return default

    def action_generate(self):
        self.ensure_one()
        Reorder = self.env['biz.supplier.reorder']
        SalesMixin = self.env['biz.native.sales.mixin']
        POLine = self.env['purchase.order.line']

        Reorder.search([]).unlink()

        sales_days = self._get_config_int('biz_os.supplier_sales_days', 30)
        lead_time_days = self._get_config_int('biz_os.supplier_lead_time_days', 65)
        target_cover_days = self._get_config_int('biz_os.supplier_target_cover_days', 30)
        order_cycle_days = self._get_config_int('biz_os.supplier_order_cycle_days', 30)
        today = fields.Date.context_today(self)
        sales_from = fields.Date.context_today(self) - timedelta(days=sales_days)

        # Native sold units (exploded to components) over the window.
        product_sales = SalesMixin._native_sold_units(sales_from)

        # Incoming from native confirmed POs.
        product_incoming = {}
        product_next_arrival = {}
        for pol in POLine.search([('order_id.state', 'in', ['purchase', 'done'])]):
            if pol.product_id:
                unreceived = pol.product_qty - pol.qty_received
                if unreceived > 0:
                    pid = pol.product_id.id
                    product_incoming[pid] = product_incoming.get(pid, 0.0) + unreceived
                    po_date = fields.Date.to_date(pol.order_id.date_order) or today
                    expected_arrival = po_date + timedelta(days=lead_time_days)
                    if not product_next_arrival.get(pid) or expected_arrival < product_next_arrival[pid]:
                        product_next_arrival[pid] = expected_arrival

        Product = self.env['product.product']
        seen_products = set(list(product_sales.keys()) + list(product_incoming.keys()))
        for pid in seen_products:
            total_sold = product_sales.get(pid, 0.0)
            incoming = product_incoming.get(pid, 0.0)

            if total_sold <= 0 and incoming <= 0:
                continue

            product = Product.browse(pid)
            daily_avg = total_sold / float(sales_days)
            main_stock = product.with_context(warehouse=self.warehouse_id.id).free_qty

            Reorder.create({
                'product_id': pid,
                'physical_stock': main_stock,
                'incoming_qty': incoming,
                'next_po_arrival_date': product_next_arrival.get(pid),
                'daily_avg_sales': daily_avg,
                'lead_time_days': lead_time_days,
                'target_cover_days': target_cover_days,
                'order_cycle_days': order_cycle_days,
            })

        return {
            'name': 'Supplier Reorder', 'type': 'ir.actions.act_window', 'res_model': 'biz.supplier.reorder',
            'view_mode': 'list,form', 'context': {'search_default_action_required': 1},
        }
