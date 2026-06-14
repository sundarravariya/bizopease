# -*- coding: utf-8 -*-
from odoo import models, fields, api
from datetime import timedelta


class FlipkartSupplierReorder(models.Model):
    _name = 'flipkart.supplier.reorder'
    _description = 'Supplier Reorder Recommendation'
    _order = 'urgency_sequence asc, reorder_qty desc'
    _rec_name = 'product_id'

    product_id = fields.Many2one('product.product', string='Product', required=True)
    sku = fields.Char(related='product_id.default_code', store=True)

    # Stock
    physical_stock = fields.Float(string='Main WH Stock', digits=(12, 0))
    total_fbf_stock = fields.Float(string='Total FBF Stock', digits=(12, 0))
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

    @api.depends('physical_stock', 'total_fbf_stock', 'incoming_qty', 'daily_avg_sales',
                 'next_po_arrival_date', 'lead_time_days', 'target_cover_days', 'order_cycle_days')
    def _compute_reorder(self):
        today = fields.Date.context_today(self)
        for rec in self:
            current_stock = rec.physical_stock + rec.total_fbf_stock
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


class FlipkartSupplierReorderGenerate(models.TransientModel):
    _name = 'flipkart.supplier.reorder.generate'
    _description = 'Generate Supplier Reorder'

    warehouse_id = fields.Many2one('stock.warehouse', string='Main Warehouse', required=True)

    def _get_config_int(self, key, default):
        value = self.env['ir.config_parameter'].sudo().get_param(key, default)
        try:
            return max(1, int(value))
        except (TypeError, ValueError):
            return default

    def _recursive_explode(self, product_id, qty, results_map):
        self.env.cr.execute("SELECT id FROM mrp_bom WHERE (product_id = %s OR product_tmpl_id = (SELECT product_tmpl_id FROM product_product WHERE id = %s)) AND type = 'phantom' AND active = True LIMIT 1", (product_id, product_id))
        res = self.env.cr.fetchone()
        if res:
            bom_id = res[0]
            self.env.cr.execute("SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s", (bom_id,))
            lines = self.env.cr.fetchall()
            if lines:
                for comp_id, comp_qty in lines:
                    self._recursive_explode(comp_id, qty * (comp_qty or 1.0), results_map)
                return
        results_map[product_id] = results_map.get(product_id, 0.0) + qty

    def action_generate(self):
        self.ensure_one()
        Reorder = self.env['flipkart.supplier.reorder']
        Sales = self.env['flipkart.sales.dashboard']
        FbfStock = self.env['flipkart.fbf.stock']
        
        # Native Odoo Purchase Order Line
        POLine = self.env['purchase.order.line']
        
        Reorder.search([]).unlink()
        
        sales_days = self._get_config_int('flipkart_os.supplier_sales_days', 30)
        lead_time_days = self._get_config_int('flipkart_os.supplier_lead_time_days', 65)
        target_cover_days = self._get_config_int('flipkart_os.supplier_target_cover_days', 30)
        order_cycle_days = self._get_config_int('flipkart_os.supplier_order_cycle_days', 30)
        today = fields.Date.context_today(self)
        sales_from = fields.Date.context_today(self) - timedelta(days=sales_days)
        sales_records = Sales.search([('order_date', '>=', sales_from)])
        product_sales = {}
        for s in sales_records:
            if s.product_id:
                pid = s.product_id.id
                product_sales[pid] = product_sales.get(pid, 0) + s.final_sale_units

        product_fbf = {}
        for fbf in FbfStock.search([('product_id', '!=', False)]):
            stock_qty = fbf.qty_live or 0
            results_map = {}
            self._recursive_explode(fbf.product_id.id, 1.0, results_map)
            for comp_id, qty_mult in results_map.items():
                product_fbf[comp_id] = product_fbf.get(comp_id, 0.0) + (stock_qty * qty_mult)

        # Calculate incoming from native confirmed POs
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
        seen_products = set(list(product_sales.keys()) + list(product_fbf.keys()) + list(product_incoming.keys()))
        for pid in seen_products:
            total_sold = product_sales.get(pid, 0.0)
            fbf_stock = product_fbf.get(pid, 0.0)
            incoming = product_incoming.get(pid, 0.0)
            
            if total_sold <= 0 and fbf_stock <= 0 and incoming <= 0: continue

            product = Product.browse(pid)
            daily_avg = total_sold / float(sales_days)
            main_stock = product.with_context(warehouse=self.warehouse_id.id).free_qty
            
            Reorder.create({
                'product_id': pid, 
                'physical_stock': main_stock, 
                'total_fbf_stock': fbf_stock, 
                'incoming_qty': incoming,
                'next_po_arrival_date': product_next_arrival.get(pid),
                'daily_avg_sales': daily_avg,
                'lead_time_days': lead_time_days,
                'target_cover_days': target_cover_days,
                'order_cycle_days': order_cycle_days,
            })
            
        return {
            'name': 'Supplier Reorder', 'type': 'ir.actions.act_window', 'res_model': 'flipkart.supplier.reorder',
            'view_mode': 'list,form', 'context': {'search_default_action_required': 1},
        }
