# -*- coding: utf-8 -*-
from odoo import models, fields, api

class FlipkartConsignmentLine(models.Model):
    _name = 'flipkart.consignment.line'
    _description = 'Flipkart Consignment Line'
    _rec_name = 'sku_id'

    consignment_id = fields.Many2one('flipkart.consignment', string='Consignment', required=True, ondelete='cascade')
    
    product_name = fields.Char(string='Product Name')
    fsn = fields.Char(string='FSN')
    sku_id = fields.Char(string='SKU Id')
    brand = fields.Char(string='Brand')
    size = fields.Char(string='Size')
    style_code = fields.Char(string='Style Code')
    color = fields.Char(string='Color')
    isbn = fields.Char(string='Isbn')
    model_id = fields.Char(string='Model Id')
    quantity_sent = fields.Integer(string='Quantity Sent')
    quantity_received = fields.Integer(string='Quantity Received')

    box_line_ids = fields.One2many('flipkart.box.line', 'consignment_line_id', string='Box Lines')
    qty_allocated = fields.Integer(compute='_compute_qty_remaining', store=True)
    qty_remaining = fields.Integer(compute='_compute_qty_remaining', store=True)

    @api.depends('box_line_ids', 'box_line_ids.quantity', 'quantity_sent')
    def _compute_qty_remaining(self):
        for rec in self:
            allocated = sum(rec.box_line_ids.mapped('quantity'))
            rec.qty_allocated = allocated
            rec.qty_remaining = rec.quantity_sent - allocated
    inwarded_to_store = fields.Char(string='Inwarded to Store')
    qc_fail = fields.Char(string='QC Fail')
    qc_in_progress = fields.Char(string='QC In Progress')
    qc_passed = fields.Char(string='QC Passed')
    cost_price = fields.Float(string='Cost Price')
    length_cm = fields.Float(string='Length(In cms)')
    breadth_cm = fields.Float(string='Breadth(In cms)')
    height_cm = fields.Float(string='Height(In cms)')
    weight_kg = fields.Float(string='Weight(In kgs)')

    def get_label_range(self):
        return range(self.quantity_sent)
