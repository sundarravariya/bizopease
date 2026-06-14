from odoo import models, fields, api


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    b2b_pricing_accepted = fields.Boolean(
        string='Pricing Accepted for Portal',
        default=False,
        copy=False,
    )
    b2b_pricing_accepted_by_id = fields.Many2one(
        'res.users',
        string='Pricing Accepted By',
        copy=False,
    )
    b2b_pricing_accepted_date = fields.Datetime(
        string='Pricing Accepted Date',
        copy=False,
    )

    b2b_is_fully_priced = fields.Boolean(
        string='Fully Priced',
        compute='_compute_b2b_is_fully_priced',
        store=False
    )

    @api.depends('order_line', 'order_line.price_unit')
    def _compute_b2b_is_fully_priced(self):
        for order in self:
            is_priced = True
            for line in order.order_line:
                # If any product line is <= 1, it's considered unpriced
                if not line.display_type and not line.is_delivery and line.price_unit <= 1.0:
                    is_priced = False
                    break
            order.b2b_is_fully_priced = is_priced

    def _b2b_apply_partner_website_discount(self):
        for order in self:
            if not order.partner_id:
                continue
            for line in order.order_line.filtered(lambda l: not l.display_type and not l.is_delivery):
                target_discount = order._b2b_target_discount_for_product(line.product_id)
                if abs((line.discount or 0.0) - target_discount) > 0.0001:
                    line.discount = target_discount

    def _b2b_has_hidden_website_prices(self):
        self.ensure_one()
        if self.state in ('sale', 'done'):
            return False
        return any(
            line._b2b_should_hide_price()
            for line in self.order_line
            if not line.display_type
        )

    def _b2b_internal_pricing_review_detected(self):
        self.ensure_one()
        if self.state in ('sale', 'done'):
            return True

        internal_user = lambda user: bool(user and not user.share and not user._is_public())
        if internal_user(self.write_uid) and self.write_date and self.create_date and self.write_date > self.create_date:
            return True

        for line in self.order_line.filtered(lambda l: not l.display_type and not l.is_delivery):
            if internal_user(line.write_uid) and line.write_date and line.create_date and line.write_date > line.create_date:
                return True
        return False

    def _b2b_portal_pricing_ready(self):
        self.ensure_one()
        if self.state in ('sent', 'sale', 'done'):
            return True
        if self.b2b_pricing_accepted:
            return True
        if self.b2b_is_fully_priced:
            return True
        return self._b2b_internal_pricing_review_detected()

    def _b2b_portal_should_show_prices(self):
        self.ensure_one()
        if self.state in ('sale', 'done'):
            return True
        return self._b2b_portal_pricing_ready()

    def _b2b_mark_pricing_accepted(self):
        accepted_vals = {
            'b2b_pricing_accepted': True,
            'b2b_pricing_accepted_by_id': self.env.user.id,
            'b2b_pricing_accepted_date': fields.Datetime.now(),
        }
        for order in self.filtered(lambda o: o.state in ('draft', 'sent')):
            order.with_context(b2b_skip_pricing_accept_sync=True).sudo().write(accepted_vals)

    def _b2b_target_discount_for_product(self, product):
        self.ensure_one()
        if not self.partner_id or not product:
            return 0.0
        product_template = product.product_tmpl_id if hasattr(product, 'product_tmpl_id') else product
        if product_template._b2b_is_stock_clearance():
            return 0.0
        return min(max(self.partner_id.commercial_partner_id.b2b_website_discount_percent or 0.0, 0.0), 100.0)

    @api.onchange('partner_id')
    def _onchange_b2b_partner_discount_policy(self):
        self._b2b_apply_partner_website_discount()

    def _cart_update(self, *args, **kwargs):
        result = super()._cart_update(*args, **kwargs)
        self._b2b_apply_partner_website_discount()
        return result

    def write(self, vals):
        res = super().write(vals)
        if 'partner_id' in vals:
            self._b2b_apply_partner_website_discount()
        if (
            not self.env.context.get('b2b_skip_pricing_accept_sync')
            and self.env.user
            and not self.env.user.share
            and not self.env.user._is_public()
            and any(key in vals for key in ('order_line', 'partner_id', 'note', 'validity_date', 'payment_term_id'))
        ):
            self._b2b_mark_pricing_accepted()
        return res

    def action_b2b_1click_invoice_delivery(self):
        for order in self:
            # 1. Force validate pending deliveries
            for picking in order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel')):
                picking.action_assign()
                for move in picking.move_ids_without_package:
                    move.quantity = move.product_uom_qty
                
                res = picking.button_validate()
                if isinstance(res, dict):
                    model = res.get('res_model')
                    if model in ('stock.immediate.transfer', 'stock.backorder.confirmation'):
                        wizard = self.env[model].with_context(res.get('context', {})).create({})
                        if model == 'stock.immediate.transfer':
                            wizard.process()
                        else:
                            wizard.process_cancel_backorder()
            
            # 2. Create and Post the invoice (skipping the popup wizard completely)
            invoices = order._create_invoices()
            for invoice in invoices:
                if invoice.state == 'draft':
                    invoice.action_post()

    def action_b2b_admin_confirm(self):
        for order in self:
            if order.state in ('draft', 'sent'):
                order.action_confirm()
        return True

    def action_b2b_accept_pricing(self):
        self._b2b_mark_pricing_accepted()
        return True

    def action_b2b_create_customer_quotation(self):
        self.ensure_one()
        order_requests_action = self.env["ir.actions.actions"]._for_xml_id("b2b_os.action_b2b_order_requests")
        request_tag = self.env['crm.tag'].search([('name', '=', 'B2B Request')], limit=1)
        if not request_tag:
            request_tag = self.env['crm.tag'].create({'name': 'B2B Request'})
        new_order = self.copy(default={
            'state': 'draft',
            'name': self.env['ir.sequence'].next_by_code('sale.order') or '/',
            'origin': self.name,
            'website_id': False,
            'client_order_ref': self.client_order_ref or self.name,
            'tag_ids': [(6, 0, list(set(self.tag_ids.ids + [request_tag.id])))],
        })
        if self.partner_id:
            partner_ids = self.partner_id.child_ids.ids + [self.partner_id.id]
            new_order.message_subscribe(partner_ids=partner_ids)
        new_order._b2b_apply_partner_website_discount()
        order_requests_action.update({
            'res_id': new_order.id,
            'view_mode': 'form',
            'views': [(False, 'form')],
            'target': 'current',
        })
        return order_requests_action
