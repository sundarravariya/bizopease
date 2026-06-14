from odoo import models, fields, api

class ProductQuantityPrice(models.Model):
    _name = 'product.quantity.price'
    _description = 'Quantity Based Price'
    _rec_name = 'product_tmpl_id'

    product_tmpl_id = fields.Many2one('product.template', string='Product', required=True, ondelete='cascade')
    qty_from = fields.Integer(string='From Qty', required=True)
    qty_to = fields.Integer(string='To Qty')
    price = fields.Float(string='Sale Price', required=True)
    price_text = fields.Char(string='Price Display', compute='_compute_price_text')
    bracket_label = fields.Char(string='Bracket', compute='_compute_bracket_label', store=True)

    @api.depends('qty_from', 'qty_to')
    def _compute_bracket_label(self):
        for rec in self:
            if rec.qty_to:
                rec.bracket_label = f"{rec.qty_from}-{rec.qty_to}"
            else:
                rec.bracket_label = f"{rec.qty_from}+"

    @api.depends('price')
    def _compute_price_text(self):
        for rec in self:
            rec.price_text = f"{rec.price:.2f}"

    @api.model
    def read_group(self, domain, fields, groupby, offset=0, limit=None, orderby=False, lazy=True):
        """Override to prevent price aggregation"""
        # Remove price from fields to prevent aggregation calculation
        original_fields = fields[:]
        if 'price' in fields:
            fields = [f for f in fields if f != 'price']
        
        result = super().read_group(domain, fields, groupby, offset, limit, orderby, lazy)
        
        # Remove price aggregation from results
        for group in result:
            if 'price' in group:
                del group['price']
        
        return result

    def name_get(self):
        result = []
        for record in self:
            name = f"{record.product_tmpl_id.name} - {record.bracket_label}"
            result.append((record.id, name))
        return result

    @api.model
    def _name_search(self, name='', args=None, operator='ilike', limit=100, name_get_uid=None):
        args = args or []
        if name:
            product_ids = self.env['product.template'].search([('name', operator, name)]).ids
            if product_ids:
                args = ['|'] + args + [('product_tmpl_id', 'in', product_ids)]
        
        return self._search(args, limit=limit, access_rights_uid=name_get_uid)

class ProductTemplate(models.Model):
    _inherit = 'product.template'

    quantity_price_ids = fields.One2many('product.quantity.price', 'product_tmpl_id', string='Quantity Prices')

class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    @api.onchange('product_id', 'product_uom_qty')
    def _onchange_product_uom_qty(self):
        if self.product_id and self.product_uom_qty:
            pricing = self.product_id.product_tmpl_id.quantity_price_ids.filtered(
                lambda p: p.qty_from <= self.product_uom_qty and 
                         (not p.qty_to or p.qty_to >= self.product_uom_qty)
            )
            if pricing:
                self.price_unit = pricing.sorted(key=lambda p: p.qty_from, reverse=True)[0].price
