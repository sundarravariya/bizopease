# -*- coding: utf-8 -*-
from odoo import models, fields, api, _

class PurchaseOrderInherit(models.Model):
    _inherit = 'purchase.order'

    carrying_agent_id = fields.Many2one(
        'flipkart.carrying.agent', 
        string='Carrying Agent', 
        tracking=True,
        help="The agent handling the freight/shipping for this purchase."
    )
    
    exchange_rate = fields.Float(
        string='INR Exchange Rate', 
        digits=(12, 4), 
        default=15.00,
        tracking=True,
        help="Rate to multiply the PO currency to get the total INR bill."
    )
    
    deposit_paid = fields.Float(
        string='Deposit Paid (PO Currency)', 
        digits=(12, 2),
        default=0.0,
        tracking=True,
    )
    
    shipping_cost = fields.Float(
        string='Shipping Cost (PO Currency)', 
        digits=(12, 2),
        default=0.0,
        tracking=True,
    )
    
    deposit_deducted = fields.Boolean(
        string='Deposit Deducted from Agent Bill', 
        default=False, 
        copy=False
    )
    
    total_inr = fields.Float(
        string='Total (INR)', 
        compute='_compute_agent_totals', 
        store=True
    )
    
    deposit_inr = fields.Float(
        string='Deposit (INR)', 
        compute='_compute_agent_totals', 
        store=True
    )
    
    net_agent_liability_inr = fields.Float(
        string='Net Liability (INR)', 
        compute='_compute_agent_totals', 
        store=True,
    )

    @api.depends('amount_total', 'exchange_rate', 'deposit_paid', 'shipping_cost')
    def _compute_agent_totals(self):
        for order in self:
            order.total_inr = (order.amount_total + order.shipping_cost) * order.exchange_rate
            order.deposit_inr = order.deposit_paid * order.exchange_rate
            order.net_agent_liability_inr = order.total_inr - order.deposit_inr

    @api.model
    def default_get(self, fields_list):
        res = super(PurchaseOrderInherit, self).default_get(fields_list)
        rmb_currency = self.env['res.currency'].search([('name', 'in', ['RMB', 'CNY'])], limit=1)
        if rmb_currency and 'currency_id' in fields_list:
            res['currency_id'] = rmb_currency.id
        return res

    @api.depends('partner_id')
    def _compute_currency_id(self):
        super(PurchaseOrderInherit, self)._compute_currency_id()
        rmb_currency = self.env['res.currency'].search([('name', 'in', ['RMB', 'CNY'])], limit=1)
        if rmb_currency:
            for order in self:
                if order.state in ['draft', 'sent']:
                    order.currency_id = rmb_currency.id

    @api.onchange('partner_id', 'company_id')
    def _onchange_partner_id_force_rmb(self):
        rmb_currency = self.env['res.currency'].search([('name', 'in', ['RMB', 'CNY'])], limit=1)
        if rmb_currency:
            self.currency_id = rmb_currency.id

    def action_compare_prices(self):
        self.ensure_one()
        product_ids = self.order_line.mapped('product_id').ids
        if not product_ids:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _("No Products"),
                    'message': _("Please add products to the order first."),
                    'sticky': False,
                    'type': 'warning',
                }
            }
        
        return {
            'name': _('Compare Prices'),
            'type': 'ir.actions.act_window',
            'res_model': 'purchase.order.line',
            'view_mode': 'list',
            'view_id': self.env.ref('flipkart_os.view_purchase_order_line_compare_tree').id,
            'domain': [
                ('product_id', 'in', product_ids), 
                ('state', 'in', ['purchase', 'done'])
            ],
            'context': {
                'search_default_groupby_product': 1,
                'search_default_groupby_partner': 1,
            },
        }

    def button_confirm(self):
        res = super(PurchaseOrderInherit, self).button_confirm()
        for order in self:
            for line in order.order_line:
                if line.product_id:
                    seller = line.product_id._select_seller(
                        partner_id=line.partner_id,
                        quantity=line.product_qty,
                        date=order.date_order and order.date_order.date(),
                        uom_id=line.product_uom
                    )
                    if seller:
                        seller.sudo().write({'exchange_rate_used': order.exchange_rate})
        return res

