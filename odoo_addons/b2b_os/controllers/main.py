# -*- coding: utf-8 -*-

import base64
from odoo import http, _
from odoo.http import request
from odoo.addons.website_sale.controllers.main import WebsiteSale
from odoo.addons.sale.controllers.portal import CustomerPortal
from odoo.addons.auth_signup.controllers.main import AuthSignupHome


class WebsiteSaleB2B(WebsiteSale):
    """
    B2B OS: Override the payment step to skip payment entirely.
    """
    def _shop_lookup_products(self, attrib_set, options, post, search, website):
        fuzzy_search_term, product_count, search_result = super()._shop_lookup_products(
            attrib_set, options, post, search, website
        )
        if not search or product_count:
            return fuzzy_search_term, product_count, search_result

        safe_domain = self._get_shop_domain(
            '',
            options.get('category'),
            options.get('attrib_values'),
            search_in_description=True,
        )
        fallback_results = request.env['product.template'].b2b_fuzzy_search_products(
            search,
            domain=safe_domain,
            limit=20,
            order=self._get_search_order(post),
            website=website,
        ).with_context(bin_size=True)
        if not fallback_results:
            return fuzzy_search_term, product_count, search_result
        return False, len(fallback_results), fallback_results

    def _b2b_prepare_checkout_order(self, order):
        order = order.sudo()
        values = {}
        if order.partner_shipping_id and order.partner_invoice_id != order.partner_shipping_id:
            values['partner_invoice_id'] = order.partner_shipping_id.id
        if values:
            order.write(values)

        if order._has_deliverable_products():
            available_dms = order._get_delivery_methods()
            if available_dms:
                delivery_method = order._get_preferred_delivery_method(available_dms) or available_dms[:1]
                if delivery_method:
                    rate = delivery_method.rate_shipment(order)
                    order._set_delivery_method(delivery_method, rate=rate)
        return order

    @http.route(['/shop/checkout'], type='http', auth='public', website=True, sitemap=False)
    def shop_checkout(self, try_skip_step=None, **query_params):
        order = request.website.sale_get_order()
        if order:
            self._b2b_prepare_checkout_order(order)
        return super().shop_checkout(try_skip_step=try_skip_step, **query_params)

    @http.route(['/shop/payment'], type='http', auth='public', website=True, sitemap=False)
    def shop_payment(self, **post):
        order = request.website.sale_get_order()
        if not order or not order.website_order_line:
            return request.redirect('/shop')
        return request.render('b2b_os.b2b_order_submit_page', {
            'order': order,
            'website_sale_order': order,
        })

    @http.route(['/shop/cart/update_json'], type='json', auth='public', methods=['POST'], website=True, csrf=False)
    def cart_update_json(self, product_id=None, line_id=None, add_qty=None, set_qty=None, display=True, product_custom_attribute_values=None, no_variant_attribute_values=None, **kw):
        response = super().cart_update_json(
            product_id=product_id,
            line_id=line_id,
            add_qty=add_qty,
            set_qty=set_qty,
            display=display,
            product_custom_attribute_values=product_custom_attribute_values,
            no_variant_attribute_values=no_variant_attribute_values,
            **kw,
        )

        product = request.env['product.product'].sudo().browse(int(product_id)) if product_id else request.env['product.product']
        if not product and line_id:
            order_line = request.env['sale.order.line'].sudo().browse(int(line_id))
            product = order_line.product_id
        partner = request.website.sale_get_order().partner_id.commercial_partner_id if request.website.sale_get_order() else False
        hide_price = bool(
            partner
            and partner.b2b_website_price_mode == 'hide'
            and product
            and not product.product_tmpl_id._b2b_is_stock_clearance()
        )

        notification_info = response.get('notification_info') if isinstance(response, dict) else None
        if isinstance(notification_info, dict):
            if isinstance(notification_info.get('line'), dict):
                notification_info['line']['b2b_hide_price'] = hide_price
            if isinstance(notification_info.get('lines'), list):
                for line in notification_info['lines']:
                    if isinstance(line, dict):
                        line['b2b_hide_price'] = hide_price
        return response

    @http.route(['/b2b/submit-request'], type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def b2b_submit_request(self, customer_note='', **post):
        order = request.website.sale_get_order()
        if not order or not order.website_order_line:
            return request.redirect('/shop')

        order_ref = order
        if customer_note:
            order_ref.sudo().write({'note': customer_note})

        b2b_tag = request.env['crm.tag'].sudo().search([('name', '=', 'B2B Request')], limit=1)
        if not b2b_tag:
            b2b_tag = request.env['crm.tag'].sudo().create({'name': 'B2B Request'})
        
        # Strip delivery
        delivery_lines = order_ref.order_line.filtered(lambda l: l.is_delivery)
        if delivery_lines:
            delivery_lines.sudo().unlink()
            
        order_ref.sudo().write({
            'tag_ids': [(4, b2b_tag.id)],
            'website_id': False,
            'carrier_id': False,
        })

        if request.env.user and not request.env.user._is_public():
            request.env.user.partner_id.sudo().write({'last_website_so_id': False})
            order_ref.sudo().message_subscribe(partner_ids=[request.env.user.partner_id.id])

        request.session.pop('sale_order_id', None)
        request.website.sale_reset()

        return request.render('b2b_os.b2b_order_success_page', {'order': order_ref})


class CustomCustomerPortal(CustomerPortal):
    def _b2b_add_order_lines_to_cart(self, order):
        website = request.website
        cart = website.sale_get_order(force_create=True)
        for line in order.order_line.filtered(lambda l: not l.display_type and l.product_id and l.product_uom_qty > 0):
            cart._cart_update(
                product_id=line.product_id.id,
                add_qty=line.product_uom_qty,
            )
        return cart

    def _get_portal_sale_order(self, order_id):
        partner = request.env.user.partner_id.commercial_partner_id
        return request.env['sale.order'].sudo().search([
            ('id', '=', order_id),
            ('partner_id', 'child_of', [partner.id]),
        ], limit=1)

    def _b2b_get_sale_order_from_move(self, move):
        if not move:
            return request.env['sale.order']

        partner = request.env.user.partner_id.commercial_partner_id
        sale_order = move.invoice_line_ids.sale_line_ids.order_id.filtered(
            lambda order: order.partner_id.commercial_partner_id == partner
        )[:1]
        if sale_order:
            return sale_order

        sale_line = request.env['sale.order.line'].sudo().search([
            ('invoice_lines.move_id', '=', move.id),
            ('order_id.partner_id', 'child_of', [partner.id]),
        ], order='id asc', limit=1)
        return sale_line.order_id if sale_line else request.env['sale.order']

    def _prepare_quotations_domain(self, partner):
        return ['|', ('message_partner_ids', 'child_of', [partner.commercial_partner_id.id]), ('partner_id', 'child_of', [partner.commercial_partner_id.id]), ('state', 'in', ['draft', 'sent'])]

    def _prepare_orders_domain(self, partner):
        return [('message_partner_ids', 'child_of', [partner.commercial_partner_id.id]), ('state', 'in', ['sale', 'done'])]

    def _prepare_home_portal_values(self, counters):
        values = super()._prepare_home_portal_values(counters)
        partner = request.env.user.partner_id.commercial_partner_id
        if 'ledger_count' in counters:
            values['ledger_count'] = request.env['b2b.ledger'].sudo().search_count([('partner_id', 'child_of', [partner.id])])
        return values

    @http.route(['/my/ledger', '/my/ledger/page/<int:page>'], type='http', auth='user', website=True)
    def portal_my_ledger(self, page=1, date_begin=None, date_end=None, sortby=None, filterby=None, **kw):
        values = self._prepare_portal_layout_values()
        partner = request.env.user.partner_id.commercial_partner_id
        base_domain = [('partner_id', 'child_of', [partner.id])]
        domain = list(base_domain)

        from odoo import fields
        from datetime import timedelta

        searchbar_filters = {
            'all': {'label': _('All'), 'domain': []},
            'last_30': {'label': _('Last 30 Days'), 'domain': [('date', '>=', fields.Date.today() - timedelta(days=30))]},
        }

        if not filterby:
            filterby = 'last_30'
        
        selected_filter_domain = searchbar_filters.get(filterby, searchbar_filters['all'])['domain']
        domain += selected_filter_domain
        opening_balance_cutoff = False
        if filterby == 'last_30':
            opening_balance_cutoff = fields.Date.today() - timedelta(days=30)

        try:
            from datetime import datetime
            
            def parse_date(d_str):
                try:
                    return datetime.strptime(d_str, '%Y-%m-%d').date()
                except ValueError:
                    return datetime.strptime(d_str, '%d/%m/%Y').date()

            if date_begin:
                opening_balance_cutoff = parse_date(date_begin)
                domain += [('date', '>=', opening_balance_cutoff)]
            if date_end:
                domain += [('date', '<=', parse_date(date_end))]
        except Exception:
            pass
        
        # Search the ledger items
        b2b_ledger = request.env['b2b.ledger'].sudo()
        all_partner_records = b2b_ledger.search(base_domain, order='date asc, id asc')
        
        # Typically tally ledgers are ordered oldest to newest to compute running balance correctly downward
        # but the view defaults to desc. So we fetch ASC to calculate running balance.
        records = b2b_ledger.search(domain, order='date asc, id asc')
        
        running_balance = 0.0
        total_credit = 0.0
        total_debit = 0.0
        overall_balance = 0.0
        opening_balance = 0.0

        for rec in all_partner_records:
            move_amount = rec.debit - rec.credit
            overall_balance += move_amount
            if opening_balance_cutoff and rec.date and rec.date < opening_balance_cutoff:
                opening_balance += move_amount

        running_balance = opening_balance
        
        ledger_data = []
        for rec in records:
            running_balance += (rec.debit - rec.credit)
            total_credit += rec.credit
            total_debit += rec.debit
            sale_order = self._b2b_get_sale_order_from_move(rec.move_id)
            ledger_data.append({
                'date': rec.date,
                'date_display': rec.date.strftime('%d/%m/%Y') if rec.date else '',
                'ref': rec.ref or '',
                'name': rec.name or '',
                'display_ref': rec.ref or rec.move_id.name or rec.name or '',
                'debit': rec.debit,
                'credit': rec.credit,
                'running_balance': running_balance,
                'currency_id': rec.currency_id,
                'move_id': rec.move_id,
                'sale_order_url': sale_order.get_portal_url() if sale_order else False,
            })

        ledger_data.reverse()
            
        values.update({
            'ledger_lines': ledger_data,
            'page_name': 'ledger',
            'default_url': '/my/ledger',
            'closing_balance': running_balance,
            'opening_balance': opening_balance,
            'credit_utilised': max(overall_balance, 0.0),
            'total_debit': total_debit,
            'total_credit': total_credit,
            'company_currency': request.env.company.currency_id,
            'searchbar_filters': searchbar_filters,
            'filterby': filterby,
            'date_begin': date_begin,
            'date_end': date_end,
        })
        return request.render('b2b_os.portal_my_ledger', values)

    @http.route(['/my/orders/<int:order_id>/update-lines'], type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def portal_update_order_lines(self, order_id, **kw):
        order = self._get_portal_sale_order(order_id)
        if not order or order.state not in ('draft', 'sent'):
            return request.redirect('/my/quotes')
        for key, val in kw.items():
            if key.startswith('qty_'):
                try:
                    line_id = int(key.split('_')[1])
                    qty = max(1, int(val))
                    line = request.env['sale.order.line'].sudo().search([('id', '=', line_id), ('order_id', '=', order.id)], limit=1)
                    if line: line.write({'product_uom_qty': qty})
                except Exception: pass
        return request.redirect(f'/my/orders/{order_id}')

    @http.route(['/my/orders/<int:order_id>/delete'], type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def portal_delete_order(self, order_id, **kw):
        order = self._get_portal_sale_order(order_id)
        if order and order.state in ('draft', 'sent'):
            if order.state == 'sent': order.action_cancel()
            order.unlink()
        return request.redirect('/my/quotes')

    @http.route(['/my/orders/<int:order_id>/edit-in-cart'], type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def portal_edit_order_in_cart(self, order_id, **kw):
        order = self._get_portal_sale_order(order_id)
        if not order or order.state not in ('draft', 'sent'):
            return request.redirect('/my/quotes')

        self._b2b_add_order_lines_to_cart(order)
        if order.state == 'sent':
            order.action_cancel()
        order.unlink()
        return request.redirect('/shop/cart')

    @http.route(['/my/orders/<int:order_id>/reorder'], type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def portal_reorder_order(self, order_id, **kw):
        order = self._get_portal_sale_order(order_id)
        if not order or order.state not in ('sale', 'done'):
            return request.redirect('/my/orders')

        self._b2b_add_order_lines_to_cart(order)
        return request.redirect('/shop/cart')

    @http.route(['/my/orders/<int:order_id>/confirm'], type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def portal_confirm_order(self, order_id, **kw):
        order = self._get_portal_sale_order(order_id)
        if order and (order.state == 'sent' or (order.state == 'draft' and order._b2b_portal_pricing_ready())):
            order.action_confirm()
        return request.redirect(f'/my/orders/{order_id}')


class B2BSignup(AuthSignupHome):
    """
    B2B OS: Extended Signup handling with phone, business name, and photo.
    """
    def do_signup(self, qcontext):
        # Base signup creates the user/partner
        super().do_signup(qcontext)
        
        # In Odoo, session.uid is only set if signup succeeded
        if request.session.uid:
            user = request.env['res.users'].sudo().browse(request.session.uid)
            partner = user.partner_id
            
            if partner:
                # Extract additional params
                phone = request.params.get('phone')
                business_name = request.params.get('business_name')
                
                # For multipart file uploads, files are in request.httprequest.files
                business_photo_file = request.httprequest.files.get('business_photo')
                
                vals = {
                    'b2b_pending': True,
                    'b2b_approved': False,
                }
                if phone: vals['phone'] = phone
                if business_name: vals['b2b_business_name'] = business_name
                
                if business_photo_file:
                    photo_content = business_photo_file.read()
                    if photo_content:
                        # Odoo Binary fields expect a base64 encoded string (utf-8)
                        vals['b2b_business_photo'] = base64.b64encode(photo_content).decode('utf-8')
                
                partner.sudo().write(vals)

    @http.route('/web/signup', type='http', auth='public', website=True, sitemap=False)
    def web_auth_signup(self, *args, **kw):
        # If method is POST and successful, redirect to pending page instead of login
        response = super().web_auth_signup(*args, **kw)
        if request.httprequest.method == 'POST' and not request.params.get('error') and request.session.uid:
            # Successfully signed in, but we want them to see the pending message
            # Logout immediately to prevent access until approved
            request.session.logout()
            return request.redirect('/b2b/registration-pending')
        return response

    @http.route('/b2b/registration-pending', type='http', auth='public', website=True)
    def b2b_registration_pending(self, **kw):
        return request.render('b2b_os.b2b_registration_pending')
