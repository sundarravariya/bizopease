# -*- coding: utf-8 -*-
from difflib import SequenceMatcher
import re

from odoo import http
from odoo.addons.website.controllers.main import Website
from odoo.http import request
from werkzeug.urls import url_encode


class B2BWebsiteSearch(Website):
    def _b2b_normalize_search(self, text):
        return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()

    def _b2b_is_subsequence(self, needle, haystack):
        if len(needle) < 3:
            return False
        iterator = iter(haystack)
        return all(char in iterator for char in needle)

    def _b2b_loose_score(self, needle, haystack):
        needle = self._b2b_normalize_search(needle)
        words = self._b2b_normalize_search(haystack).split()
        if not needle or not words:
            return 0.0
        best = 0.0
        for term in needle.split():
            for word in words:
                if term in word:
                    best = max(best, 1.0)
                elif self._b2b_is_subsequence(term, word):
                    best = max(best, 0.82)
                else:
                    best = max(best, SequenceMatcher(None, term, word).ratio())
        return best

    def _b2b_category_score(self, search_term, category):
        return self._b2b_loose_score(search_term, ' '.join(filter(None, [
            category.name,
            category.parent_id.name,
        ])))

    def _b2b_find_matching_categories(self, categories, search_term):
        direct = categories.filtered(lambda cat: search_term.lower() in (cat.name or '').lower())
        scored = []
        for category in categories:
            score = self._b2b_category_score(search_term, category)
            if score >= 0.33:
                scored.append((score, category.id))
        scored.sort(key=lambda item: (-item[0], item[1]))

        ordered_ids = list(dict.fromkeys(direct.ids + [category_id for _score, category_id in scored[:8]]))
        return categories.browse(ordered_ids)

    def _b2b_find_matching_products(self, website, search_term, limit=12):
        product_model = request.env['product.template'].sudo().with_context(website_id=website.id)
        base_domain = [
            ('website_published', '=', True),
            ('sale_ok', '=', True),
            '|', ('website_id', '=', False), ('website_id', '=', website.id),
        ]
        candidates = product_model.search(base_domain, limit=500, order='website_sequence desc, id desc')
        scored = []
        lowered = (search_term or '').lower()
        for product in candidates:
            haystack = product._b2b_search_blob()
            score = product._b2b_loose_search_score(search_term, haystack)
            if lowered and lowered in haystack.lower():
                score = max(score, 1.0)
            if score >= 0.33:
                scored.append((score, product.id))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return product_model.browse([product_id for _score, product_id in scored[:limit]])

    @http.route('/website/snippet/autocomplete', type='json', auth='public', website=True, readonly=True)
    def autocomplete(self, search_type=None, term=None, order=None, limit=5, max_nb_chars=999, options=None):
        options = dict(options or {})
        options.update({
            'allowFuzzy': True,
            'displayImage': True,
            'displayDescription': False,
            'displayDetail': True,
            'displayExtraLink': False,
        })
        limit = int(limit or 5)
        max_nb_chars = int(max_nb_chars or 999)
        return super().autocomplete(
            search_type='products',
            term=(term or '').strip(),
            order=order,
            limit=limit,
            max_nb_chars=max_nb_chars,
            options=options,
        )

    @http.route('/b2b/search/cart_meta', type='json', auth='public', website=True, readonly=True)
    def b2b_search_cart_meta(self, template_id=None):
        template = request.env['product.template'].sudo().browse(int(template_id or 0)).exists()
        if not template:
            return {}
        product = template.product_variant_id or template._get_first_possible_variant_id()
        product_id = product.id if hasattr(product, 'id') else int(product or 0)
        return {
            'template_id': template.id,
            'product_id': product_id,
        }

    @http.route([
        '/website/search',
        '/website/search/page/<int:page>',
        '/website/search/<string:search_type>',
        '/website/search/<string:search_type>/page/<int:page>',
    ], type='http', auth='public', website=True, sitemap=False, readonly=True)
    def hybrid_list(self, page=1, search='', search_type='all', **kw):
        if search:
            return request.redirect('/shop?%s' % url_encode({'search': search}))
        return request.redirect('/shop')

    @http.route(['/shop/categories'], type='http', auth='public', website=True, sitemap=True)
    def b2b_shop_categories(self, search='', **kw):
        website = request.website
        category_model = request.env['product.public.category'].sudo()
        base_category_domain = [
            ('parent_id', '=', False),
            '|', ('website_id', '=', False), ('website_id', '=', website.id),
        ]

        search_term = (search or '').strip()
        categories = category_model.search(base_category_domain, order='sequence, name')
        matching_categories = categories
        matching_products = request.env['product.template'].sudo().browse()
        highlighted_category = category_model.browse()

        if search_term:
            matching_categories = self._b2b_find_matching_categories(categories, search_term)
            highlighted_category = matching_categories[:1]
            matching_products = self._b2b_find_matching_products(website, search_term, limit=12)

        return request.render('b2b_os.b2b_all_categories_page', {
            'categories': categories,
            'matching_categories': matching_categories,
            'matching_products': matching_products,
            'highlighted_category': highlighted_category,
            'search_term': search_term,
        })

    @http.route(['/shop/stock-clearance'], type='http', auth='public', website=True, sitemap=True)
    def b2b_stock_clearance(self, **kw):
        website = request.website
        products = request.env['product.template'].b2b_get_stock_clearance_products(website=website)
        return request.render('b2b_os.b2b_stock_clearance_page', {
            'products': products,
        })
