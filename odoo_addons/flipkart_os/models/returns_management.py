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

    def get_inward_components(self):
        """Explode this return's product (recursively, incl. nested phantom BOMs)
        into its leaf components for display in the scan wizard. For a plain
        product with no phantom BOM this returns a single line (the product
        itself). Each component is one entry (a leaf reached via multiple paths
        is summed — no duplicate rows)."""
        self.ensure_one()
        if not self.product_id:
            return []
        results_map = {}
        self._recursive_explode(self.product_id.id, self.quantity or 1.0, results_map)
        Product = self.env['product.product']
        comps = []
        for pid, qty in results_map.items():
            prod = Product.browse(pid)
            comps.append({
                'product_id': pid,
                'name': prod.display_name,
                'default_code': prod.default_code or '',
                'qty': qty,
            })
        comps.sort(key=lambda c: c['name'])
        return comps

    def action_inward_components(self, components):
        """Partial inward: create stock moves for ONLY the supplied components,
        which are already leaf-exploded (from get_inward_components). The return
        is marked 'processed' regardless; the stock moves record exactly which
        components were taken in. Honors the returns_stock_move_enabled flag.

        components = [{'product_id': int, 'qty': float}, ...]
        """
        self.ensure_one()
        if self.state not in ('draft', 'scanned'):
            return
        selected = [
            c for c in (components or [])
            if c.get('product_id') and float(c.get('qty') or 0) > 0
        ]
        if not selected:
            raise UserError(_("Select at least one component to inward."))

        # No physical stock movement when deduction is disabled — just record done.
        if not self._is_stock_deduction_enabled():
            self.write({'state': 'processed'})
            return

        warehouse = self.env['stock.warehouse'].search([], limit=1)
        if not warehouse:
            raise UserError(_("No warehouse found."))
        picking_type = warehouse.in_type_id
        location_dest = warehouse.lot_stock_id
        location_src = self.env.ref('stock.stock_location_customers')

        picking = self.env['stock.picking'].create({
            'picking_type_id': picking_type.id,
            'location_id': location_src.id,
            'location_dest_id': location_dest.id,
            'origin': f"Flipkart Return: {self.tracking_id or self.return_id}",
        })
        Product = self.env['product.product']
        for c in selected:
            prod = Product.browse(int(c['product_id']))
            qty = float(c['qty'])
            self.env['stock.move'].create({
                'name': f"Return Inward: {self.tracking_id or self.return_id}",
                'product_id': prod.id,
                'product_uom_qty': qty,
                'quantity': qty,
                'product_uom': prod.uom_id.id,
                'location_id': location_src.id,
                'location_dest_id': location_dest.id,
                'return_id': self.id,
                'picking_id': picking.id,
                'picked': True,
            })
        picking.action_confirm()
        picking.action_assign()
        picking.button_validate()
        self.write({'state': 'processed', 'picking_id': picking.id})


class FlipkartReturnScanLine(models.TransientModel):
    _name = 'flipkart.return.scan.line'
    _description = 'Return Scan Component Line'
    _order = 'product_name'

    wizard_id = fields.Many2one('flipkart.return.scan.wizard', ondelete='cascade')
    product_id = fields.Many2one('product.product', string='Component', readonly=True)
    product_name = fields.Char(string='Component', readonly=True)
    qty = fields.Float(string='Quantity', readonly=True)
    selected = fields.Boolean(string='Inward', default=True)


class FlipkartReturnScanWizard(models.TransientModel):
    _name = 'flipkart.return.scan.wizard'
    _description = 'Scan Return Tracking ID'

    tracking_id = fields.Char(string='Scan Tracking ID', required=True)
    return_record_id = fields.Many2one('flipkart.return.management', string='Matching Return', readonly=True)

    fsn = fields.Char(related='return_record_id.fsn', readonly=True)
    product_name = fields.Char(string='Product', compute='_compute_details')
    component_line_ids = fields.One2many('flipkart.return.scan.line', 'wizard_id', string='Components')
    has_components = fields.Boolean(string='Has Components', compute='_compute_details')

    def _populate_components(self):
        """Clear and rebuild the component checklist from the matched return."""
        self.component_line_ids = [(5, 0, 0)]
        if self.return_record_id:
            comps = self.return_record_id.get_inward_components()
            self.component_line_ids = [(0, 0, {
                'product_id': c['product_id'],
                'product_name': (f"[{c['default_code']}] " if c['default_code'] else '') + c['name'],
                'qty': c['qty'],
                'selected': True,
            }) for c in comps]

    @api.onchange('tracking_id')
    def _onchange_tracking_id(self):
        if self.tracking_id:
            rec = self.env['flipkart.return.management'].search([
                ('tracking_id', '=', self.tracking_id.strip()),
                ('state', '=', 'draft')
            ], limit=1)
            self.return_record_id = rec or False
        else:
            self.return_record_id = False
        self._populate_components()

    @api.depends('return_record_id', 'component_line_ids')
    def _compute_details(self):
        for rec in self:
            if rec.return_record_id and rec.return_record_id.product_id:
                rec.product_name = rec.return_record_id.product_id.display_name
            else:
                rec.product_name = "Not Identified"
            # >1 line, or a single line that isn't the kit itself = a real BOM
            rec.has_components = len(rec.component_line_ids) > 1

    def _resolve_return(self):
        if not self.return_record_id and self.tracking_id:
            rec = self.env['flipkart.return.management'].search([
                ('tracking_id', '=', self.tracking_id.strip()),
                ('state', '=', 'draft')
            ], limit=1)
            if rec:
                self.return_record_id = rec
                self._populate_components()

    def _next_action(self):
        return {
            'name': 'Scan Next Return',
            'type': 'ir.actions.act_window',
            'res_model': 'flipkart.return.scan.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': self.env.context,
        }

    def action_confirm_and_next(self):
        self.ensure_one()
        self._resolve_return()
        if not self.return_record_id:
            raise UserError(_("No matching return found for scanned ID: %s") % self.tracking_id)

        selected = [
            {'product_id': l.product_id.id, 'qty': l.qty}
            for l in self.component_line_ids if l.selected and l.product_id
        ]
        if selected:
            # Partial inward of the chosen (already-exploded) components.
            self.return_record_id.action_inward_components(selected)
        else:
            # No component list available — fall back to full explosion.
            self.return_record_id.action_confirm_inward()

        return self._next_action()

    def action_reject_and_next(self):
        self.ensure_one()
        self._resolve_return()
        if not self.return_record_id:
            raise UserError(_("No matching return found for scanned ID: %s") % self.tracking_id)

        self.return_record_id.action_reject()
        return self._next_action()


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
