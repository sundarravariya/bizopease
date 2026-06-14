# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) Sitaram Solutions (<https://sitaramsolutions.in/>).
#
#    For Module Support : info@sitaramsolutions.in  or Skype : contact.hiren1188
#
##############################################################################

import re
from odoo.osv import expression
from odoo import models, fields, api


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    product_barcode_ids = fields.One2many('sr.multi.barcode', 'product_tmpl_id', 'Multi Barcode')


class ProductProduct(models.Model):
    _inherit = 'product.product'

    product_barcode_ids = fields.One2many('sr.multi.barcode', 'product_id', 'Multi Barcode')

    @api.model
    def _search_display_name(self, operator, value):
        is_positive = operator not in expression.NEGATIVE_TERM_OPERATORS
        combine = expression.OR if is_positive else expression.AND
        domains = [
            [('name', operator, value)],
            [('default_code', operator, value)],
            [('product_barcode_ids', operator, value)],
            [('barcode', operator, value)],
        ]
        if operator in ('=', 'in') or (operator.endswith('like') and is_positive):
            barcode_values = [value] if operator != 'in' else value
            domains.append([('barcode', 'in', barcode_values)])
        if operator == '=' and isinstance(value, str) and (m := re.search(r'(\[(.*?)\])', value)):
            domains.append([('default_code', '=', m.group(2))])
        if partner_id := self.env.context.get('partner_id'):
            supplier_domain = [
                ('partner_id', '=', partner_id),
                '|',
                ('product_code', operator, value),
                ('product_name', operator, value),
            ]
            domains.append([('product_tmpl_id.seller_ids', 'any', supplier_domain)])

        return combine(domains)

    @api.model
    def name_search(self, name='', args=None, operator='ilike', limit=100):
        if not name:
            return super().name_search(name, args, operator, limit)
        # search progressively by the most specific attributes
        positive_operators = ['=', 'ilike', '=ilike', 'like', '=like']
        is_positive = operator not in expression.NEGATIVE_TERM_OPERATORS
        products = self.browse()
        domain = args or []

        if operator in positive_operators:
            products = self.search_fetch(expression.AND([domain, [('default_code', '=', name)]]), ['display_name'],
                                         limit=limit) \
                       or self.search_fetch(expression.AND([domain, [('barcode', '=', name)]]), ['display_name'],
                                            limit=limit)
        if not products:
            if is_positive:
                # Do not merge the 2 next lines into one single search, SQL search performance would be abysmal
                # on a database with thousands of matching products, due to the huge merge+unique needed for the
                # OR operator (and given the fact that the 'name' lookup results come from the ir.translation table
                # Performing a quick memory merge of ids in Python will give much better performance
                products = self.search_fetch(expression.AND([domain, [('default_code', operator, name)]]),
                                             ['display_name'], limit=limit)
                limit_rest = limit and limit - len(products)
                if limit_rest is None or limit_rest > 0:
                    products |= self.search_fetch(
                        expression.AND([domain, [('id', 'not in', products.ids)], [('name', operator, name)]]),
                        ['display_name'], limit=limit_rest)
            else:
                domain_neg = [
                    ('name', operator, name),
                    '|', ('default_code', operator, name), ('default_code', '=', False),
                ]
                products = self.search_fetch(expression.AND([domain, domain_neg]), ['display_name'], limit=limit)
        if not products and operator in positive_operators and (m := re.search(r'(\[(.*?)\])', name)):
            match_domain = [('default_code', '=', m.group(2))]
            products = self.search_fetch(expression.AND([domain, match_domain]), ['display_name'], limit=limit)
        if not products and (partner_id := self.env.context.get('partner_id')):
            # still no results, partner in context: search on supplier info as last hope to find something
            supplier_domain = [
                ('partner_id', '=', partner_id),
                '|',
                ('product_code', operator, name),
                ('product_name', operator, name),
            ]
            match_domain = [('product_tmpl_id.seller_ids', 'any', supplier_domain)]
            products = self.search_fetch(expression.AND([domain, match_domain]), ['display_name'], limit=limit)

        if not products:
            products = self.search_fetch(expression.AND([domain, [('product_barcode_ids', operator, name)]]), ['display_name'],
                                         limit=limit)
        return [(product.id, product.display_name) for product in products.sudo()]