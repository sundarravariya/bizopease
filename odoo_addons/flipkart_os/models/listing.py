# -*- coding: utf-8 -*-
import base64
import xlrd
from odoo import models, fields, api
from odoo.exceptions import UserError

class FlipkartListing(models.Model):
    _name = 'flipkart.listing'
    _description = 'Flipkart Master Listing'
    _rec_name = 'fsn'

    fsn = fields.Char(string='FSN', required=True, index=True)
    listing_id = fields.Char(string='Listing ID')
    sku = fields.Char(string='SKU')
    name = fields.Char(string='Product Title')
    category = fields.Char(string='Sub-category')
    mrp = fields.Float(string='MRP')
    selling_price = fields.Float(string='Selling Price')
    bank_settlement = fields.Float(string='Bank Settlement', digits=(12, 2))
    length_cm = fields.Float(string='Length (cm)')
    breadth_cm = fields.Float(string='Breadth (cm)')
    height_cm = fields.Float(string='Height (cm)')
    weight_kg = fields.Float(string='Weight (kg)')
    manufacturer = fields.Text(string='Manufacturer Details')
    packer = fields.Text(string='Packer Details')

    _sql_constraints = [
        ('fsn_uniq', 'unique (fsn)', 'The FSN must be unique!')
    ]

    @api.model
    def get_unmapped_fsns(self):
        """Return FSNs from master listing that have no sr.multi.barcode mapping."""
        self.env.cr.execute("""
            SELECT fl.id, fl.fsn, fl.sku, fl.name AS product_name,
                   fl.category, fl.mrp, fl.selling_price, fl.bank_settlement, fl.listing_id
            FROM flipkart_listing fl
            WHERE NOT EXISTS (
                SELECT 1 FROM sr_multi_barcode mb WHERE mb.name = fl.fsn
            )
            ORDER BY fl.fsn
            LIMIT 1000
        """)
        return self.env.cr.dictfetchall()


class FlipkartListingSettlementHistory(models.Model):
    _name = 'flipkart.listing.settlement.history'
    _description = 'Bank Settlement Change History'
    _order = 'upload_date desc, change_pct desc'

    fsn = fields.Char(string='FSN', required=True, index=True)
    sku = fields.Char(string='SKU')
    product_name = fields.Char(string='Product Title')
    upload_date = fields.Date(string='Upload Date', required=True, default=fields.Date.context_today)
    old_settlement = fields.Float(string='Previous Settlement', digits=(12, 2))
    new_settlement = fields.Float(string='New Settlement', digits=(12, 2))
    change_pct = fields.Float(string='Change %', digits=(12, 4))
    urgency = fields.Selection([
        ('urgent', 'Urgent (≥1%)'),
        ('not_urgent', 'Not Urgent (<1%)'),
    ], string='Urgency')


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
        SettlementHistory = self.env['flipkart.listing.settlement.history']

        fsn_col = col_map.get('Flipkart Serial Number', 4)
        today = fields.Date.context_today(self)

        # Settlement column: try common column names from Flipkart Master Listings XLS
        settlement_col_name = None
        for candidate in ('Bank Settlement', 'Your Settlement Amount', 'Settlement Amount', 'Net Settlement'):
            if candidate in col_map:
                settlement_col_name = candidate
                break

        # Listing ID column
        listing_id_col_name = None
        for candidate in ('Listing Id', 'Listing ID', 'listing_id'):
            if candidate in col_map:
                listing_id_col_name = candidate
                break

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
                if idx is not None and idx < len(row_list):
                    return row_list[idx]
                return ""

            def get_float(col_name, default_idx, row_list):
                val = get_val(col_name, default_idx, row_list)
                try:
                    return float(val) if val else 0.0
                except (ValueError, TypeError):
                    return 0.0

            new_bank_settlement = 0.0
            if settlement_col_name:
                new_bank_settlement = get_float(settlement_col_name, None, row)

            new_listing_id = ''
            if listing_id_col_name:
                new_listing_id = str(get_val(listing_id_col_name, None, row)).strip()

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
                'listing_id': new_listing_id,
                'bank_settlement': new_bank_settlement,
            }

            existing = Listing.search([('fsn', '=', fsn)], limit=1)
            if existing:
                old_bank_settlement = existing.bank_settlement
                existing.write(vals)
                # Only track genuine changes — both old and new must be non-zero.
                # Skips first-time population (old=0 → new=X) which would wrongly show 100%.
                if (old_bank_settlement != 0.0 and new_bank_settlement != 0.0
                        and old_bank_settlement != new_bank_settlement):
                    change_pct = abs((new_bank_settlement - old_bank_settlement) / old_bank_settlement) * 100.0
                    SettlementHistory.create({
                        'fsn': fsn,
                        'sku': vals.get('sku', ''),
                        'product_name': vals.get('name', ''),
                        'upload_date': today,
                        'old_settlement': old_bank_settlement,
                        'new_settlement': new_bank_settlement,
                        'change_pct': change_pct,
                        'urgency': 'urgent' if change_pct >= 1.0 else 'not_urgent',
                    })
            else:
                vals['fsn'] = fsn
                Listing.create(vals)

        return {'type': 'ir.actions.client', 'tag': 'reload'}
