# -*- coding: utf-8 -*-
from odoo import models, api, fields


class BizNativeSalesMixin(models.AbstractModel):
    """Shared helpers for sourcing sold-units from NATIVE Odoo sales
    (sale.order.line) and exploding phantom BOM kits into their components,
    so analytics align component-level sales with component-level stock."""
    _name = 'biz.native.sales.mixin'
    _description = 'Native Sales Source Mixin'

    def _explode_phantom(self, product_id, qty, results_map):
        """Recursively explode active phantom BOMs into base components.
        Accumulates leaf component qty into results_map."""
        self.env.cr.execute(
            """
            SELECT id FROM mrp_bom
            WHERE (product_id = %s
                   OR product_tmpl_id = (SELECT product_tmpl_id FROM product_product WHERE id = %s))
              AND type = 'phantom' AND active = True
            LIMIT 1
            """,
            (product_id, product_id),
        )
        res = self.env.cr.fetchone()
        if res:
            self.env.cr.execute(
                "SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s", (res[0],))
            lines = self.env.cr.fetchall()
            if lines:
                for comp_id, comp_qty in lines:
                    self._explode_phantom(comp_id, qty * (comp_qty or 1.0), results_map)
                return
        results_map[product_id] = results_map.get(product_id, 0.0) + qty

    def _native_sold_units(self, date_from):
        """Return {product_id: sold_units} from confirmed native sales since
        date_from. Uses delivered qty (realized outbound), exploding phantom
        kits so the units land on the same components dead-stock/reorder walk."""
        SaleLine = self.env['sale.order.line']
        lines = SaleLine.search([
            ('order_id.state', 'in', ['sale', 'done']),
            ('order_id.date_order', '>=', fields.Datetime.to_datetime(date_from)),
            ('product_id', '!=', False),
            ('display_type', '=', False),
        ])
        product_sales = {}
        for line in lines:
            # Prefer delivered qty; fall back to ordered qty when delivery isn't tracked.
            sold = line.qty_delivered or line.product_uom_qty or 0.0
            if sold <= 0:
                continue
            self._explode_phantom(line.product_id.id, sold, product_sales)
        return product_sales
