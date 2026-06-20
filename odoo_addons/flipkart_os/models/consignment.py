# -*- coding: utf-8 -*-
import base64
import csv
import io
import logging
import os
import re
import textwrap
from collections import Counter
from datetime import timedelta

from reportlab.graphics.barcode import code128
from reportlab.lib.colors import black, white
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class FlipkartConsignment(models.Model):
    _name = 'flipkart.consignment'
    _description = 'Flipkart Consignment'
    _order = 'create_date desc'
    _inherit = ['mail.thread', 'mail.activity.mixin']

    _LABEL_WIDTH_MM = 55.0
    _LABEL_HEIGHT_MM = 40.0
    _DOT_PITCH_MM = 0.125
    _QZ_CONTENT_SHIFT_MM = 1.0

    name = fields.Char(string='Consignment Number', required=True, copy=False)
    account = fields.Selection([('robifel', 'Robifel'), ('roxxcart', 'Roxxcart')], string='Account', required=True, default='robifel')
    warehouse_id = fields.Many2one(
        'stock.warehouse', string='Warehouse', required=True,
        help='Target Flipkart Warehouse / Internal processing warehouse')
    pickup_date = fields.Date(string='Pickup Date', required=True, default=fields.Date.context_today)

    state = fields.Selection([
        ('draft', 'Created'),
        ('rtd', 'RTD'),
        ('picked_up', 'Picked Up'),
        ('inwarded', 'Inwarded'),
        ('rejected', 'Rejected'),
    ], string='Status', readonly=True, copy=False, index=True, tracking=3, default='draft')

    csv_file = fields.Binary(string='Upload CSV')
    csv_file_name = fields.Char(string='CSV File Name')

    line_ids = fields.One2many('flipkart.consignment.line', 'consignment_id', string='Consignment Lines')
    box_ids = fields.One2many('flipkart.box', 'consignment_id', string='Boxes')
    picking_id = fields.Many2one('stock.picking', string='Stock Picking', readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        return super().create(vals_list)

    def action_parse_csv(self):
        self.ensure_one()
        if not self.csv_file:
            raise UserError(_("Please upload a CSV file first."))

        try:
            csv_data = base64.b64decode(self.csv_file).decode('utf-8')
            data_file = io.StringIO(csv_data)
            reader = csv.DictReader(data_file)

            lines_to_create = []
            for row in reader:
                lines_to_create.append((0, 0, {
                    'product_name': row.get('Product Name'),
                    'fsn': row.get('FSN'),
                    'sku_id': row.get('SKU Id'),
                    'brand': row.get('Brand'),
                    'size': row.get('Size'),
                    'style_code': row.get('Style Code'),
                    'color': row.get('Color'),
                    'isbn': row.get('Isbn'),
                    'model_id': row.get('Model Id'),
                    'quantity_sent': int(row.get('Quantity Sent', 0)) if row.get('Quantity Sent') and row.get('Quantity Sent').isdigit() else 0,
                    'quantity_received': int(row.get('Quantity Received', 0)) if row.get('Quantity Received') and row.get('Quantity Received').isdigit() else 0,
                    'inwarded_to_store': row.get('Inwarded to Store'),
                    'qc_fail': row.get('QC Fail ', row.get('QC Fail')),
                    'qc_in_progress': row.get('QC In Progress'),
                    'qc_passed': row.get('QC Passed'),
                    'cost_price': float(row.get('Cost Price', 0.0)) if row.get('Cost Price') and row.get('Cost Price').replace('.', '', 1).isdigit() else 0.0,
                    'length_cm': float(row.get('Length(In cms)', 0.0)) if row.get('Length(In cms)') and row.get('Length(In cms)').replace('.', '', 1).isdigit() else 0.0,
                    'breadth_cm': float(row.get('Breadth(In cms)', 0.0)) if row.get('Breadth(In cms)') and row.get('Breadth(In cms)').replace('.', '', 1).isdigit() else 0.0,
                    'height_cm': float(row.get('Height(In cms)', 0.0)) if row.get('Height(In cms)') and row.get('Height(In cms)').replace('.', '', 1).isdigit() else 0.0,
                    'weight_kg': float(row.get('Weight(In kgs)', 0.0)) if row.get('Weight(In kgs)') and row.get('Weight(In kgs)').replace('.', '', 1).isdigit() else 0.0,
                }))

            if self.line_ids:
                self.line_ids.unlink()

            self.write({'line_ids': lines_to_create})
        except Exception as error:
            raise UserError(_("Error parsing CSV file: %s") % str(error))

    def action_mark_rtd(self):
        self.ensure_one()
        if not self.line_ids:
            raise UserError(_("Please upload and parse a CSV file before marking as RTD."))
        self.state = 'rtd'

    def action_mark_picked_up(self):
        self.ensure_one()

        for box in self.box_ids:
            box.write({
                'length': 0.0,
                'breadth': 0.0,
                'height': 0.0,
                'weight': 0.0,
            })

        stock_move_enabled = self.env['ir.config_parameter'].sudo().get_param(
            'flipkart_os.consignment_stock_move_enabled', 'True') == 'True'
        if not stock_move_enabled:
            self.state = 'picked_up'
            return

        warehouse = self.env['stock.warehouse'].search([('code', '=', 'MAIN')], limit=1) or \
                    self.warehouse_id or \
                    self.env['stock.warehouse'].search([], limit=1)
        if not warehouse:
            raise UserError(_("No warehouse found."))

        picking_type = warehouse.out_type_id
        location_src = warehouse.lot_stock_id
        location_dest = self.env.ref('stock.stock_location_customers')
        multi_barcode = self.env['sr.multi.barcode']

        if not self.picking_id:
            picking = self.env['stock.picking'].create({
                'picking_type_id': picking_type.id,
                'location_id': location_src.id,
                'location_dest_id': location_dest.id,
                'origin': "Consignment: %s" % self.name,
            })

            move_vals_list = []
            bom_cache = {}

            fsn_list = self.line_ids.mapped('fsn')
            barcode_recs = multi_barcode.search([('name', 'in', fsn_list)])
            fsn_to_product = {barcode.name: barcode.product_id for barcode in barcode_recs if barcode.product_id}

            for line in self.line_ids:
                product = fsn_to_product.get(line.fsn) or self.env['flipkart.listing'].search([('fsn', '=', line.fsn)], limit=1).product_id
                if not product:
                    continue

                results_map = {}
                self._recursive_explode(product.id, line.quantity_sent, results_map, bom_cache)

                for comp_id, comp_qty in results_map.items():
                    move_vals_list.append({
                        'name': "Consignment %s: %s" % (self.name, line.fsn),
                        'product_id': comp_id,
                        'product_uom_qty': comp_qty,
                        'quantity': comp_qty,
                        'product_uom': self.env['product.product'].browse(comp_id).uom_id.id,
                        'location_id': location_src.id,
                        'location_dest_id': location_dest.id,
                        'picking_id': picking.id,
                        'picked': True,
                    })

            if move_vals_list:
                self.env['stock.move'].create(move_vals_list)
                picking.action_confirm()
                picking.action_assign()
                picking.button_validate()
                self.picking_id = picking.id

        self.state = 'picked_up'

    def _recursive_explode(self, product_id, qty, results_map, bom_cache=None):
        if bom_cache is None:
            bom_cache = {}
        if product_id in bom_cache:
            result = bom_cache[product_id]
        else:
            self.env.cr.execute("""
                SELECT id FROM mrp_bom
                WHERE (product_id = %s OR product_tmpl_id = (SELECT product_tmpl_id FROM product_product WHERE id = %s))
                AND type = 'phantom' AND active = True LIMIT 1
            """, (product_id, product_id))
            result = self.env.cr.fetchone()
            bom_cache[product_id] = result

        if result:
            bom_id = result[0]
            self.env.cr.execute("SELECT product_id, product_qty FROM mrp_bom_line WHERE bom_id = %s", (bom_id,))
            lines = self.env.cr.fetchall()
            if lines:
                for comp_id, comp_qty in lines:
                    self._recursive_explode(comp_id, qty * (comp_qty or 1.0), results_map, bom_cache)
                return
        results_map[product_id] = results_map.get(product_id, 0.0) + qty

    def action_mark_inwarded(self):
        self.ensure_one()
        self.state = 'inwarded'

    def action_mark_rejected(self):
        self.ensure_one()
        self.state = 'rejected'

    def action_print_all_box_packing_slips_qz(self):
        self.ensure_one()
        if not self.box_ids:
            raise UserError(_("Please add at least one box before printing packing slips."))

        tspl_parts = []
        for box in self.box_ids:
            pdf_content = box._build_packing_slip_pdf()
            tspl_content = box._rasterize_packing_slip_to_tspl(pdf_content)
            tspl_parts.extend([tspl_content, tspl_content])

        attachment = self.env['ir.attachment'].create({
            'name': 'PackingSlips_%s_2copies.tspl' % self.name,
            'type': 'binary',
            'raw': b''.join(tspl_parts),
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
                'name': 'All Box Packing Slips %s' % self.name,
            },
        }

    def _module_root_path(self):
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def _module_file_path(self, *parts):
        return os.path.join(self._module_root_path(), *parts)

    def _register_label_fonts(self):
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        candidates = [
            ('BarlowCdSemiBold', 'BarlowCondensed-SemiBold.ttf'),
            ('BarlowCdBold', 'BarlowCondensed-Bold.ttf'),
            ('RobotoCdBold', 'RobotoCondensed-Bold.ttf'),
            ('Helvetica-Bold', None),
        ]
        for font_name, font_file in candidates:
            if not font_file:
                return font_name
            font_path = self._module_file_path(font_file)
            if os.path.exists(font_path):
                try:
                    pdfmetrics.registerFont(TTFont(font_name, font_path))
                    return font_name
                except Exception:
                    continue
        return 'Helvetica-Bold'

    def _normalize_spaces(self, value):
        return re.sub(r'\s+', ' ', (value or '')).strip()

    def _strip_brand(self, text, brand):
        cleaned = self._normalize_spaces(text)
        brand = self._normalize_spaces(brand)
        if brand:
            cleaned = re.sub(re.escape(brand), '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s*[-,:/]+\s*$', '', cleaned)
        return self._normalize_spaces(cleaned)

    def _format_dimension(self, value, default):
        number = float(value or default)
        if number.is_integer():
            return str(int(number))
        return ('%.1f' % number).rstrip('0').rstrip('.')

    def _format_previous_month(self):
        today = fields.Date.context_today(self)
        previous_month_date = today.replace(day=1) - timedelta(days=1)
        return previous_month_date.strftime("%b '%Y")

    def _is_paint_category(self, category):
        cat = (category or '').lower()
        if 'nail paint remover' in cat:
            return False
        return 'paint' in cat

    def _compute_generic_name(self, product_name, category, brand):
        combined_name = '%s %s' % (product_name or '', (category or '').replace('_', ' '))
        words = re.findall(r'\w+', combined_name.lower())
        brand_words = re.findall(r'\w+', (brand or '').lower())
        counts = Counter(word for word in words if word not in brand_words)
        repeated_words = [word.capitalize() for word, count in counts.items() if count > 1]
        return ' '.join(repeated_words) or self._strip_brand(product_name, brand)

    def _manufacturer_details(self):
        if self.account == 'roxxcart':
            return {
                'manufacturer': 'Roxxcart, 209, Paleja House, Bhandari Street, Mumbai - 400003',
                'support_email': 'support@roxxcart.com',
                'support_phone': '+919930405234',
            }
        return {
            'manufacturer': 'Robifel, 207, Paleja House, Bhandari Street, Mandvi, Mumbai - 400003',
            'support_email': 'support@robifel.in',
            'support_phone': '+919930405195',
        }

    def _build_label_payload(self, line, listing):
        support = self._manufacturer_details()
        product_title = (listing.name if listing and listing.name else False) or line.product_name or ''
        brand = line.brand or ''
        model_name = self._strip_brand(product_title, brand) or self._strip_brand(line.product_name, brand) or product_title
        category = (listing.category if listing else '') or line.product_name or ''
        mrp_value = int(listing.mrp) if listing and listing.mrp else int(line.cost_price or 0)
        sku_id = ((listing.sku if listing and listing.sku else False) or line.sku_id or '').strip()
        generic_source_name = product_title or line.product_name or ''
        return {
            'fsn': (line.fsn or '').strip(),
            'sku_id': sku_id,
            'product_name': line.product_name or '',
            'brand': brand,
            'generic_name': self._compute_generic_name(generic_source_name, category, brand),
            'model_name': model_name,
            'type_text': (category or '').replace('_', ' ').title(),
            'mrp_value': mrp_value,
            'mfg_date': self._format_previous_month(),
            'dimensions_text': '%scm x %scm x %scm' % (
                self._format_dimension(line.length_cm, 20),
                self._format_dimension(line.breadth_cm, 10),
                self._format_dimension(line.height_cm, 5),
            ),
            'manufacturer': support['manufacturer'],
            'support_email': support['support_email'],
            'support_phone': support['support_phone'],
            'quantity': max(line.quantity_sent or 0, 0),
            'is_paint': self._is_paint_category(category),
            'bis_image_path': self._module_file_path('static', 'src', 'img', 'BIS_clean.png'),
            'bis_bmp_path': self._module_file_path('static', 'src', 'img', 'BIS.bmp'),
        }

    def _build_label_payloads(self):
        fsn_list = [l.fsn for l in self.line_ids if l.fsn]
        listings_by_fsn = {}
        if fsn_list:
            for listing in self.env['flipkart.listing'].search([('fsn', 'in', fsn_list)]):
                listings_by_fsn[listing.fsn] = listing
        return [
            self._build_label_payload(line, listings_by_fsn.get(line.fsn) if line.fsn else False)
            for line in self.line_ids
        ]

    def _mm(self, value):
        return value * mm

    def _snap_mm(self, value_mm):
        return round(value_mm / self._DOT_PITCH_MM) * self._DOT_PITCH_MM

    def _wrap_separator_lines(self, text, width=23):
        lines = textwrap.wrap(text or '', width=width) or ['']
        return lines[:2]

    def _draw_separator_page(self, pdf, width, height, font_name, payload):
        pdf.setFillColor(black)
        pdf.rect(0, 0, width, height, fill=1, stroke=0)
        pdf.setFillColor(white)
        pdf.setFont(font_name, 14)
        pdf.drawCentredString(width / 2.0, height - self._mm(9.5), payload['fsn'])
        pdf.setFont(font_name, 12)
        separator_lines = self._wrap_separator_lines(payload['sku_id'])
        sku_line1_y_mm = 15.5
        sku_leading_mm = 12 * 1.1 / 2.8346   # 1.1 line-height × 12pt → mm
        pdf.drawCentredString(width / 2.0, height - self._mm(sku_line1_y_mm), separator_lines[0])
        if len(separator_lines) > 1:
            sku_line2_y_mm = sku_line1_y_mm + sku_leading_mm
            pdf.drawCentredString(width / 2.0, height - self._mm(sku_line2_y_mm), separator_lines[1])
            last_sku_y_mm = sku_line2_y_mm
        else:
            last_sku_y_mm = sku_line1_y_mm
        qty_leading_mm = 10 * 1.4 / 2.8346   # 1.4 line-height × 10pt → mm
        qty_y_mm = last_sku_y_mm + qty_leading_mm
        pdf.setFont(font_name, 10)
        pdf.drawCentredString(width / 2.0, height - self._mm(qty_y_mm), 'Qty to print: %s' % payload['quantity'])
        pdf.setFont(font_name, 10)
        pdf.drawCentredString(width / 2.0, height - self._mm(30.0), 'BATCH SEPARATOR')
        pdf.showPage()

    def _draw_consignment_summary_page(self, pdf, width, height, font_name):
        account_label = dict(self._fields['account'].selection).get(self.account, self.account or '')
        pickup_date = fields.Date.to_date(self.pickup_date) if self.pickup_date else False
        pickup_text = pickup_date.strftime('%d/%m/%y') if pickup_date else ''
        lines = [
            'Consignment No: %s' % (self.name or ''),
            'Pickup Date: %s' % pickup_text,
            account_label or '',
        ]
        y_mm = 14.0
        pdf.setFillColor(black)
        pdf.setFont(font_name, 11)
        for index, line in enumerate(lines):
            pdf.drawCentredString(width / 2.0, height - self._mm(y_mm + (index * 6.0)), line)
        pdf.showPage()

    def _draw_paint_bis_block(self, pdf, payload, x_mm=31.0, y_mm=9.0, width_mm=20.0, height_mm=8.5, preserve_aspect=True):
        bis_path = payload['bis_image_path']
        if not payload['is_paint'] or not os.path.exists(bis_path):
            return
        image = ImageReader(bis_path)
        pdf.drawImage(
            image,
            self._mm(x_mm),
            self._mm(y_mm),
            width=self._mm(width_mm),
            height=self._mm(height_mm),
            preserveAspectRatio=preserve_aspect,
            mask='auto',
            anchor='c',
        )

    def _draw_barcode_block(self, pdf, width, font_name, payload, vertical_shift_mm=0.0):
        fsn = payload['fsn']
        if not fsn:
            return

        modules = len(fsn) * 11 + 35
        dot_pitch = self._DOT_PITCH_MM * mm
        max_width = self._mm(32.0)
        if modules * (2 * dot_pitch) <= max_width:
            bar_width = 2 * dot_pitch
        else:
            bar_width = dot_pitch
        barcode_y_mm = self._snap_mm(5.0 - vertical_shift_mm)
        barcode = code128.Code128(fsn, barHeight=self._mm(4.5), barWidth=bar_width)
        actual_width = barcode.width
        barcode_x = (width - actual_width) / 2.0
        barcode.drawOn(pdf, barcode_x, self._mm(barcode_y_mm))
        pdf.setFont(font_name, 7)
        pdf.drawCentredString(barcode_x + actual_width / 2.0, self._mm(1.8 - vertical_shift_mm), fsn)

    def _draw_product_page(self, pdf, width, height, font_name, payload, skip_barcode=False, vertical_shift_mm=0.0):
        pdf.setFillColor(black)
        pdf.setFont(font_name, 6)

        x_left = 2.0 * mm
        x_right = (22.0 if payload['is_paint'] else 31.0) * mm
        y_top = (38.0 - vertical_shift_mm) * mm

        pdf.drawString(x_left, y_top, 'SKU ID : %s' % payload['sku_id'])
        pdf.drawString(x_left, y_top - 2.5 * mm, 'Generic Name : %s' % payload['generic_name'][:50])

        pdf.drawString(x_left, y_top - 5.0 * mm, 'Model Name : ')
        model_label_width = pdf.stringWidth('Model Name : ', font_name, 6)
        model_value_x = x_left + model_label_width + 1.0 * mm
        wrapped_model = textwrap.wrap(payload['model_name'], width=45)
        if wrapped_model:
            pdf.drawString(model_value_x, y_top - 5.0 * mm, wrapped_model[0])
            if len(wrapped_model) > 1:
                pdf.drawString(model_value_x, y_top - 7.5 * mm, wrapped_model[1])

        pdf.drawString(x_left, y_top - 10.0 * mm, 'Type : %s' % payload['type_text'][:30])
        pdf.drawString(x_right, y_top - 10.0 * mm, 'Brand : %s' % payload['brand'])

        pdf.drawString(x_left, y_top - 12.5 * mm, 'Net Quantity : 1 U')
        pdf.drawString(x_right, y_top - 12.5 * mm, 'MRP : Rs %s' % payload['mrp_value'])

        pdf.drawString(x_left, y_top - 15.0 * mm, 'Date of MFG : %s' % payload['mfg_date'])
        incl_text = 'Incl. all taxes' if payload['is_paint'] else 'Inclusive of all taxes'
        pdf.drawString(x_right, y_top - 15.0 * mm, incl_text)

        pdf.drawString(x_left, y_top - 17.5 * mm, 'Dimensions : %s' % payload['dimensions_text'])
        pdf.drawString(x_left, y_top - 20.0 * mm, 'Manufactured and Marketed by :')
        pdf.drawString(x_left, y_top - 22.5 * mm, payload['manufacturer'])

        pdf.drawString(x_left, y_top - 25.0 * mm, 'For Consumer Complaints Please Contact :')
        pdf.drawString(x_left, y_top - 27.5 * mm, 'Support Email : %s' % payload['support_email'])
        pdf.drawString(35.0 * mm, y_top - 27.5 * mm, 'Phone : %s' % payload['support_phone'])

        if payload['is_paint']:
            self._draw_paint_bis_block(pdf, payload, x_mm=33.0, y_mm=20.5 - vertical_shift_mm, width_mm=20.0, height_mm=7.5, preserve_aspect=True)

        pdf.setFont(font_name, 5.5)
        pdf.drawString(x_left, y_top - 30.0 * mm, 'FSN ID &')
        pdf.drawString(x_left, y_top - 32.5 * mm, 'Barcode :')
        if not skip_barcode:
            self._draw_barcode_block(pdf, width, font_name, payload, vertical_shift_mm=vertical_shift_mm)
        pdf.showPage()

    def _build_pdf_content(self, payloads):
        width = self._mm(self._LABEL_WIDTH_MM)
        height = self._mm(self._LABEL_HEIGHT_MM)
        buffer = io.BytesIO()
        font_name = self._register_label_fonts()
        pdf = canvas.Canvas(buffer, pagesize=(width, height), pageCompression=0)
        pdf.setTitle('Consignment Labels %s' % self.name)

        for payload in payloads:
            for _ in range(payload['quantity']):
                self._draw_product_page(pdf, width, height, font_name, payload)
            self._draw_separator_page(pdf, width, height, font_name, payload)

        pdf.save()
        buffer.seek(0)
        return buffer.read()

    def _build_pdf_content_qz(self, payloads):
        """1 label page + 1 separator page per SKU — qty handled by TSPL PRINT command."""
        width = self._mm(self._LABEL_WIDTH_MM)
        height = self._mm(self._LABEL_HEIGHT_MM)
        buffer = io.BytesIO()
        font_name = self._register_label_fonts()
        pdf = canvas.Canvas(buffer, pagesize=(width, height), pageCompression=0)
        pdf.setTitle('QZ Labels %s' % self.name)

        for payload in payloads:
            self._draw_product_page(pdf, width, height, font_name, payload, skip_barcode=True, vertical_shift_mm=self._QZ_CONTENT_SHIFT_MM)
            self._draw_separator_page(pdf, width, height, font_name, payload)
        self._draw_consignment_summary_page(pdf, width, height, font_name)

        pdf.save()
        buffer.seek(0)
        return buffer.read()

    def _create_attachment_download(self, filename, content, mimetype):
        attachment = self.env['ir.attachment'].create({
            'name': filename,
            'type': 'binary',
            'raw': content,
            'res_model': self._name,
            'res_id': self.id,
            'mimetype': mimetype,
            'public': True,
        })
        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content/%s?download=true' % attachment.id,
            'target': 'self',
        }

    def action_generate_barcodes(self):
        self.ensure_one()
        payloads = self._build_label_payloads()
        pdf_content = self._build_pdf_content(payloads)
        return self._create_attachment_download(
            'Barcodes_%s.pdf' % self.name,
            pdf_content,
            'application/pdf',
        )

    def _rasterize_pdf_to_tspl(self, pdf_bytes, payloads):
        """Render each PDF page at exactly 203 DPI via ghostscript → 1-bit TSPL BITMAP.
        Page layout from _build_pdf_content_qz: label(even idx), separator(odd idx).
        Label pages use PRINT {qty},1 so printer repeats natively; separator uses PRINT 1,1."""
        import subprocess
        import tempfile
        import numpy as np
        from PIL import Image

        LABEL_W, LABEL_H = 440, 320   # 55mm × 40mm at 203 DPI
        WIDTH_BYTES = LABEL_W // 8    # 55

        parts = []
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = os.path.join(tmpdir, 'in.pdf')
            with open(pdf_path, 'wb') as f:
                f.write(pdf_bytes)

            # Render at 2× DPI for supersampling — same technique as BarTender
            subprocess.run([
                '/usr/bin/gs', '-dBATCH', '-dNOPAUSE', '-dQUIET',
                '-sDEVICE=pnggray', '-r406',
                '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
                '-sOutputFile=' + os.path.join(tmpdir, 'p_%04d.png'),
                pdf_path,
            ], check=True, timeout=300)

            pages = sorted(
                os.path.join(tmpdir, f)
                for f in os.listdir(tmpdir)
                if f.startswith('p_') and f.endswith('.png')
            )

            for page_idx, page_path in enumerate(pages):
                img = Image.open(page_path).convert('L')
                # Downscale 2× with Lanczos — preserves sharp edges better than 1× render
                img = img.resize((LABEL_W, LABEL_H), Image.LANCZOS)
                # Floyd-Steinberg dithering (PIL default) — matches BarTender's 1-bit conversion
                img_1bit = img.convert('1')
                # TSC TE244 BITMAP: bit=0=print, bit=1=no-print
                # PIL '1': True=white, False=black → astype uint8: 1=no-print ✓, 0=print ✓
                arr = np.array(img_1bit).astype(np.uint8)
                packed = np.packbits(arr, axis=1, bitorder='big')
                row_data = packed.tobytes()

                # Even pages = label; odd pages = separator
                is_label = (page_idx % 2 == 0)
                sku_idx = page_idx // 2
                qty = payloads[sku_idx]['quantity'] if is_label and sku_idx < len(payloads) else 1

                cmd = (
                    b'SIZE 55 mm,40 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
                    + ('BITMAP 0,0,%d,%d,0,' % (WIDTH_BYTES, LABEL_H)).encode()
                    + row_data + b'\r\n'
                )

                if is_label and sku_idx < len(payloads):
                    fsn = (payloads[sku_idx].get('fsn') or '').strip()
                    if fsn:
                        # Native printer barcode — perfect module widths, scannable
                        modules = len(fsn) * 11 + 35
                        narrow = 2 if modules * 2 <= 256 else 1
                        barcode_w = modules * narrow
                        barcode_x = max(0, (LABEL_W - barcode_w) // 2)
                        # Barcode top: 30.5mm from visual top = 244 dots; QZ content is shifted down by 1mm.
                        barcode_y = 244 + int(round(self._QZ_CONTENT_SHIFT_MM / self._DOT_PITCH_MM))
                        cmd += ('BARCODE %d,%d,"128",36,2,0,%d,%d,"%s"\r\n' % (
                            barcode_x, barcode_y, narrow, narrow, fsn)).encode('ascii')

                cmd += ('PRINT %d,1\r\n' % qty).encode()
                parts.append(cmd)

        return b''.join(parts)

    def _action_print_qz_payloads(self, payloads):
        self.ensure_one()
        pdf_content = self._build_pdf_content_qz(payloads)
        tspl_content = self._rasterize_pdf_to_tspl(pdf_content, payloads)

        attachment = self.env['ir.attachment'].create({
            'name': 'Print_%s.tspl' % self.name,
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
                'name': self.name,
            },
        }

    def _action_print_qz_from_wizard(self, wizard_lines):
        self.ensure_one()
        consignment_lines = wizard_lines.mapped('consignment_line_id')
        fsn_list = [line.fsn for line in consignment_lines if line.fsn]
        listings_by_fsn = {}
        if fsn_list:
            for listing in self.env['flipkart.listing'].search([('fsn', 'in', fsn_list)]):
                listings_by_fsn[listing.fsn] = listing

        payloads = []
        for wizard_line in wizard_lines:
            line = wizard_line.consignment_line_id
            payload = self._build_label_payload(line, listings_by_fsn.get(line.fsn) if line.fsn else False)
            payload['quantity'] = wizard_line.quantity
            payloads.append(payload)
        return self._action_print_qz_payloads(payloads)

    def action_print_qz(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Print Direct (QZ)'),
            'res_model': 'flipkart.qz.print.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'active_model': self._name,
                'active_id': self.id,
            },
        }
