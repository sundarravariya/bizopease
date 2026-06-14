# -*- coding: utf-8 -*-
from odoo import models, fields, api
from datetime import timedelta


class FlipkartDeadStock(models.Model):
    _name = 'flipkart.dead.stock'
    _description = 'Flipkart Dead Stock Analysis'
    _order = 'sell_through_rate asc'
    _rec_name = 'product_id'

    product_id = fields.Many2one('product.product', string='Product', required=True)
    sku = fields.Char(related='product_id.default_code', store=True)

    # Stock
    main_stock = fields.Float(string='Main Stock', digits=(12, 0))
    fbf_stock = fields.Float(string='FBF Stock', digits=(12, 0))
    total_stock = fields.Float(string='Total Stock', digits=(12, 0))
    stock_value = fields.Float(string='Amount', digits=(12, 2), help='Cost Price × Total Stock')

    # Sales
    sales_30d = fields.Float(string='Sales (Last 30D)', digits=(12, 0))

    # Analysis
    sell_through_rate = fields.Float(string='Sell-Through %', digits=(12, 2))
    state = fields.Selection([
        ('dead', 'Dead Stock'),
        ('potential', 'Potential Dead'),
        ('healthy', 'Healthy'),
    ], string='Status', default='dead')


class FlipkartDeadStockGenerate(models.TransientModel):
    _name = 'flipkart.dead.stock.generate'
    _description = 'Generate Dead Stock Analysis'

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
        DeadStock = self.env['flipkart.dead.stock']
        Sales = self.env['flipkart.sales.dashboard']
        DeadStock.search([]).unlink()
        
        sales_days = self._get_config_int('flipkart_os.dead_stock_sales_days', 30)
        sales_from = fields.Date.context_today(self) - timedelta(days=sales_days)
        
        # 1. Aggregate Sales over the configured window.
        sales_records = Sales.search([('order_date', '>=', sales_from)])
        product_sales = {}
        for s in sales_records:
            if s.product_id:
                pid = s.product_id.id
                product_sales[pid] = product_sales.get(pid, 0) + s.final_sale_units

        # 2. Identify BOM products to exclude (Parent Products)
        self.env.cr.execute("SELECT DISTINCT product_id FROM mrp_bom WHERE active = True AND product_id IS NOT NULL")
        bom_pids = [r[0] for r in self.env.cr.fetchall()]
        self.env.cr.execute("SELECT DISTINCT p.id FROM product_product p JOIN mrp_bom b ON p.product_tmpl_id = b.product_tmpl_id WHERE b.active = True AND b.product_id IS NULL")
        bom_tmpl_pids = [r[0] for r in self.env.cr.fetchall()]
        exclude_pids = set(bom_pids + bom_tmpl_pids)

        # 3. Analyze all physical products in Main Warehouse
        Product = self.env['product.product']
        # Filter for storable products
        storable_prods = Product.search([('is_storable', '=', True), ('id', 'not in', list(exclude_pids))])
        
        for product in storable_prods:
            # We use qty_available (On Hand) as per "Total Stock Available"
            main_stock = product.with_context(warehouse=self.warehouse_id.id).qty_available
            
            if main_stock <= 0: continue
            
            sold_30d = product_sales.get(product.id, 0.0)
            sell_through = (sold_30d / main_stock) * 100
            
            if sell_through < 25.0:
                DeadStock.create({
                    'product_id': product.id,
                    'main_stock': main_stock,
                    'fbf_stock': 0.0, # Per request: "no need to analyse dead stock in fbf"
                    'total_stock': main_stock,
                    'sales_30d': sold_30d,
                    'sell_through_rate': sell_through,
                    'state': 'dead' if sell_through < 10.0 else 'potential',
                    'stock_value': product.standard_price * main_stock
                })
        
        return {
            'name': 'Dead Stock Analysis',
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.dead.stock',
            'view_mode': 'list,pivot,form',
            'domain': [('state', 'in', ['dead', 'potential'])],
        }
