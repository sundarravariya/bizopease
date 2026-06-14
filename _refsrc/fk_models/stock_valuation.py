# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class FlipkartStockValuation(models.Model):
    _name = 'flipkart.stock.valuation'
    _description = 'Overall Stock Valuation (BOM Exploded)'
    _rec_name = 'product_id'
    _order = 'total_valuation desc'

    product_id = fields.Many2one(
        'product.product', string='Product', required=True, ondelete='cascade')
    category_id = fields.Many2one(
        related='product_id.categ_id', string='Category', store=True)
    cost_price = fields.Float(
        related='product_id.standard_price', string='Cost Price', store=True)

    # Odoo Main Warehouse quantities (after BOM explosion)
    main_qty = fields.Float(string='Main WH Qty', digits=(12, 3))
    main_valuation = fields.Float(string='Main WH Value', digits=(16, 2))

    # FBF quantities (after BOM explosion, summed across all FBF warehouses)
    fbf_qty = fields.Float(string='FBF Qty', digits=(12, 3))
    fbf_valuation = fields.Float(string='FBF Value', digits=(16, 2))

    # Totals
    total_qty = fields.Float(
        string='Total Qty', compute='_compute_totals', store=True, digits=(12, 3))
    total_valuation = fields.Float(
        string='Total Value', compute='_compute_totals', store=True, digits=(16, 2))

    last_updated = fields.Datetime(string='Last Updated')

    @api.depends('main_qty', 'fbf_qty', 'cost_price')
    def _compute_totals(self):
        for rec in self:
            rec.total_qty = (rec.main_qty or 0.0) + (rec.fbf_qty or 0.0)
            rec.total_valuation = rec.total_qty * (rec.cost_price or 0.0)

    # ─────────────────────────────────────────────────────────────────────────
    #  Recalculate Action – called from list-header button
    #  NOTE: NO @api.model here. Odoo calls this as an instance method from
    #  the header button, passing the (possibly empty) recordset as self.
    # ─────────────────────────────────────────────────────────────────────────
    def action_recalculate(self):
        """
        1. Delete all old valuation rows.
        2. Walk every quant in the Main Warehouse (fallback: first warehouse).
        3. Walk every FBF stock record with qty_live > 0 and product_id set.
        4. For each product recursively explode Phantom BOMs.
        5. Accumulate per base-component and write rows.
        """
        # Use env from self so it works whether called from button or script
        ValModel = self.env['flipkart.stock.valuation']
        ValModel.search([]).unlink()

        # ── Identify Main Warehouse ───────────────────────────────────────
        main_wh = self.env['stock.warehouse'].search([], limit=1)
        if not main_wh:
            raise UserError(_("No warehouse found in the system."))

        main_location_id = main_wh.lot_stock_id.id
        bom_cache = {}       # product_id -> BOM row (id,) or None
        result = {}          # product_id -> {'main': qty, 'fbf': qty}

        def add(prod_id, qty, source):
            if prod_id not in result:
                result[prod_id] = {'main': 0.0, 'fbf': 0.0}
            result[prod_id][source] += qty

        def explode(product_id, qty):
            """Recursively explode Phantom BOMs. Returns {comp_id: exploded_qty}."""
            if product_id not in bom_cache:
                self.env.cr.execute(
                    """
                    SELECT id FROM mrp_bom
                    WHERE (product_id = %s
                           OR product_tmpl_id = (
                               SELECT product_tmpl_id
                               FROM product_product WHERE id = %s))
                      AND type = 'phantom'
                      AND active = True
                    LIMIT 1
                    """,
                    (product_id, product_id),
                )
                bom_cache[product_id] = self.env.cr.fetchone()

            bom_row = bom_cache[product_id]
            if bom_row:
                bom_id = bom_row[0]
                self.env.cr.execute(
                    "SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s",
                    (bom_id,),
                )
                lines = self.env.cr.fetchall()
                if lines:
                    out = {}
                    for comp_id, comp_qty in lines:
                        sub = explode(comp_id, qty * (comp_qty or 1.0))
                        for k, v in sub.items():
                            out[k] = out.get(k, 0.0) + v
                    return out

            # No phantom BOM – treat as a leaf component
            return {product_id: qty}

        # ── Main Warehouse quants ─────────────────────────────────────────
        quants = self.env['stock.quant'].search([
            ('location_id', 'child_of', main_location_id),
            ('quantity', '>', 0),
        ])
        for q in quants:
            for comp_id, comp_qty in explode(q.product_id.id, q.quantity).items():
                add(comp_id, comp_qty, 'main')

        # ── FBF Inventory ─────────────────────────────────────────────────
        fbf_records = self.env['flipkart.fbf.stock'].search([
            ('qty_live', '>', 0),
            ('product_id', '!=', False),
        ])
        for fbf in fbf_records:
            for comp_id, comp_qty in explode(fbf.product_id.id, fbf.qty_live).items():
                add(comp_id, comp_qty, 'fbf')

        # ── Create valuation rows ─────────────────────────────────────────
        now = fields.Datetime.now()
        to_create = []
        for prod_id, qtys in result.items():
            prod = self.env['product.product'].browse(prod_id)
            cost = prod.standard_price or 0.0
            main_q = qtys['main']
            fbf_q = qtys['fbf']
            to_create.append({
                'product_id': prod_id,
                'main_qty': main_q,
                'main_valuation': main_q * cost,
                'fbf_qty': fbf_q,
                'fbf_valuation': fbf_q * cost,
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
