# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import base64
import csv
import io
import datetime


class FlipkartDailyOrder(models.Model):
    _name = 'flipkart.daily.order'
    _description = 'Flipkart Daily Order'
    _order = 'order_date desc, id desc'

    account_id = fields.Many2one('flipkart.account', string='Account', index=True)
    order_date = fields.Date(string='Order Date', required=True)
    shipment_id = fields.Char(string='Shipment ID')
    order_id = fields.Char(string='Order ID')
    fsn = fields.Char(string='FSN', required=True)
    sku = fields.Char(string='SKU')
    product_id = fields.Many2one('product.product', string='Odoo Product')
    quantity = fields.Float(string='Quantity', default=1.0)
    
    state = fields.Selection([
        ('draft', 'Draft'),
        ('processed', 'Processed'),
        ('cancelled', 'Cancelled')
    ], string='Status', default='draft', readonly=True, index=True)
    
    stock_move_ids = fields.One2many('stock.move', 'daily_order_id', string='Stock Movements')
    picking_id = fields.Many2one('stock.picking', string='Stock Picking')

    def _is_stock_deduction_enabled(self):
        return self.env['ir.config_parameter'].sudo().get_param(
            'flipkart_os.stock_deduction_enabled'
        ) == 'True'

    def action_process(self):
        # Already handles multiple records in self
        if not self:
            return

        if not self._is_stock_deduction_enabled():
            self.filtered(lambda rec: rec.state == 'draft').write({'state': 'processed'})
            return
            
        warehouse = self.env['stock.warehouse'].search([], limit=1)
        if not warehouse:
            raise UserError(_("No warehouse found."))
        
        picking_type = warehouse.out_type_id
        location_src = warehouse.lot_stock_id
        location_dest = self.env.ref('stock.stock_location_customers')
        
        # Batch picking for all selected orders for efficiency? Or one?
        # User said "select all and process effortlessly". One picking for the batch is better.
        picking = self.env['stock.picking'].create({
            'picking_type_id': picking_type.id,
            'location_id': location_src.id,
            'location_dest_id': location_dest.id,
            'origin': 'Flipkart Daily Order Processing',
        })
        
        move_vals_list = []
        bom_cache = {}
        
        for rec in self:
            if rec.state != 'draft' or not rec.product_id:
                continue
                
            results_map = {}
            rec._recursive_explode(rec.product_id.id, rec.quantity, results_map, bom_cache)
            
            for comp_id, comp_qty in results_map.items():
                move_vals_list.append({
                    'name': f"Order: {rec.order_id or rec.fsn}",
                    'product_id': comp_id,
                    'product_uom_qty': comp_qty,
                    'quantity': comp_qty,
                    'product_uom': self.env['product.product'].browse(comp_id).uom_id.id,
                    'location_id': location_src.id,
                    'location_dest_id': location_dest.id,
                    'daily_order_id': rec.id,
                    'picking_id': picking.id,
                    'picked': True,
                })
            rec.picking_id = picking.id
        
        if move_vals_list:
            moves = self.env['stock.move'].create(move_vals_list)
            picking.action_confirm()
            picking.action_assign()
            picking.button_validate()
            
        self.write({'state': 'processed'})

    def action_reverse(self):
        # Now handles multiple records for bulk reverse
        if not self:
            return
            
        warehouse = self.env['stock.warehouse'].search([], limit=1)
        picking_type = warehouse.in_type_id if warehouse else False

        for rec in self:
            if rec.state != 'processed':
                continue

            # When stock deduction was disabled, no picking was created on
            # processing, so just revert the status (nothing physical to undo).
            if not rec.picking_id:
                rec.write({'state': 'cancelled'})
                continue

            rev_picking = self.env['stock.picking'].create({
                'picking_type_id': picking_type.id,
                'location_id': rec.picking_id.location_dest_id.id,
                'location_dest_id': rec.picking_id.location_id.id,
                'origin': f"Reverse of {rec.order_id or rec.fsn}",
            })
            
            for move in rec.stock_move_ids:
                if move.state == 'done':
                    self.env['stock.move'].create({
                        'name': f"Reverse: {move.name}",
                        'product_id': move.product_id.id,
                        'product_uom_qty': move.product_uom_qty,
                        'quantity': move.product_uom_qty,
                        'product_uom': move.product_uom.id,
                        'location_id': move.location_dest_id.id,
                        'location_dest_id': move.location_id.id,
                        'picking_id': rev_picking.id,
                        'picked': True,
                    })
            
            rev_picking.action_confirm()
            rev_picking.action_assign()
            rev_picking.button_validate()
            rec.write({'state': 'cancelled'})

    def _recursive_explode(self, product_id, qty, results_map, bom_cache=None):
        if bom_cache is None: bom_cache = {}
        if product_id in bom_cache:
            res = bom_cache[product_id]
        else:
            self.env.cr.execute("""
                SELECT id FROM mrp_bom 
                WHERE (product_id = %s OR product_tmpl_id = (SELECT product_tmpl_id FROM product_product WHERE id = %s)) 
                AND type = 'phantom' AND active = True LIMIT 1
            """, (product_id, product_id))
            res = self.env.cr.fetchone()
            bom_cache[product_id] = res
            
        if res:
            bom_id = res[0]
            self.env.cr.execute("SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s", (bom_id,))
            lines = self.env.cr.fetchall()
            if lines:
                for comp_id, comp_qty in lines:
                    self._recursive_explode(comp_id, qty * (comp_qty or 1.0), results_map, bom_cache)
                return
        results_map[product_id] = results_map.get(product_id, 0.0) + qty


