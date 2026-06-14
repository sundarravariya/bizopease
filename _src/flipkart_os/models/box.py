from odoo import models, fields, api, _
from odoo.exceptions import UserError
import io
import os


class FlipkartBox(models.Model):
    _name = 'flipkart.box'
    _description = 'Flipkart Box'

    name = fields.Char(string='Box Name', required=True, default='New Box')
    consignment_id = fields.Many2one('flipkart.consignment', string='Consignment', ondelete='cascade')
    line_ids = fields.One2many('flipkart.box.line', 'box_id', string='Box Lines')

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        consignment_id = self.env.context.get('default_consignment_id')
        if consignment_id and 'line_ids' in fields_list:
            consignment = self.env['flipkart.consignment'].browse(consignment_id)
            pending = consignment.line_ids.filtered(lambda l: l.qty_remaining > 0)
            if pending:
                res['line_ids'] = [(0, 0, {
                    'consignment_line_id': line.id,
                    'quantity': line.qty_remaining,
                }) for line in pending]
        return res


    # Box Dimensions (Saved until Picked Up)
    length = fields.Float(string='Length (cm)')
    breadth = fields.Float(string='Breadth (cm)')
    height = fields.Float(string='Height (cm)')
    weight = fields.Float(string='Weight (kg)')

    def _build_packing_slip_pdf(self):
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import mm, inch
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        font_name = "Helvetica"
        font_bold = "Helvetica-Bold"
        barlow_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'BarlowCondensed-SemiBold.ttf')
        if os.path.exists(barlow_path):
            try:
                pdfmetrics.registerFont(TTFont('BarlowCdSemiBold_Slip', barlow_path))
                font_name = "BarlowCdSemiBold_Slip"
                font_bold = "BarlowCdSemiBold_Slip"
            except Exception:
                pass

        page_w = 5.0 * inch
        page_h = 3.0 * inch
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=(page_w, page_h), pageCompression=0)

        margin = 5 * mm
        usable_w = page_w - 2 * margin
        col_sku_w = usable_w * 0.60
        col_fsn_w = usable_w * 0.30
        col_qty_w = usable_w * 0.10
        x_sku = margin
        x_fsn = margin + col_sku_w
        x_qty = margin + col_sku_w + col_fsn_w

        c.setFont(font_bold, 11)
        c.drawString(margin, page_h - 8 * mm, "Packing Slip — %s" % self.name)

        p_date = self.consignment_id.pickup_date
        formatted_date = p_date.strftime('%d/%m/%Y') if p_date else ''
        if formatted_date:
            c.setFont(font_name, 8)
            c.drawRightString(page_w - margin, page_h - 8 * mm, "Pickup Date: %s" % formatted_date)

        consignment_name = self.consignment_id.name or ''
        c.setFont(font_name, 8)
        c.drawString(margin, page_h - 13 * mm, "Consignment No: %s" % consignment_name)
        account = (self.consignment_id.account or '').upper()
        c.drawRightString(page_w - margin, page_h - 13 * mm, "Account: %s" % account)

        c.setLineWidth(0.5)
        c.line(margin, page_h - 16 * mm, page_w - margin, page_h - 16 * mm)

        header_y = page_h - 20 * mm
        row_h = 4.5 * mm
        c.setFont(font_bold, 8.5)
        c.rect(x_sku, header_y - 2 * mm, col_sku_w, row_h, fill=0)
        c.rect(x_fsn, header_y - 2 * mm, col_fsn_w, row_h, fill=0)
        c.rect(x_qty, header_y - 2 * mm, col_qty_w, row_h, fill=0)
        c.drawString(x_sku + 2 * mm, header_y - 0.5 * mm, "SKU ID")
        c.drawString(x_fsn + 2 * mm, header_y - 0.5 * mm, "FSN")
        c.drawCentredString(x_qty + col_qty_w / 2.0, header_y - 0.5 * mm, "Qty")

        y = header_y - 2 * mm - row_h
        c.setFont(font_name, 7.5)
        for line in self.line_ids:
            c.rect(x_sku, y, col_sku_w, row_h, fill=0)
            c.rect(x_fsn, y, col_fsn_w, row_h, fill=0)
            c.rect(x_qty, y, col_qty_w, row_h, fill=0)
            c.drawString(x_sku + 2 * mm, y + 1.2 * mm, (line.sku_id or '')[:45])
            c.drawString(x_fsn + 2 * mm, y + 1.2 * mm, (line.fsn or '')[:20])
            c.drawCentredString(x_qty + col_qty_w / 2.0, y + 1.2 * mm, str(line.quantity))
            y -= row_h
            if y < margin + 2 * mm:
                c.showPage()
                y = page_h - 16 * mm
                c.setFont(font_name, 7.5)

        c.setFont(font_name, 7)
        footer_text = "Total SKUs: %d   |   Total Units: %d" % (
            len(self.line_ids), sum(l.quantity for l in self.line_ids))
        if self.length or self.breadth or self.height:
            footer_text += "   |   Dims: %sx%sx%s cm" % (self.length, self.breadth, self.height)
        if self.weight:
            footer_text += "   |   Weight: %s kg" % self.weight
        c.drawCentredString(page_w / 2.0, margin, footer_text)
        c.save()
        buffer.seek(0)
        return buffer.read()

    def _rasterize_packing_slip_to_tspl(self, pdf_bytes):
        """Ghostscript → 1-bit PNG → TSPL BITMAP at 203 DPI for 5×3 inch slip."""
        import subprocess
        import tempfile
        import numpy as np
        from PIL import Image

        # Portrait label stock: 3" wide × 5" tall (76mm × 127mm)
        # PDF is landscape — rotate 90° CW to fit portrait label
        SLIP_W = int(round(3.0 * 203))    # 609 dots (physical print width)
        SLIP_H = int(round(5.0 * 203))    # 1015 dots (feed direction)
        WIDTH_BYTES = (SLIP_W + 7) // 8   # 77

        parts = []
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = os.path.join(tmpdir, 'slip.pdf')
            with open(pdf_path, 'wb') as f:
                f.write(pdf_bytes)

            subprocess.run([
                '/usr/bin/gs', '-dBATCH', '-dNOPAUSE', '-dQUIET',
                '-sDEVICE=pnggray', '-r406',
                '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
                '-sOutputFile=' + os.path.join(tmpdir, 'p_%04d.png'),
                pdf_path,
            ], check=True, timeout=120)

            pages = sorted(
                os.path.join(tmpdir, fn)
                for fn in os.listdir(tmpdir)
                if fn.startswith('p_') and fn.endswith('.png')
            )

            for page_path in pages:
                img = Image.open(page_path).convert('L')
                # Rotate landscape PDF content 90° CW → fits portrait label stock
                img = img.transpose(Image.Transpose.ROTATE_270)
                img = img.resize((SLIP_W, SLIP_H), Image.LANCZOS)
                img_1bit = img.convert('1')
                arr = np.array(img_1bit).astype(np.uint8)
                packed = np.packbits(arr, axis=1, bitorder='big')
                row_data = packed.tobytes()

                parts.append(
                    ('SIZE 76 mm,127 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
                     'BITMAP 0,0,%d,%d,0,' % (WIDTH_BYTES, SLIP_H)).encode()
                    + row_data
                    + b'\r\nPRINT 1,1\r\n'
                )

        return b''.join(parts)

    def action_print_packing_slip(self):
        self.ensure_one()
        pdf_content = self._build_packing_slip_pdf()
        attachment = self.env['ir.attachment'].create({
            'name': 'PackingSlip_%s.pdf' % self.name,
            'type': 'binary',
            'raw': pdf_content,
            'res_model': self._name,
            'res_id': self.id,
            'mimetype': 'application/pdf',
        })
        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content/%s?download=true' % attachment.id,
            'target': 'new',
        }

    def action_print_packing_slip_qz(self):
        self.ensure_one()
        pdf_content = self._build_packing_slip_pdf()
        tspl_content = self._rasterize_packing_slip_to_tspl(pdf_content)
        attachment = self.env['ir.attachment'].create({
            'name': 'PackingSlip_%s.tspl' % self.name,
            'type': 'binary',
            'raw': tspl_content,
            'res_model': self._name,
            'res_id': self.id,
            'mimetype': 'application/octet-stream',
            'public': True,
        })
        return {
            'type': 'ir.actions.client',
            'tag': 'flipkart_qz_print',
            'params': {
                'attachment_id': attachment.id,
                'name': 'Packing Slip %s' % self.name,
            },
        }


    def action_add_all_pending(self):
        self.ensure_one()
        if not self.consignment_id:
            return
        already = self.line_ids.mapped('consignment_line_id')
        pending = self.consignment_id.line_ids.filtered(
            lambda l: l.qty_remaining > 0 and l not in already
        )
        for line in pending:
            self.env['flipkart.box.line'].create({
                'box_id': self.id,
                'consignment_line_id': line.id,
                'quantity': line.qty_remaining,
            })

    def unlink(self):
        affected = self.mapped('line_ids.consignment_line_id')
        res = super().unlink()
        affected._compute_qty_remaining()
        return res