class PurchaseOrderLineInherit(models.Model):
    _inherit = 'purchase.order.line'

    @api.depends('product_id', 'product_qty', 'product_uom')
    def _compute_price_unit_and_date_planned_and_name(self):
        super(PurchaseOrderLineInherit, self)._compute_price_unit_and_date_planned_and_name()
        
        for line in self:
            if not line.product_id or line.state in ['purchase', 'done', 'cancel']:
                continue
                
            last_line = self.env['purchase.order.line'].search([
                ('product_id', '=', line.product_id.id),
                ('order_id.partner_id', '=', line.order_id.partner_id.id),
                ('state', 'in', ['purchase', 'done']),
                ('id', '!=', line._origin.id if line._origin else False)
            ], order='date_order desc, id desc', limit=1)
            
            if last_line:
                line.price_unit = last_line.price_unit
                continue
                
            last_global = self.env['purchase.order.line'].search([
                ('product_id', '=', line.product_id.id),
                ('state', 'in', ['purchase', 'done']),
                ('id', '!=', line._origin.id if line._origin else False)
            ], order='date_order desc, id desc', limit=1)
            
            if last_global:
                line.price_unit = last_global.price_unit
            else:
                line.price_unit = line.product_id.standard_price  # fallback to Odoo product cost

class SupplierInfoInherit(models.Model):
    _inherit = 'product.supplierinfo'
    
    exchange_rate_used = fields.Float(string="PO Exchange Rate", digits=(12, 4), default=1.0)
    price_inr = fields.Float(string="Price (INR)", compute="_compute_price_inr", store=True)
    
    @api.depends('price', 'exchange_rate_used')
    def _compute_price_inr(self):
        for rec in self:
            rec.price_inr = rec.price * (rec.exchange_rate_used or 1.0)

class StockMoveInherit(models.Model):
    _inherit = 'stock.move'

    def _get_price_unit(self):
        self.ensure_one()
        res = super(StockMoveInherit, self)._get_price_unit()
        
        if self.purchase_line_id and self.purchase_line_id.order_id:
            po = self.purchase_line_id.order_id
            if po.currency_id and po.currency_id.name in ['RMB', 'CNY']:
                
                # Calculate Prorated Shipping (INR) per unit
                total_qty = sum(line.product_qty for line in po.order_line)
                shipping_inr_per_unit = 0.0
                if total_qty > 0 and po.shipping_cost:
                    shipping_inr_per_unit = (po.shipping_cost * po.exchange_rate) / total_qty
                
                # Custom Base Price + Shipping Allocation
                custom_price_inr = (self.purchase_line_id.price_unit * po.exchange_rate) + shipping_inr_per_unit
                
                if isinstance(res, dict):
                    # Odoo 18 expects a dictionary {lot_id or move_id: price_unit}
                    new_res = res.copy()
                    for k in new_res:
                        new_res[k] = custom_price_inr
                    return new_res
                else:
                    return custom_price_inr
        return res

class StockPickingInherit(models.Model):
    _inherit = 'stock.picking'

    def button_validate(self):
        res = super(StockPickingInherit, self).button_validate()
        
        for picking in self:
            if picking.state == 'done' and picking.picking_type_code == 'incoming' and picking.purchase_id and picking.purchase_id.carrying_agent_id:
                po = picking.purchase_id
                receipt_po_value = sum(
                    move.quantity * move.purchase_line_id.price_unit 
                    for move in picking.move_ids 
                    if move.purchase_line_id
                )
                
                if receipt_po_value > 0 or po.shipping_cost > 0:
                    shipping_rmb = po.shipping_cost if not po.deposit_deducted else 0.0
                    inr_value = (receipt_po_value + shipping_rmb) * po.exchange_rate
                    
                    if po.deposit_paid > 0 and not po.deposit_deducted:
                        deposit_inr = po.deposit_inr
                        inr_value -= deposit_inr
                        po.deposit_deducted = True
                        
                    if inr_value != 0:
                        entry_type = 'bill' if inr_value > 0 else 'adjustment'
                        self.env['flipkart.agent.ledger'].create({
                            'agent_id': po.carrying_agent_id.id,
                            'date': fields.Date.context_today(self),
                            'entry_type': entry_type,
                            'amount_inr': abs(inr_value),
                            'reference': f"{picking.name} (PO: {po.name})",
                            'notes': f"Warehouse receipt.\nRMB Received: {receipt_po_value}\nShipping applied: {shipping_rmb}\nExchange Rate: {po.exchange_rate} INR",
                        })
        return res