class FlipkartDailyOrderUpload(models.TransientModel):
    _name = 'flipkart.daily.order.upload'
    _description = 'Upload Daily Orders'

    account_id = fields.Many2one('flipkart.account', string='Account', required=True)
    file = fields.Binary(string='CSV File', required=True)
    file_name = fields.Char()

    def action_import(self):
        self.ensure_one()
        if not self.account_id:
            raise UserError(_("Please select the Flipkart Account."))
        data = base64.b64decode(self.file).decode('utf-8')
        reader = csv.DictReader(io.StringIO(data))
        Order = self.env['flipkart.daily.order']
        MultiBarcode = self.env['sr.multi.barcode']
        
        rows = list(reader)
        fsn_list = list(set([str(row.get('FSN') or '').strip() for row in rows if row.get('FSN')]))
        barcode_recs = MultiBarcode.search([('name', 'in', fsn_list)])
        fsn_to_product = {rec.name: rec.product_id.id for rec in barcode_recs if rec.product_id}
        
        orders_to_create = []
        for row in rows:
            fsn = str(row.get('FSN') or '').strip()
            if not fsn: continue
            qty = float(row.get('Quantity', 1.0))
            order_date_str = row.get('Ordered On') or ''
            try:
                date_clean = order_date_str.replace('"', '').strip()
                order_date = datetime.datetime.strptime(date_clean, '%b %d, %Y').date()
            except:
                order_date = fields.Date.context_today(self)

            orders_to_create.append({
                'account_id': self.account_id.id,
                'order_date': order_date,
                'shipment_id': row.get('Shipment ID'),
                'order_id': row.get('Order Id'),
                'fsn': fsn,
                'sku': row.get('SKU'),
                'product_id': fsn_to_product.get(fsn),
                'quantity': qty,
            })
            
        if orders_to_create:
            Order.create(orders_to_create)
            # NO AUTOMATIC action_process() - User will do it in bulk
            
        return {
            'type': 'ir.actions.act_window',
            'name': 'Daily Orders',
            'res_model': 'flipkart.daily.order',
            'view_mode': 'list,form',
            'domain': [('account_id', '=', self.account_id.id)],
            'context': {'search_default_draft': 1, 'default_account_id': self.account_id.id},
        }
