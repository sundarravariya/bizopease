# -*- coding: utf-8 -*-
"""
Flipkart → Odoo Native Sales Sync
====================================
Pushes confirmed Flipkart sales from flipkart.sales.dashboard into
native sale.order / sale.order.line so they appear in the standard
Odoo Sales dashboard, reports, and CRM analytics.

Logic:
- One sale.order per (account, order_date) — "Flipkart [Account] — DD Mon YYYY"
- sale.order is auto-confirmed and locked (state=done)
- Each flipkart.sales.dashboard row → one sale.order.line
- sale_order_line_id field on dashboard records is back-linked
- Re-syncing is safe: existing Flipkart orders are detected and skipped/updated
"""
import logging
from datetime import date, timedelta

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class FlipkartOdooSalesSync(models.TransientModel):
    _name = 'flipkart.odoo.sales.sync'
    _description = 'Sync Flipkart Sales → Odoo Native Sales'

    account_ids = fields.Many2many(
        'flipkart.account', string='Flipkart Accounts',
        help='Leave blank to sync all accounts')
    date_from = fields.Date(
        string='From Date', required=True,
        default=lambda self: date.today() - timedelta(days=30))
    date_to = fields.Date(
        string='To Date', required=True,
        default=lambda self: date.today())
    resync = fields.Boolean(
        string='Re-sync Existing Orders',
        help='If enabled, existing Flipkart sale orders in this date range will be deleted and re-created. Use with caution if invoices exist.',
        default=False)

    def _get_or_create_flipkart_partner(self, account):
        """Get or create a res.partner representing the Flipkart account."""
        Partner = self.env['res.partner']
        ref = f'__flipkart_account_{account.id}__'
        partner = Partner.search([('ref', '=', ref)], limit=1)
        if not partner:
            partner = Partner.create({
                'name': f'Flipkart — {account.name}',
                'ref': ref,
                'customer_rank': 1,
                'is_company': True,
                'comment': 'Auto-created by Flipkart OS for native sales sync.',
            })
            _logger.info("Created Flipkart partner: %s (id=%s)", partner.name, partner.id)
        return partner

    def _get_or_create_pricelist(self):
        """Return the default INR pricelist if it exists, else the first available."""
        Pricelist = self.env['product.pricelist']
        inr_pl = Pricelist.search([('currency_id.name', '=', 'INR')], limit=1)
        if inr_pl:
            return inr_pl
        return Pricelist.search([], limit=1)

    def _build_order_name(self, account, order_date):
        return f'FK/{account.name}/{order_date.strftime("%Y%m%d")}'

    def _delete_existing_orders(self, order_names, partner):
        """Remove previously-synced FK orders (and clear dashboard back-links) so a
        resync can recreate them cleanly. Safe because synced orders carry no
        invoices or stock moves."""
        existing = self.env['sale.order'].search([
            ('name', 'in', order_names),
            ('partner_id', '=', partner.id),
        ])
        if not existing:
            return
        line_ids = existing.order_line.ids
        if line_ids:
            self.env['flipkart.sales.dashboard'].search(
                [('sale_order_line_id', 'in', line_ids)]
            ).write({'sale_order_line_id': False})
        existing.write({'locked': False})
        existing.write({'state': 'draft'})
        existing.unlink()

    def action_sync(self):
        self.ensure_one()

        if self.date_from > self.date_to:
            raise UserError(_("'From Date' must be before 'To Date'."))

        # Determine accounts to sync (exclude "Odoo Store" — already native)
        accounts = (self.account_ids or self.env['flipkart.account'].search([])).filtered(lambda a: a.name != 'Odoo Store')
        if not accounts:
            raise UserError(_("No Flipkart accounts found to sync (excluding Odoo Store)."))

        pricelist = self._get_or_create_pricelist()
        SaleOrder = self.env['sale.order']
        SaleOrderLine = self.env['sale.order.line']
        Dashboard = self.env['flipkart.sales.dashboard']
        tag_ids = self._get_or_create_flipkart_tags().ids

        total_orders = 0
        total_lines = 0

        for account in accounts:
            partner = self._get_or_create_flipkart_partner(account)

            # FSN/kit-level rows only (is_fsn_row=True) → original units, no
            # component-row inflation. Mapped products with real final sales.
            domain = [
                ('account_id', '=', account.id),
                ('order_date', '>=', self.date_from),
                ('order_date', '<=', self.date_to),
                ('final_sale_units', '>', 0),
                ('is_fsn_row', '=', True),
                ('product_id', '!=', False),
            ]
            dashboard_records = Dashboard.search(domain, order='order_date asc')
            if not dashboard_records:
                _logger.info("No Flipkart sales for account %s in %s–%s", account.name, self.date_from, self.date_to)
                continue

            # Group by order_date → one consolidated order per (account, date)
            date_groups = {}
            for rec in dashboard_records:
                date_groups.setdefault(rec.order_date, []).append(rec)

            # On resync, wipe all existing FK orders for these dates up front.
            if self.resync:
                self._delete_existing_orders(
                    [self._build_order_name(account, d) for d in date_groups], partner)

            for order_date, records in date_groups.items():
                order_name = self._build_order_name(account, order_date)

                # Non-resync: skip dates that already have an order.
                if not self.resync and SaleOrder.search_count([
                        ('name', '=', order_name), ('partner_id', '=', partner.id)]):
                    continue

                order_dt = fields.Datetime.to_datetime(str(order_date) + ' 12:00:00')

                sale_order = SaleOrder.create({
                    'name': order_name,
                    'partner_id': partner.id,
                    'date_order': order_dt,
                    'pricelist_id': pricelist.id if pricelist else False,
                    'note': f'Auto-synced from Flipkart OS — Account: {account.name} — Date: {order_date}',
                    'tag_ids': [(6, 0, tag_ids)],
                    'is_flipkart_sync': True,
                })

                order_lines_vals = []
                for rec in records:
                    unit_price = (rec.final_sale_amount / rec.final_sale_units) if rec.final_sale_units else 0.0
                    order_lines_vals.append({
                        'order_id': sale_order.id,
                        'product_id': rec.product_id.id,
                        'name': rec.product_id.display_name or rec.sku_id or 'Flipkart Product',
                        'product_uom_qty': rec.final_sale_units,
                        'price_unit': unit_price,
                        'product_uom': rec.product_id.uom_id.id,
                    })

                if not order_lines_vals:
                    sale_order.unlink()
                    continue

                lines = SaleOrderLine.create(order_lines_vals)
                total_orders += 1
                total_lines += len(lines)

                # Back-link sale_order_line_id (records and lines are 1:1, same order)
                for rec, line in zip(records, lines):
                    rec.sale_order_line_id = line.id

                # Confirm WITHOUT side effects: write state directly. No action_confirm
                # → no procurement/pickings/stock moves, no invoices, back-date kept.
                # Odoo 18: completed = state 'sale' + locked True (no 'done' state).
                sale_order.write({'state': 'sale', 'locked': True})
                # Drain Odoo's deferred recomputes FIRST — the state change queues
                # delivery_status / invoice_status / qty_delivered for recompute, and
                # if we SQL-write before that queue flushes, the recompute clobbers us.
                self.env.flush_all()
                # Now force the presentation state directly in SQL (these orders are
                # pure reporting mirrors — no pickings, invoices, journal entries or
                # receivables are ever created):
                #   • date_order  → the real back-dated sale date
                #   • lines fully delivered (qty_delivered = ordered qty)
                #   • delivery_status 'full'  → shows as Delivered
                #   • invoice_status 'no'     → Nothing to Invoice (no pending amount)
                self.env.cr.execute(
                    "UPDATE sale_order_line SET qty_delivered = product_uom_qty WHERE order_id = %s",
                    (sale_order.id,))
                self.env.cr.execute(
                    "UPDATE sale_order SET date_order = %s, delivery_status = 'full', "
                    "invoice_status = 'no' WHERE id = %s",
                    (order_dt, sale_order.id))
                self.env.invalidate_all()

        _logger.info(
            "Flipkart sync complete: %d orders, %d lines created (accounts: %s, %s to %s)",
            total_orders, total_lines,
            ', '.join(accounts.mapped('name')), self.date_from, self.date_to
        )

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Sync Complete'),
                'message': _(
                    '%d sale orders and %d order lines pushed to Odoo Sales.\n'
                    'Flipkart data is now visible in the native Sales dashboard.'
                ) % (total_orders, total_lines),
                'type': 'success',
                'sticky': True,
                'next': {
                    'type': 'ir.actions.act_window',
                    'res_model': 'sale.order',
                    'view_mode': 'list,form',
                    'views': [[False, 'list'], [False, 'form']],
                    'domain': [('name', 'like', 'FK/')],
                },
            },
        }

    def _get_or_create_flipkart_tags(self):
        """Get or create a CRM tag to mark Flipkart synced orders."""
        Tag = self.env['crm.tag']
        tag = Tag.search([('name', '=', 'Flipkart')], limit=1)
        if not tag:
            tag = Tag.create({'name': 'Flipkart'})
        return tag

    @api.model
    def cron_sync_sales(self):
        """Daily auto-sync. Re-syncs a rolling 45-day window so it picks up the
        2-day Flipkart upload lag (D-2 data appears and gets synced on the next
        run) and month-end re-evaluations (returns/cancellations re-uploaded on
        ~the 3rd replace the dashboard rows, and resync rebuilds corrected orders)."""
        sync_wizard = self.create({
            'date_from': date.today() - timedelta(days=45),
            'date_to': date.today(),
            'resync': True,
        })
        sync_wizard.action_sync()
