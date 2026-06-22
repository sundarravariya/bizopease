# -*- coding: utf-8 -*-
from odoo import models, fields, api
from datetime import timedelta


class BizDeadStock(models.Model):
    _name = 'biz.dead.stock'
    _description = 'Dead Stock Analysis (native sales)'
    _order = 'sell_through_rate asc'
    _rec_name = 'product_id'

    product_id = fields.Many2one('product.product', string='Product', required=True)
    sku = fields.Char(related='product_id.default_code', store=True)

    # Stock
    main_stock = fields.Float(string='Main Stock', digits=(12, 0))
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


class BizDeadStockGenerate(models.TransientModel):
    _name = 'biz.dead.stock.generate'
    _description = 'Generate Dead Stock Analysis'

    warehouse_id = fields.Many2one('stock.warehouse', string='Main Warehouse', required=True)

    def _get_config_int(self, key, default):
        value = self.env['ir.config_parameter'].sudo().get_param(key, default)
        try:
            return max(1, int(value))
        except (TypeError, ValueError):
            return default

    def action_generate(self):
        self.ensure_one()
        DeadStock = self.env['biz.dead.stock']
        SalesMixin = self.env['biz.native.sales.mixin']
        DeadStock.search([]).unlink()

        sales_days = self._get_config_int('biz_os.dead_stock_sales_days', 30)
        sales_from = fields.Date.context_today(self) - timedelta(days=sales_days)

        # 1. Aggregate native sold units (exploded to components) over the window.
        product_sales = SalesMixin._native_sold_units(sales_from)

        # 2. Identify BOM parent (kit) products to exclude from the stock walk.
        self.env.cr.execute("SELECT DISTINCT product_id FROM mrp_bom WHERE active = True AND product_id IS NOT NULL")
        bom_pids = [r[0] for r in self.env.cr.fetchall()]
        self.env.cr.execute("SELECT DISTINCT p.id FROM product_product p JOIN mrp_bom b ON p.product_tmpl_id = b.product_tmpl_id WHERE b.active = True AND b.product_id IS NULL")
        bom_tmpl_pids = [r[0] for r in self.env.cr.fetchall()]
        exclude_pids = set(bom_pids + bom_tmpl_pids)

        # 3. Analyze all physical products in the chosen Main Warehouse.
        Product = self.env['product.product']
        storable_prods = Product.search([('is_storable', '=', True), ('id', 'not in', list(exclude_pids))])

        for product in storable_prods:
            main_stock = product.with_context(warehouse=self.warehouse_id.id).qty_available
            if main_stock <= 0:
                continue

            sold_30d = product_sales.get(product.id, 0.0)
            sell_through = (sold_30d / main_stock) * 100

            if sell_through < 25.0:
                DeadStock.create({
                    'product_id': product.id,
                    'main_stock': main_stock,
                    'total_stock': main_stock,
                    'sales_30d': sold_30d,
                    'sell_through_rate': sell_through,
                    'state': 'dead' if sell_through < 10.0 else 'potential',
                    'stock_value': product.standard_price * main_stock,
                })

        return {
            'name': 'Dead Stock Analysis',
            'type': 'ir.actions.act_window',
            'res_model': 'biz.dead.stock',
            'view_mode': 'list,pivot,form',
            'domain': [('state', 'in', ['dead', 'potential'])],
        }
