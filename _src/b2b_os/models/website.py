# -*- coding: utf-8 -*-
from odoo import models
from odoo.osv import expression


class Website(models.Model):
    _inherit = 'website'

    def sale_product_domain(self):
        return expression.AND([
            super().sale_product_domain(),
            [('website_published', '=', True)],
        ])

    def _search_get_details(self, search_type, order, options):
        if search_type in ('all', 'pages', 'products', 'product', 'products_only'):
            options = dict(options or {})
            options.setdefault('displayImage', True)
            options.setdefault('displayDescription', True)
            options.setdefault('displayDetail', True)
            options.setdefault('displayExtraLink', True)
            return [self.env['product.template']._search_get_detail(self, order, options)]
        return super()._search_get_details(search_type, order, options)
