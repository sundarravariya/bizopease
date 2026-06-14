# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) Sitaram Solutions (<https://sitaramsolutions.in/>).
#
#    For Module Support : info@sitaramsolutions.in  or Skype : contact.hiren1188
#
##############################################################################

from odoo import models, fields, api

class srMultiBarcode(models.Model):
    _name = 'sr.multi.barcode'
    _description = 'Multi Barcode'

    name = fields.Char('Barcode', required=True)
    product_tmpl_id = fields.Many2one('product.template', 'Product')
    product_id = fields.Many2one('product.product', 'Product Variant')

    _sql_constraints = [
        ('multi_barcode_unique', 'unique (name)', 'Barcode Must be different !')
    ]

    @api.onchange('product_id')
    def _onchange_product_id(self):
        if self.product_id:
            self.product_tmpl_id = self.product_id.product_tmpl_id

    @api.onchange('product_tmpl_id')
    def _onchange_product_tmpl_id(self):
        if self.product_tmpl_id and not self.product_id:
            variants = self.product_tmpl_id.product_variant_ids
            if len(variants) == 1:
                self.product_id = variants[0]

    @api.model
    def create(self, vals):
        if vals.get('product_id') and not vals.get('product_tmpl_id'):
            product = self.env['product.product'].browse(vals['product_id'])
            vals['product_tmpl_id'] = product.product_tmpl_id.id
        elif vals.get('product_tmpl_id') and not vals.get('product_id'):
            tmpl = self.env['product.template'].browse(vals['product_tmpl_id'])
            if len(tmpl.product_variant_ids) == 1:
                vals['product_id'] = tmpl.product_variant_ids.id
        return super(srMultiBarcode, self).create(vals)

    def write(self, vals):
        for rec in self:
            if 'product_id' in vals and not vals.get('product_tmpl_id'):
                product = self.env['product.product'].browse(vals['product_id'])
                vals['product_tmpl_id'] = product.product_tmpl_id.id
            elif 'product_tmpl_id' in vals and not vals.get('product_id'):
                tmpl = self.env['product.template'].browse(vals['product_tmpl_id'])
                if len(tmpl.product_variant_ids) == 1:
                    vals['product_id'] = tmpl.product_variant_ids.id
        return super(srMultiBarcode, self).write(vals)
