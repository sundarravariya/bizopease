# -*- coding: utf-8 -*-

from odoo import api, models


class WebsiteSnippetFilter(models.Model):
    _inherit = 'website.snippet.filter'

    @api.model
    def _get_products(self, mode, **kwargs):
        if self.model_name != 'product.product':
            return super()._get_products(mode, **kwargs)

        search_domain = list(self.env.context.get('search_domain') or [])
        search_domain.append(('product_tmpl_id.website_published', '=', True))
        return super(
            WebsiteSnippetFilter,
            self.with_context(search_domain=search_domain)
        )._get_products(mode, **kwargs)

    def _filter_records_to_values(self, records, is_sample=False):
        values = super()._filter_records_to_values(records, is_sample=is_sample)
        if self.model_name != 'product.product' or is_sample:
            return values

        for item in values:
            product = item.get('_record')
            if not product:
                continue
            product_variant = product if product.is_product_variant else product.product_variant_id
            product_template = product_variant.product_tmpl_id
            combination_info = (
                product_variant._get_combination_info_variant()
                if product_variant.is_product_variant
                else product_variant._get_combination_info()
            )
            item.update({
                'product_id': product_variant.id,
                'product_template_id': product_template.id,
                'product_display_name': product_template.name,
                'website_published': product_template.website_published,
                'b2b_hide_price': combination_info.get('b2b_hide_price', False),
                'price': combination_info.get('price'),
                'list_price': combination_info.get('list_price'),
                'has_discounted_price': combination_info.get('has_discounted_price'),
            })
        return values
