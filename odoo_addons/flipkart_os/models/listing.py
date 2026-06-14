import base64
import xlrd
from odoo import models, fields, api, _
from odoo.exceptions import UserError

class FlipkartListing(models.Model):
    _name = 'flipkart.listing'
    _description = 'Flipkart Master Listing'
    _rec_name = 'fsn'

    fsn = fields.Char(string='FSN', required=True, index=True)
    sku = fields.Char(string='SKU')
    name = fields.Char(string='Product Title')
    category = fields.Char(string='Sub-category')
    mrp = fields.Float(string='MRP')
    selling_price = fields.Float(string='Selling Price')
    length_cm = fields.Float(string='Length (cm)')
    breadth_cm = fields.Float(string='Breadth (cm)')
    height_cm = fields.Float(string='Height (cm)')
    weight_kg = fields.Float(string='Weight (kg)')
    manufacturer = fields.Text(string='Manufacturer Details')
    packer = fields.Text(string='Packer Details')

    _sql_constraints = [
        ('fsn_uniq', 'unique (fsn)', 'The FSN must be unique!')
    ]

class FlipkartListingUpload(models.TransientModel):
    _name = 'flipkart.listing.upload'
    _description = 'Upload Flipkart Listing XLS'

    xls_file = fields.Binary(string='Upload XLS', required=True)
    xls_file_name = fields.Char(string='File Name')

    def action_upload(self):
        self.ensure_one()
        if not self.xls_file:
            raise UserError("Please upload an XLS file.")

        file_content = base64.b64decode(self.xls_file)
        try:
            book = xlrd.open_workbook(file_contents=file_content)
            sheet = book.sheet_by_index(0)
        except Exception as e:
            raise UserError(f"Failed to read XLS file. Make sure it is a valid Excel format. Error: {str(e)}")

        header = sheet.row_values(0)
        col_map = {str(name).strip(): idx for idx, name in enumerate(header)}

        Listing = self.env['flipkart.listing']
        
        fsn_col = col_map.get('Flipkart Serial Number', 4)
        
        for row_idx in range(1, sheet.nrows):
            row = sheet.row_values(row_idx)
            if row_idx >= sheet.nrows or len(row) <= fsn_col:
                continue

            fsn = str(row[fsn_col]).strip()
            if not fsn:
                continue
                
            def get_val(col_name, default_idx, row_list):
                idx = col_map.get(col_name)
                if idx is None:
                    idx = default_idx
                if idx < len(row_list):
                    return row_list[idx]
                return ""
            
            def get_float(col_name, default_idx, row_list):
                val = get_val(col_name, default_idx, row_list)
                try:
                    return float(val) if val else 0.0
                except (ValueError, TypeError):
                    return 0.0

            vals = {
                'name': str(get_val('Product Title', 0, row)),
                'sku': str(get_val('Seller SKU Id', 1, row)),
                'category': str(get_val('Sub-category', 3, row)),
                'mrp': get_float('MRP', 8, row),
                'selling_price': get_float('Your Selling Price', 10, row),
                'length_cm': get_float('Package Length - Length of the package in cms', 19, row),
                'breadth_cm': get_float('Package Breadth - Breadth of the package in cms', 20, row),
                'height_cm': get_float('Package Height - Height of the package in cms', 21, row),
                'weight_kg': get_float('Package Weight - Weight of the package in Kgs', 22, row),
                'manufacturer': str(get_val('Manufacturer Details', 30, row)),
                'packer': str(get_val('Packer Details', 32, row)),
            }

            existing = Listing.search([('fsn', '=', fsn)], limit=1)
            if existing:
                existing.write(vals)
            else:
                vals['fsn'] = fsn
                Listing.create(vals)

        return {'type': 'ir.actions.client', 'tag': 'reload'}