class FlipkartBoxLine(models.Model):
    _name = 'flipkart.box.line'
    _description = 'Flipkart Box Line'

    box_id = fields.Many2one('flipkart.box', string='Box', required=True, ondelete='cascade')
    consignment_line_id = fields.Many2one('flipkart.consignment.line', string='SKU ID', required=True, ondelete='cascade')
    sku_id = fields.Char(related='consignment_line_id.sku_id', string='SKU', readonly=True)
    fsn = fields.Char(related='consignment_line_id.fsn', string='FSN', readonly=True)
    quantity = fields.Integer(string='Qty in Box', required=True, default=1)
    qty_remaining = fields.Integer(related='consignment_line_id.qty_remaining', string='Rem. Qty', readonly=True)
    used_ids = fields.Many2many('flipkart.consignment.line', compute='_compute_used_ids')

    @api.depends('box_id.line_ids.consignment_line_id')
    def _compute_used_ids(self):
        for rec in self:
            rec.used_ids = rec.box_id.line_ids.filtered(
                lambda l: l.id != rec.id and l.consignment_line_id
            ).mapped('consignment_line_id')

    @api.onchange('consignment_line_id')
    def _onchange_consignment_line_id(self):
        if not self.consignment_line_id:
            return
        # Block if already in current box (live, before save)
        if self.box_id:
            dup = self.box_id.line_ids.filtered(
                lambda l: l.consignment_line_id == self.consignment_line_id and l != self
            )
            if dup:
                self.consignment_line_id = False
                return {'warning': {'title': 'Already Added', 'message': 'This SKU is already in this box.'}}
        # Set qty to remaining from DB minus other saved allocations
        already = self.env['flipkart.box.line'].search([
            ('consignment_line_id', '=', self.consignment_line_id.id),
            ('id', '!=', self._origin.id or 0),
        ])
        max_qty = self.consignment_line_id.quantity_sent - sum(already.mapped('quantity'))
        self.quantity = max(max_qty, 0)

    @api.onchange('quantity')
    def _onchange_quantity_cap(self):
        if not self.consignment_line_id or not self.quantity:
            return
        already = self.env['flipkart.box.line'].search([
            ('consignment_line_id', '=', self.consignment_line_id.id),
            ('id', '!=', self._origin.id or 0),
        ])
        max_qty = self.consignment_line_id.quantity_sent - sum(already.mapped('quantity'))
        if self.quantity > max_qty:
            self.quantity = max_qty
            return {'warning': {'title': 'Qty Capped', 'message': 'Max remaining: %d' % max_qty}}

    @api.constrains('quantity', 'consignment_line_id')
    def _check_quantity_limit(self):
        for rec in self:
            if not rec.consignment_line_id:
                continue
            others = self.env['flipkart.box.line'].search([
                ('consignment_line_id', '=', rec.consignment_line_id.id),
                ('id', '!=', rec.id),
            ])
            allocated = sum(others.mapped('quantity'))
            if allocated + rec.quantity > rec.consignment_line_id.quantity_sent:
                raise UserError(_(
                    '"%s" exceeds consignment qty (%d). Remaining: %d'
                ) % (
                    rec.consignment_line_id.sku_id,
                    rec.consignment_line_id.quantity_sent,
                    rec.consignment_line_id.quantity_sent - allocated,
                ))

    @api.constrains('consignment_line_id', 'box_id')
    def _check_no_duplicate(self):
        for rec in self:
            if not rec.consignment_line_id or not rec.box_id:
                continue
            dup = self.env['flipkart.box.line'].search([
                ('box_id', '=', rec.box_id.id),
                ('consignment_line_id', '=', rec.consignment_line_id.id),
                ('id', '!=', rec.id),
            ], limit=1)
            if dup:
                raise UserError(_('"%s" is already in this box.') % rec.consignment_line_id.sku_id)

    def unlink(self):
        affected = self.mapped('consignment_line_id')
        res = super().unlink()
        affected._compute_qty_remaining()
        return res
