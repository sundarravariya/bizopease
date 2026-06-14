# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import base64
import csv
import io
import datetime


class FlipkartReturnManagement(models.Model):
    _name = 'flipkart.return.management'
    _description = 'Flipkart Returns Management'
    _order = 'return_requested_date desc, id desc'

    account_id = fields.Many2one('flipkart.account', string='Account', index=True)
    return_id = fields.Char(string='Return ID', required=True)
    tracking_id = fields.Char(string='Tracking ID', index=True)
    fsn = fields.Char(string='FSN', required=True)
    sku = fields.Char(string='SKU')
    product_id = fields.Many2one('product.product', string='Odoo Product')
    quantity = fields.Float(string='Quantity', default=1.0)
    
    return_requested_date = fields.Date(string='Requested Date')
    return_type = fields.Char(string='Return Type')
    return_reason = fields.Char(string='Reason')
    
    state = fields.Selection([
        ('draft', 'Pending Scan'),
        ('scanned', 'Scanned'),
        ('processed', 'Inwarded'),
        ('rejected', 'Rejected'),
        ('cancelled', 'Cancelled')
    ], string='Status', default='draft', readonly=True, index=True)
    
    stock_move_ids = fields.One2many('stock.move', 'return_id', string='Stock Movements')
    picking_id = fields.Many2one('stock.picking', string='Stock Picking')

    def _is_stock_deduction_enabled(self):
        return self.env['ir.config_parameter'].sudo().get_param(
            'flipkart_os.returns_stock_move_enabled'
        ) == 'True'

    def action_confirm_inward(self):
        # Now handles multi-record for bulk inward
        if not self:
            return

        if not self._is_stock_deduction_enabled():
            self.filtered(lambda rec: rec.state in ['draft', 'scanned']).write({'state': 'processed'})
            return
            
        warehouse = self.env['stock.warehouse'].search([], limit=1)
        if not warehouse:
            raise UserError(_("No warehouse found."))
        
        picking_type = warehouse.in_type_id
        location_dest = warehouse.lot_stock_id
        location_src = self.env.ref('stock.stock_location_customers')
        
        for rec in self:
            if rec.state not in ['draft', 'scanned'] or not rec.product_id:
                continue
                
            picking = self.env['stock.picking'].create({
                'picking_type_id': picking_type.id,
                'location_id': location_src.id,
                'location_dest_id': location_dest.id,
                'origin': f"Flipkart Return: {rec.tracking_id or rec.return_id}",
            })
            
            results_map = {}
            rec._recursive_explode(rec.product_id.id, rec.quantity, results_map)
            
            for comp_id, comp_qty in results_map.items():
                self.env['stock.move'].create({
                    'name': f"Return Inward: {rec.tracking_id or rec.return_id}",
                    'product_id': comp_id,
                    'product_uom_qty': comp_qty,
                    'quantity': comp_qty,
                    'product_uom': self.env['product.product'].browse(comp_id).uom_id.id,
                    'location_id': location_src.id,
                    'location_dest_id': location_dest.id,
                    'return_id': rec.id,
                    'picking_id': picking.id,
                    'picked': True,
                })
            
            picking.action_confirm()
            picking.action_assign()
            picking.button_validate()
            rec.write({'state': 'processed', 'picking_id': picking.id})

    def action_reject(self):
        if not self:
            return
        self.write({'state': 'rejected'})

    def action_reverse(self):
        if not self:
            return

        warehouse = self.env['stock.warehouse'].search([], limit=1)
        picking_type = warehouse.out_type_id if warehouse else False

        for rec in self:
            if rec.state != 'processed':
                continue

            # When stock deduction was disabled, no picking was created on inward,
            # so just revert the status (nothing physical to undo).
            if not rec.picking_id:
                rec.write({'state': 'cancelled'})
                continue

            rev_picking = self.env['stock.picking'].create({
                'picking_type_id': picking_type.id,
                'location_id': rec.picking_id.location_dest_id.id,
                'location_dest_id': rec.picking_id.location_id.id,
                'origin': f"Reverse Return: {rec.tracking_id or rec.return_id}",
            })
            
            for move in rec.stock_move_ids:
                if move.state == 'done':
                    self.env['stock.move'].create({
                        'name': f"Reverse Inward: {move.name}",
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

    def _recursive_explode(self, product_id, qty, results_map):
        self.env.cr.execute("""
            SELECT id FROM mrp_bom 
            WHERE (product_id = %s OR product_tmpl_id = (SELECT product_tmpl_id FROM product_product WHERE id = %s)) 
            AND type = 'phantom' AND active = True LIMIT 1
        """, (product_id, product_id))
        res = self.env.cr.fetchone()
        if res:
            bom_id = res[0]
            self.env.cr.execute("SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s", (bom_id,))
            lines = self.env.cr.fetchall()
            if lines:
                for comp_id, comp_qty in lines:
                    self._recursive_explode(comp_id, qty * (comp_qty or 1.0), results_map)
                return
        results_map[product_id] = results_map.get(product_id, 0.0) + qty


class FlipkartReturnScanWizard(models.TransientModel):
    _name = 'flipkart.return.scan.wizard'
    _description = 'Scan Return Tracking ID'

    tracking_id = fields.Char(string='Scan Tracking ID', required=True)
    return_record_id = fields.Many2one('flipkart.return.management', string='Matching Return', readonly=True)
    
    fsn = fields.Char(related='return_record_id.fsn', readonly=True)
    product_name = fields.Char(string='Product', compute='_compute_details')
    
    @api.onchange('tracking_id')
    def _onchange_tracking_id(self):
        if self.tracking_id:
            rec = self.env['flipkart.return.management'].search([
                ('tracking_id', '=', self.tracking_id.strip()),
                ('state', '=', 'draft')
            ], limit=1)
            if rec:
                self.return_record_id = rec
            else:
                self.return_record_id = False

    @api.depends('return_record_id')
    def _compute_details(self):
        for rec in self:
            if rec.return_record_id and rec.return_record_id.product_id:
                rec.product_name = rec.return_record_id.product_id.display_name
            else:
                rec.product_name = "Not Identified"

    def action_confirm_and_next(self):
        self.ensure_one()
        if not self.return_record_id and self.tracking_id:
             rec = self.env['flipkart.return.management'].search([
                ('tracking_id', '=', self.tracking_id.strip()),
                ('state', '=', 'draft')
            ], limit=1)
             if rec:
                 self.return_record_id = rec

        if not self.return_record_id:
            raise UserError(_("No matching return found for scanned ID: %s") % self.tracking_id)
        
        self.return_record_id.action_confirm_inward()
        
        return {
            'name': 'Scan Next Return',
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.return.scan.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': self.env.context,
        }

    def action_reject_and_next(self):
        self.ensure_one()
        if not self.return_record_id and self.tracking_id:
             rec = self.env['flipkart.return.management'].search([
                ('tracking_id', '=', self.tracking_id.strip()),
                ('state', '=', 'draft')
            ], limit=1)
             if rec:
                 self.return_record_id = rec

        if not self.return_record_id:
            raise UserError(_("No matching return found for scanned ID: %s") % self.tracking_id)
        
        self.return_record_id.action_reject()
        
        return {
            'name': 'Scan Next Return',
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.return.scan.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': self.env.context,
        }


class FlipkartReturnUpload(models.TransientModel):
    _name = 'flipkart.return.upload'
    _description = 'Upload Returns CSV'

    account_id = fields.Many2one('flipkart.account', string='Account', required=True)
    file = fields.Binary(string='CSV File', required=True)
    file_name = fields.Char()

    def action_import(self):
        self.ensure_one()
        if not self.account_id:
            raise UserError(_("Please select the Flipkart Account."))
        data = base64.b64decode(self.file).decode('utf-8')
        reader = csv.DictReader(io.StringIO(data))
        Return = self.env['flipkart.return.management']
        MultiBarcode = self.env['sr.multi.barcode']
        
        rows = list(reader)
        fsn_list = list(set([str(row.get('FSN') or '').strip() for row in rows if row.get('FSN')]))
        barcode_recs = MultiBarcode.search([('name', 'in', fsn_list)])
        fsn_to_product = {rec.name: rec.product_id.id for rec in barcode_recs if rec.product_id}
        
        returns_to_create = []
        for row in rows:
            tracking_id = str(row.get('Tracking ID') or '').strip()
            if not tracking_id: continue
            fsn = str(row.get('FSN') or '').strip()
            product_id = fsn_to_product.get(fsn)
            try:
                date_str = row.get('Return Requested Date', '').strip()
                order_date = datetime.datetime.strptime(date_str, '%d %B, %Y').date()
            except:
                order_date = fields.Date.context_today(self)

            existing = Return.search([
                ('return_id', '=', row.get('Return ID')),
                ('account_id', '=', self.account_id.id),
            ], limit=1)
            if not existing:
                returns_to_create.append({
                    'account_id': self.account_id.id,
                    'return_id': row.get('Return ID'),
                    'tracking_id': tracking_id,
                    'fsn': fsn,
                    'sku': row.get('SKU'),
                    'product_id': product_id,
                    'quantity': float(row.get('Quantity', 1.0)),
                    'return_requested_date': order_date,
                    'return_type': row.get('Return Type'),
                    'return_reason': row.get('Return Reason'),
                })
        
        if returns_to_create:
            Return.create(returns_to_create)
            
        return {
            'type': 'ir.actions.act_window',
            'name': 'Returns Management',
            'res_model': 'flipkart.return.management',
            'view_mode': 'list,form',
            'domain': [('account_id', '=', self.account_id.id)],
            'context': {'search_default_pending': 1, 'default_account_id': self.account_id.id},
        }
