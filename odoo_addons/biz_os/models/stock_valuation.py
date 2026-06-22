# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class BizStockValuation(models.Model):
    _name = 'biz.stock.valuation'
    _description = 'Stock Valuation (BOM Exploded, native)'
    _rec_name = 'product_id'
    _order = 'total_valuation desc'

    product_id = fields.Many2one(
        'product.product', string='Product', required=True, ondelete='cascade')
    category_id = fields.Many2one(
        related='product_id.categ_id', string='Category', store=True)
    cost_price = fields.Float(
        related='product_id.standard_price', string='Cost Price', store=True)

    # Main warehouse quantities (after BOM explosion)
    main_qty = fields.Float(string='Main WH Qty', digits=(12, 3))
    main_valuation = fields.Float(string='Main WH Value', digits=(16, 2))

    # Totals
    total_qty = fields.Float(
        string='Total Qty', compute='_compute_totals', store=True, digits=(12, 3))
    total_valuation = fields.Float(
        string='Total Value', compute='_compute_totals', store=True, digits=(16, 2))

    last_updated = fields.Datetime(string='Last Updated')

    @api.depends('main_qty', 'cost_price')
    def _compute_totals(self):
        for rec in self:
            rec.total_qty = rec.main_qty or 0.0
            rec.total_valuation = rec.total_qty * (rec.cost_price or 0.0)

    def action_recalculate(self):
        """Delete old rows, walk every quant in the Main Warehouse, explode
        phantom BOMs into base components, accumulate per component and write rows."""
        ValModel = self.env['biz.stock.valuation']
        ValModel.search([]).unlink()

        main_wh = self.env['stock.warehouse'].search([], limit=1)
        if not main_wh:
            raise UserError(_("No warehouse found in the system."))

        main_location_id = main_wh.lot_stock_id.id
        bom_cache = {}
        result = {}

        def explode(product_id, qty):
            if product_id not in bom_cache:
                self.env.cr.execute(
                    """
                    SELECT id FROM mrp_bom
                    WHERE (product_id = %s
                           OR product_tmpl_id = (
                               SELECT product_tmpl_id FROM product_product WHERE id = %s))
                      AND type = 'phantom' AND active = True
                    LIMIT 1
                    """,
                    (product_id, product_id),
                )
                bom_cache[product_id] = self.env.cr.fetchone()

            bom_row = bom_cache[product_id]
            if bom_row:
                self.env.cr.execute(
                    "SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s", (bom_row[0],))
                lines = self.env.cr.fetchall()
                if lines:
                    out = {}
                    for comp_id, comp_qty in lines:
                        sub = explode(comp_id, qty * (comp_qty or 1.0))
                        for k, v in sub.items():
                            out[k] = out.get(k, 0.0) + v
                    return out
            return {product_id: qty}

        quants = self.env['stock.quant'].search([
            ('location_id', 'child_of', main_location_id),
            ('quantity', '>', 0),
        ])
        for q in quants:
            for comp_id, comp_qty in explode(q.product_id.id, q.quantity).items():
                result[comp_id] = result.get(comp_id, 0.0) + comp_qty

        now = fields.Datetime.now()
        to_create = []
        for prod_id, main_q in result.items():
            prod = self.env['product.product'].browse(prod_id)
            cost = prod.standard_price or 0.0
            to_create.append({
                'product_id': prod_id,
                'main_qty': main_q,
                'main_valuation': main_q * cost,
                'last_updated': now,
            })

        if to_create:
            ValModel.create(to_create)

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Stock Valuation'),
                'message': _('%d product lines recalculated.') % len(to_create),
                'sticky': False,
            },
        }
