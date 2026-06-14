# -*- coding: utf-8 -*-
import re
from difflib import SequenceMatcher

from odoo import api, fields, models
from odoo.http import request
from odoo.osv import expression


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    b2b_stock_clearance = fields.Boolean(
        string='Stock Clearance',
        default=False,
        help='Show this product in the stock clearance block and bypass customer discount/hide rules.',
    )

    @api.model
    def default_get(self, fields_list):
        defaults = super().default_get(fields_list)
        if 'website_published' in fields_list and 'website_published' not in defaults:
            defaults['website_published'] = True
        return defaults

    @api.model
    def _b2b_get_stock_clearance_category(self):
        category = self.env['product.public.category'].sudo().search(
            [('name', '=', 'Stock Clearance')],
            limit=1,
        )
        if not category:
            category = self.env['product.public.category'].sudo().create({
                'name': 'Stock Clearance',
            })
        return category

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            vals.setdefault('website_published', True)
        products = super().create(vals_list)
        products._b2b_sync_stock_clearance_category()
        return products

    def write(self, vals):
        result = super().write(vals)
        if 'b2b_stock_clearance' in vals:
            self._b2b_sync_stock_clearance_category()
        return result

    def _b2b_sync_stock_clearance_category(self):
        category = self._b2b_get_stock_clearance_category()
        for product in self.sudo():
            if product.b2b_stock_clearance:
                if category not in product.public_categ_ids:
                    product.public_categ_ids = [(4, category.id)]
            else:
                if category in product.public_categ_ids:
                    product.public_categ_ids = [(3, category.id)]

    def _b2b_is_stock_clearance(self):
        self.ensure_one()
        clearance_names = {name.strip().lower() for name in self.public_categ_ids.mapped('name') if name}
        clearance_tags = {name.strip().lower() for name in self.product_tag_ids.mapped('name') if name}
        return (
            bool(self.b2b_stock_clearance)
            or 'stock clearance' in clearance_names
            or 'stock clearance' in clearance_tags
        )

    @api.model
    def _b2b_stock_clearance_domain(self, website=None):
        domain = [('sale_ok', '=', True), ('website_published', '=', True)]
        if website:
            domain.extend(['|', ('website_id', '=', False), ('website_id', '=', website.id)])
        return domain

    @api.model
    def b2b_get_stock_clearance_products(self, website=None, limit=None):
        website = website or self.env['website'].get_current_website()
        products = self.sudo().with_context(website_id=website.id).search(
            self._b2b_stock_clearance_domain(website),
            order='website_sequence desc, create_date desc, id desc',
        )
        products = products.filtered(lambda p: p._b2b_is_stock_clearance())
        return products[:limit] if limit else products

    @api.model
    def _b2b_get_current_partner_pricing_policy(self, website=None):
        partner = False
        try:
            if request and getattr(request, 'website', None):
                order = request.website.sale_get_order()
                if order and order.partner_id:
                    partner = order.partner_id.commercial_partner_id
                elif request.env.user and not request.env.user._is_public():
                    partner = request.env.user.partner_id.commercial_partner_id
        except Exception:
            partner = False

        if not partner and self.env.user and not self.env.user._is_public():
            partner = self.env.user.partner_id.commercial_partner_id

        if not partner:
            return {
                'mode': 'show',
                'discount_percent': 0.0,
                'hide_prices': False,
            }
        return partner._b2b_get_website_pricing_policy()

    @api.model
    def _b2b_apply_price_policy(self, price, list_price=None, has_discounted_price=False):
        if isinstance(price, dict):
            return price

        if self and len(self) == 1 and self._b2b_is_stock_clearance():
            return {
                'price': price,
                'list_price': list_price,
                'has_discounted_price': has_discounted_price,
                'b2b_hide_price': False,
                'b2b_policy_applied': True,
                'b2b_stock_clearance': True,
            }

        policy = self._b2b_get_current_partner_pricing_policy()
        if policy['hide_prices']:
            return {
                'price': price,
                'list_price': list_price,
                'has_discounted_price': has_discounted_price,
                'b2b_hide_price': True,
                'b2b_policy_applied': True,
                'b2b_stock_clearance': False,
            }

        discount = policy['discount_percent']
        if discount <= 0 or price in (None, False):
            return {
                'price': price,
                'list_price': list_price,
                'has_discounted_price': has_discounted_price,
                'b2b_hide_price': False,
                'b2b_policy_applied': True,
                'b2b_stock_clearance': False,
            }

        discounted_price = price * (1.0 - (discount / 100.0))
        original_price = price
        effective_list_price = list_price or original_price
        if effective_list_price <= discounted_price:
            effective_list_price = original_price
        return {
            'price': discounted_price,
            'list_price': effective_list_price,
            'has_discounted_price': True,
            'b2b_hide_price': False,
            'b2b_policy_applied': True,
            'b2b_stock_clearance': False,
        }

    def _get_sales_prices(self, website):
        prices = super()._get_sales_prices(website)
        for template in self:
            template_price_vals = prices.get(template.id)
            if template_price_vals:
                adjusted = template._b2b_apply_price_policy(
                    template_price_vals.get('price_reduce'),
                    template_price_vals.get('base_price'),
                    template_price_vals.get('has_discounted_price', False),
                )
                template_price_vals['price_reduce'] = adjusted['price']
                template_price_vals['base_price'] = adjusted['list_price']
                template_price_vals['has_discounted_price'] = adjusted['has_discounted_price']
                template_price_vals['b2b_hide_price'] = adjusted['b2b_hide_price']
        return prices

    def _get_combination_info(self, *args, **kwargs):
        combination_info = super()._get_combination_info(*args, **kwargs)
        if combination_info.get('b2b_policy_applied'):
            return combination_info
        adjusted = self._b2b_apply_price_policy(
            combination_info.get('price'),
            combination_info.get('list_price'),
            combination_info.get('has_discounted_price', False),
        )
        combination_info.update(adjusted)
        return combination_info

    def _search_render_results_prices(self, mapping, combination_info):
        if combination_info.get('b2b_hide_price'):
            return '', None
        return super()._search_render_results_prices(mapping, combination_info)

    def _search_render_results(self, fetch_fields, mapping, icon, limit):
        results_data = super()._search_render_results(fetch_fields, mapping, icon, limit)
        for product, data in zip(self, results_data):
            combination_info = product._get_combination_info(only_template=True)
            data['b2b_hide_price'] = combination_info.get('b2b_hide_price', False)
            data['product_template_id'] = product.id
            data['product_id'] = product._get_first_possible_variant_id()
            data['detail'] = '' if combination_info.get('b2b_hide_price') else data.get('detail')
        return results_data

    @api.model
    def _search_get_detail(self, website, order, options):
        detail = super()._search_get_detail(website, order, options)
        for field_name in (
            'description_sale',
            'description_ecommerce',
            'product_variant_ids.barcode',
            'public_categ_ids.name',
        ):
            if field_name not in detail['search_fields']:
                detail['search_fields'].append(field_name)
        for field_name in ('description_ecommerce',):
            if field_name not in detail['fetch_fields']:
                detail['fetch_fields'].append(field_name)
        return detail

    @api.model
    def _b2b_search_extra(self, env, search_term):
        return [
            '|',
            ('description_sale', 'ilike', search_term),
            ('description_ecommerce', 'ilike', search_term),
        ]

    @api.model
    def _search_fetch(self, search_detail, search, limit, order):
        return super()._search_fetch(search_detail, search, limit, order)

    @api.model
    def _b2b_loose_search_score(self, needle, haystack):
        needle = self._b2b_normalize_search_text(needle)
        normalized_haystack = self._b2b_normalize_search_text(haystack)
        words = normalized_haystack.split()
        if not needle or not words:
            return 0.0
        compact_haystack = ''.join(words)
        terms = needle.split()
        term_scores = []
        for term in terms:
            best = 0.0
            for word in words:
                if term in word:
                    best = max(best, 1.0)
                elif word.startswith(term) or term.startswith(word):
                    best = max(best, 0.94)
                elif SequenceMatcher(None, term, word).ratio() >= 0.72:
                    best = max(best, 0.88)
                elif self._b2b_is_subsequence(term, word):
                    best = max(best, 0.82)
                else:
                    best = max(best, SequenceMatcher(None, term, word).ratio())
            if term in compact_haystack:
                best = max(best, 0.96)
            elif self._b2b_is_subsequence(term, compact_haystack):
                best = max(best, 0.86)
            else:
                best = max(best, SequenceMatcher(None, term, compact_haystack).ratio())
            term_scores.append(best)
        return sum(term_scores) / len(term_scores) if term_scores else 0.0

    def _b2b_search_blob(self):
        self.ensure_one()
        return ' '.join(filter(None, [
            self.name or '',
            self.default_code or '',
            self.website_description or '',
            self.description_sale or '',
            self.description_ecommerce or '',
            ' '.join(self.public_categ_ids.mapped('name')),
            ' '.join(filter(None, self.product_variant_ids.mapped('default_code'))),
            ' '.join(filter(None, self.product_variant_ids.mapped('barcode'))),
        ]))

    @api.model
    def b2b_fuzzy_search_products(self, search, domain=None, limit=20, order=None, website=None):
        search = (search or '').strip()
        if not search:
            return self.browse()

        context = dict(self.env.context)
        if website:
            context['website_id'] = website.id
        model = self.sudo().with_context(**context)
        domain = expression.AND([list(domain or [])]) if domain else []
        candidates = model.search(
            domain,
            limit=max((limit or 20) * 80, 1200),
            order=order or 'website_sequence desc, id desc',
        )
        scored = []
        normalized_search = self._b2b_normalize_search_text(search)
        for product in candidates:
            haystack = product._b2b_search_blob()
            score = product._b2b_loose_search_score(search, haystack)
            normalized_haystack = self._b2b_normalize_search_text(haystack)
            if normalized_search and normalized_search in normalized_haystack:
                score = max(score, 1.0)
            if score >= 0.33:
                scored.append((score, product.id))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return model.browse([product_id for _score, product_id in scored[:limit]])

    @staticmethod
    def _b2b_normalize_search_text(text):
        return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()

    @staticmethod
    def _b2b_is_subsequence(needle, haystack):
        if len(needle) < 3:
            return False
        iterator = iter(haystack)
        return all(char in iterator for char in needle)


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def _get_combination_info_variant(self, *args, **kwargs):
        combination_info = super()._get_combination_info_variant(*args, **kwargs)
        if combination_info.get('b2b_policy_applied'):
            return combination_info
        adjusted = self.product_tmpl_id._b2b_apply_price_policy(
            combination_info.get('price'),
            combination_info.get('list_price'),
            combination_info.get('has_discounted_price', False),
        )
        combination_info.update(adjusted)
        return combination_info

    def _get_combination_info(self, *args, **kwargs):
        combination_info = super()._get_combination_info(*args, **kwargs)
        if combination_info.get('b2b_policy_applied'):
            return combination_info
        adjusted = self.product_tmpl_id._b2b_apply_price_policy(
            combination_info.get('price'),
            combination_info.get('list_price'),
            combination_info.get('has_discounted_price', False),
        )
        combination_info.update(adjusted)
        return combination_info
