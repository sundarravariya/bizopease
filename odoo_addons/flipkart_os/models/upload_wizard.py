# -*- coding: utf-8 -*-
import base64
import csv
import io
import logging
from datetime import datetime

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class FlipkartUploadWizard(models.TransientModel):
    _name = 'flipkart.upload.wizard'
    _description = 'Upload Flipkart Data'

    upload_type = fields.Selection([
        ('fbf_inventory', 'FBF Current Inventory'),
        ('sales_data', 'Overall Sales Data'),
    ], string='Data Type', required=True, default='fbf_inventory')

    account_id = fields.Many2one(
        'flipkart.account', string='Account',
        required=True,
        help='Flipkart account this upload belongs to')

    sales_start_date = fields.Date(string='Start Date')
    sales_end_date = fields.Date(string='End Date')

    file_data = fields.Binary(string='Data File', required=True)
    file_name = fields.Char(string='File Name')

    def _safe_float(self, value):
        if not value and value != 0: return 0.0
        try: return float(str(value).strip().replace(',', ''))
        except (ValueError, TypeError): return 0.0

    def _safe_int(self, value):
        try: return int(float(str(value).strip().replace(',', ''))) if value else 0
        except (ValueError, TypeError): return 0

    def action_upload(self):
        self.ensure_one()
        if not self.file_data: raise UserError(_("Please select a file."))
        if self.upload_type == 'fbf_inventory':
            return self._upload_fbf_inventory()
        elif self.upload_type == 'sales_data':
            if not self.account_id: raise UserError(_("Please select the Flipkart Account."))
            if not self.sales_start_date or not self.sales_end_date:
                raise UserError(_("Please select Start and End dates."))
            if self.sales_start_date > self.sales_end_date:
                raise UserError(_("Start Date cannot be after End Date."))
            return self._upload_sales_data()

    def _read_rows(self):
        raw = base64.b64decode(self.file_data)
        fname = (self.file_name or '').lower()
        is_excel = fname.endswith(('.xlsx', '.xls')) or raw[:2] == b'PK'
        if is_excel:
            try: import openpyxl
            except ImportError: raise UserError(_("The 'openpyxl' library is required."))
            wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=False, data_only=True)
            ws = wb.active
            rows_iter = ws.iter_rows(values_only=True)
            header_row = next(rows_iter, None)
            if not header_row: raise UserError(_("Empty Excel file!"))
            headers = [str(h).strip() if h else f'col_{i}' for i, h in enumerate(header_row)]
            result = []
            for row in rows_iter:
                row_dict = {headers[i]: (val if val is not None else '') for i, val in enumerate(row) if i < len(headers)}
                if any(v for v in row_dict.values()): result.append(row_dict)
            wb.close()
            return result
        try: csv_text = raw.decode('utf-8-sig')
        except UnicodeDecodeError: csv_text = raw.decode('latin-1')
        csv_text = csv_text.replace('\x00', '')
        reader = csv.DictReader(io.StringIO(csv_text))
        return list(reader)

    FBF_CSV_MAP = {
        'Warehouse Id': 'flipkart_warehouse_id', 'SKU': 'sku', 'Title': 'title', 'Listing Id': 'listing_id',
        'FSN': 'fsn', 'Brand': 'brand', 'Flipkart Selling Price': 'selling_price', 'Live on Website': 'qty_live',
        'Sales 7D': 'sales_7d', 'Sales 14D': 'sales_14d', 'Sales 30D': 'sales_30d', 'Sales 60D': 'sales_60d', 'Sales 90D': 'sales_90d',
        'B2B Scheduled': 'b2b_scheduled', 'Transfers Scheduled': 'transfers_scheduled', 'B2B Shipped': 'b2b_shipped', 'Transfers Shipped': 'transfers_shipped',
        'B2B Receiving': 'b2b_receiving', 'Transfers Receiving': 'transfers_receiving', 'Reserved for Orders and Recalls': 'reserved_orders',
        'Reserved for Internal Processing': 'reserved_internal', 'Returns Processing': 'returns_processing', 'Orders to Dispatch': 'orders_to_dispatch',
        'Recalls to Dispatch': 'recalls_to_dispatch', 'Damaged': 'damaged', 'QC Reject': 'qc_reject', 'Catalog Reject': 'catalog_reject',
        'Returns Reject': 'returns_reject', 'Seller Return Reject': 'seller_return_reject', 'Miscellaneous': 'miscellaneous',
        'Length (in cm)': 'length_cm', 'Breadth (in cm)': 'breadth_cm', 'Height (in cm)': 'height_cm', 'Weight (in kg)': 'weight_kg',
        'Fulfilment Type': 'fulfilment_type', 'F Assured Badge': 'f_assured',
    }

    FBF_FLOAT_FIELDS = {
        'selling_price', 'qty_live', 'sales_7d', 'sales_14d', 'sales_30d', 'sales_60d', 'sales_90d',
        'b2b_scheduled', 'transfers_scheduled', 'b2b_shipped', 'transfers_shipped', 'b2b_receiving', 'transfers_receiving',
        'reserved_orders', 'reserved_internal', 'returns_processing', 'orders_to_dispatch', 'recalls_to_dispatch',
        'damaged', 'qc_reject', 'catalog_reject', 'returns_reject', 'seller_return_reject', 'miscellaneous',
        'length_cm', 'breadth_cm', 'height_cm', 'weight_kg',
    }

    def _upload_fbf_inventory(self):
        rows = self._read_rows()
        wh_configs = self.env['flipkart.warehouse.config'].search([('account_id', '=', self.account_id.id)])
        wh_map = {wh.flipkart_warehouse_code: wh for wh in wh_configs}
        MultiBarcode = self.env['sr.multi.barcode']
        FbfStock = self.env['flipkart.fbf.stock']
        created = updated = 0
        skipped_wh = set()
        processed_ids = []
        for row in rows:
            wh_code = str(row.get('Warehouse Id') or '').strip()
            fsn = str(row.get('FSN') or '').strip()
            if not fsn: continue
            wh_config = wh_map.get(wh_code)
            if not wh_config:
                skipped_wh.add(wh_code)
                continue
            vals = {'account_id': self.account_id.id, 'warehouse_config_id': wh_config.id, 'last_upload_date': fields.Date.context_today(self)}
            for csv_col, field_name in self.FBF_CSV_MAP.items():
                raw = row.get(csv_col, '')
                vals[field_name] = self._safe_float(raw) if field_name in self.FBF_FLOAT_FIELDS else str(raw).strip() if raw else ''
            barcode_rec = MultiBarcode.search([('name', '=', fsn)], limit=1)
            if barcode_rec and barcode_rec.product_id: vals['product_id'] = barcode_rec.product_id.id
            existing = FbfStock.search([('fsn', '=', fsn), ('warehouse_config_id', '=', wh_config.id), ('account_id', '=', self.account_id.id)], limit=1)
            if existing:
                existing.write(vals)
                updated += 1
                processed_ids.append(existing.id)
            else:
                vals['fsn'] = fsn
                new_rec = FbfStock.create(vals)
                created += 1
                processed_ids.append(new_rec.id)
                
        # Products not in the Excel are NOT zeroed — their last values are kept.
        msg = _("FBF Inventory: %d created, %d updated.") % (created, updated)
        if skipped_wh: msg += _("\nUnmapped warehouse codes: %s") % ', '.join(skipped_wh)
        return self._notification("FBF Inventory Upload", msg)

    def _recursive_explode(self, product_id, qty, results_map):
        # Find BOM for this product template
        self.env.cr.execute("SELECT id FROM mrp_bom WHERE (product_id = %s OR product_tmpl_id = (SELECT product_tmpl_id FROM product_product WHERE id = %s)) AND type = 'phantom' AND active = True LIMIT 1", (product_id, product_id))
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

    def _upload_sales_data(self):
        rows = self._read_rows()
        if not rows: raise UserError(_("No data rows found."))
        Sales = self.env['flipkart.sales.dashboard']
        Sales.search([('account_id', '=', self.account_id.id), ('order_date', '>=', self.sales_start_date), ('order_date', '<=', self.sales_end_date)]).unlink()
        MultiBarcode = self.env['sr.multi.barcode']
        created = 0
        bom_cache = {}
        for row in rows:
            product_id_str = str(row.get('Product Id') or '').strip()
            date_val = row.get('Order Date') or ''
            if not product_id_str: continue
            order_date = self._parse_date_value(date_val)
            if not order_date or order_date < self.sales_start_date or order_date > self.sales_end_date: continue
            
            gross_units = self._safe_int(row.get('Gross Units'))
            cancellation_units = self._safe_int(row.get('Cancellation Units'))
            return_units = self._safe_int(row.get('Return Units'))
            final_sale_units = self._safe_int(row.get('Final Sale Units'))
            gmv = self._safe_float(row.get('GMV'))
            cancel_amount = self._safe_float(row.get('Cancellation Amount'))
            return_amount = self._safe_float(row.get('Return Amount'))
            final_sale_amount = self._safe_float(row.get('Final Sale Amount'))

            base_vals = {
                'account_id': self.account_id.id,
                'order_date': order_date, 'sku_id': product_id_str, 'location_id': str(row.get('Location Id') or '').strip(),
                'fulfillment_type': str(row.get('Fulfillment Type') or '').strip(), 'category': str(row.get('Category') or '').strip(),
                'brand': str(row.get('Brand') or '').strip(), 'vertical': str(row.get('Vertical') or '').strip(),
            }
            
            main_product = MultiBarcode.search([('name', '=', product_id_str)], limit=1).product_id
            if not main_product:
                base_vals.update({'product_id': False, 'gross_units': gross_units, 'gmv': gmv, 'cancellation_units': cancellation_units, 'cancel_amount': cancel_amount, 'return_units': return_units, 'return_amount': return_amount, 'final_sale_units': final_sale_units, 'final_sale_amount': final_sale_amount})
                Sales.create(base_vals); created += 1
                continue

            results_map = {}
            self._recursive_explode(main_product.id, 1.0, results_map)
            for i, (comp_id, qty_mult) in enumerate(results_map.items()):
                has_rev = (i == 0)
                comp_vals = base_vals.copy()
                comp_vals.update({
                    'product_id': comp_id, 'gross_units': int(gross_units * qty_mult), 'gmv': gmv if has_rev else 0.0,
                    'cancellation_units': int(cancellation_units * qty_mult), 'cancel_amount': cancel_amount if has_rev else 0.0,
                    'return_units': int(return_units * qty_mult), 'return_amount': return_amount if has_rev else 0.0,
                    'final_sale_units': int(final_sale_units * qty_mult), 'final_sale_amount': final_sale_amount if has_rev else 0.0,
                })
                Sales.create(comp_vals); created += 1
        return self._notification("Sales Upload", _("Processed %d records.") % created)

    def _parse_date_value(self, val):
        if not val: return None
        if isinstance(val, datetime): return val.date()
        import datetime as dt_module
        if isinstance(val, dt_module.date): return val
        date_str = str(val).strip()
        for fmt in ('%Y-%m-%d', '%d-%b-%Y', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y'):
            try: return datetime.strptime(date_str, fmt).date()
            except ValueError: continue
        return None

    def _notification(self, title, message):
        return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {'title': _(title), 'message': message, 'type': 'success', 'sticky': True, 'next': {'type': 'ir.actions.act_window_close'}}}
