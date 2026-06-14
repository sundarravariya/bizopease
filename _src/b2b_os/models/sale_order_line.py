# -*- coding: utf-8 -*-
from odoo import api, models, fields


class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    b2b_product_cost = fields.Float(
        string='Cost Price',
        related='product_id.standard_price',
        readonly=True,
        store=False,
    )

    b2b_product_image = fields.Image(
        string='Image',
        related='product_template_id.image_128',
        readonly=True,
        store=False,
        max_width=64,
        max_height=64,
    )

    def _b2b_is_stock_clearance(self):
        self.ensure_one()
        product_template = self.product_id.product_tmpl_id or self.product_template_id
        return bool(product_template and product_template._b2b_is_stock_clearance())

    def _b2b_should_hide_price(self):
        self.ensure_one()
        if self.display_type:
            return False
        if self.order_id.state in ('sale', 'done'):
            return False
        if self._b2b_is_stock_clearance():
            return False
        partner = self.order_id.partner_id.commercial_partner_id
        return bool(partner and partner.b2b_website_price_mode == 'hide')

    def _b2b_portal_should_hide_price(self):
        self.ensure_one()
        if self.display_type:
            return False
        return not self.order_id._b2b_portal_should_show_prices() and not self._b2b_is_stock_clearance()

    def _b2b_apply_customer_discount(self):
        for line in self:
            if not line.order_id or line.display_type or line.is_delivery:
                continue
            target_discount = line.order_id._b2b_target_discount_for_product(line.product_id)
            if abs((line.discount or 0.0) - target_discount) > 0.0001:
                line.discount = target_discount

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        lines._b2b_apply_customer_discount()
        if self.env.user and not self.env.user.share and not self.env.user._is_public():
            lines.mapped('order_id')._b2b_mark_pricing_accepted()
        return lines

    def write(self, vals):
        res = super().write(vals)
        if any(key in vals for key in ('product_id', 'product_template_id', 'order_id', 'discount')):
            self._b2b_apply_customer_discount()
        if (
            self.env.user
            and not self.env.user.share
            and not self.env.user._is_public()
            and any(key in vals for key in ('product_id', 'product_template_id', 'price_unit', 'discount', 'tax_id', 'product_uom_qty', 'name'))
        ):
            self.mapped('order_id')._b2b_mark_pricing_accepted()
        return res

    @api.onchange('product_id', 'product_template_id')
    def _onchange_b2b_customer_discount(self):
        self._b2b_apply_customer_discount()
