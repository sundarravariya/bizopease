# -*- coding: utf-8 -*-
from odoo import models, fields


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    # Marks orders created by the Flipkart → Odoo sales sync. These are pure
    # reporting mirrors of Flipkart sales: NO stock moves, NO invoices, and they
    # must NOT be re-pushed back into the Flipkart dashboard (would double-count).
    is_flipkart_sync = fields.Boolean(string='Flipkart Synced Order', default=False, index=True)

    def action_confirm(self):
        res = super(SaleOrder, self).action_confirm()
        for order in self:
            # Flipkart-synced orders are reporting-only: skip delivery validation,
            # invoicing, and the reverse dashboard push entirely.
            if order.is_flipkart_sync:
                continue
            # 1. Force MAIN warehouse on all stock moves
            main_wh = self.env['stock.warehouse'].search([('code', '=', 'MAIN')], limit=1)
            if main_wh:
                main_location = main_wh.lot_stock_id
                for picking in order.picking_ids:
                    for move in picking.move_ids:
                        move.location_id = main_location

            # 2. Auto-validate delivery (1-step routing)
            action_to_return = False
            for picking in order.picking_ids.filtered(lambda p: p.state not in ('done', 'cancel')):
                picking.action_assign()
                if picking.state not in ('assigned', 'confirmed'):
                    continue
                    
                has_qty = False
                for move in picking.move_ids:
                    if hasattr(picking, 'action_set_quantities_to_reservation'):
                        picking.action_set_quantities_to_reservation()
                    else:
                        assigned = move.product_uom_qty
                        if hasattr(move, 'quantity'):
                            move.quantity = assigned
                        elif hasattr(move, 'quantity_done'):
                            move.quantity_done = assigned
                    
                    if getattr(move, 'quantity', 0) > 0 or getattr(move, 'quantity_done', 0) > 0:
                        has_qty = True

                if has_qty:
                    res_val = picking.with_context(skip_backorder=False).button_validate()
                    if isinstance(res_val, dict):
                        action_to_return = res_val
                        break

            # 3. Auto-create and post invoice
            order._auto_create_invoice()

            # 4. Sync to Sales Analytics Dashboard
            order._sync_to_flipkart_dashboard()

        if action_to_return:
            return action_to_return
        return res

    def _auto_create_invoice(self):
        """Create and post invoice automatically after order confirmation."""
        if not self.order_line:
            return
        try:
            # Create invoice
            invoice = self._create_invoices()
            if invoice:
                invoice.action_post()
        except Exception:
            pass  # Don't block confirmation if invoice auto-creation fails

    def _sync_to_flipkart_dashboard(self):
        # Never mirror a Flipkart-synced order back into the dashboard — its sales
        # are already represented there (this would create "Odoo Store" duplicates).
        if self.is_flipkart_sync:
            return
        Dashboard = self.env['flipkart.sales.dashboard']
        Account = self.env['flipkart.account']

        # Find or create "Odoo Store" account
        account = Account.search([('name', '=', 'Odoo Store')], limit=1)
        if not account:
            account = Account.create({'name': 'Odoo Store'})

        for line in self.order_line:
            # Skip section/note lines and lines without a product
            if line.display_type or not line.product_id:
                continue

            # Duplicate check via sale_order_line_id
            if Dashboard.search([('sale_order_line_id', '=', line.id)], limit=1):
                continue

            # Try BOM explosion (phantom/kit)
            bom_obj = self.env['mrp.bom']
            bom = bom_obj._bom_find(
                line.product_id,
                company_id=self.company_id.id,
                bom_type='phantom'
            )[line.product_id]

            if bom:
                factor = line.product_uom_qty / bom.product_uom_id._compute_quantity(
                    bom.product_qty, line.product_id.uom_id
                )
                _boms, bom_lines = bom.explode(line.product_id, factor)
                for bom_line, line_data in bom_lines:
                    self._create_dashboard_entry(account, line, bom_line.product_id, line_data['qty'])
            else:
                self._create_dashboard_entry(account, line, line.product_id, line.product_uom_qty)

    def _create_dashboard_entry(self, account, sale_line, product, qty):
        self.env['flipkart.sales.dashboard'].create({
            'account_id': account.id,
            'order_date': self.date_order.date(),
            'product_id': product.id,
            'sku_id': product.default_code or product.name,
            'gross_units': int(qty),
            'gmv': sale_line.price_subtotal,
            'final_sale_units': int(qty),
            'final_sale_amount': sale_line.price_subtotal,
            'partner_id': self.partner_id.id,
            'order_number': self.name,
            'sale_order_line_id': sale_line.id,
            'fulfillment_type': 'Odoo Manual',
            'location_id': self.warehouse_id.name if self.warehouse_id else '',
        })
