# -*- coding: utf-8 -*-
"""
Flipkart Sales Period Comparison Report
=======================================
On-demand comparison of product sales for the current period vs the previous
period (weekly or monthly), with unit-drop% attention scoring. Reads the unified
analytics store `flipkart.sales.dashboard` (is_fsn_row=True rows only, so units
are kit/FSN level and not inflated by BOM component rows). The dashboard already
contains BOTH Flipkart-uploaded sales and Odoo-direct sales (reverse-synced as
"Odoo Store"), so this report is combined by construction.
"""
from datetime import timedelta

from odoo import models, fields, api, _


class FlipkartSalesPeriodReport(models.TransientModel):
    _name = 'flipkart.sales.period.report'
    _description = 'Flipkart Sales Period Comparison'
    _order = 'impact_score desc'

    period_type = fields.Selection(
        [('week', 'Weekly'), ('month', 'Monthly')], string='Period')
    fsn = fields.Char(string='FSN')          # Flipkart Product Id
    seller_sku = fields.Char(string='SKU ID')  # seller-defined SKU
    cur_units = fields.Integer(string='This Period')
    prev_units = fields.Integer(string='Last Period')
    delta_units = fields.Integer(string='Δ Units')
    cur_amount = fields.Float(string='This Period ₹', digits=(12, 2))
    prev_amount = fields.Float(string='Last Period ₹', digits=(12, 2))
    delta_amount = fields.Float(string='Δ Amount', digits=(12, 2))
    # Stored as a FRACTION (e.g. -0.316) so the list's percentage widget renders
    # it as -31.6%. aggregator=False so group headers don't sum percentages.
    pct_change = fields.Float(string='% Change', digits=(16, 4), aggregator=False)
    # 0-100 composite of how much this product's sales MOVED, blending revenue
    # swing (60%) and unit swing (40%), normalised across the result set. Sorting
    # by this surfaces big real movers and pushes trivial 1→0 items to the bottom.
    impact_score = fields.Float(string='Impact', digits=(16, 1), aggregator=False)
    status = fields.Selection([
        ('down', 'Needs Attention'),
        ('stopped', 'Stopped'),
        ('up', 'Performing Well'),
        ('new', 'New'),
        ('flat', 'Flat'),
    ], string='Status')

    @api.model
    def _anchor_date(self):
        """The latest order_date actually present in the sales data. Anchoring the
        comparison windows here (instead of calendar 'today') avoids a fake dip
        from Flipkart's ~2-day upload lag, where the most recent days have no data
        yet. Falls back to today if there is no data."""
        rec = self.env['flipkart.sales.dashboard'].search(
            [('is_fsn_row', '=', True), ('order_date', '!=', False)],
            order='order_date desc', limit=1)
        return rec.order_date if rec else fields.Date.context_today(self)

    @api.model
    def _periods(self, period_type):
        """Return (cur_start, cur_end, prev_start, prev_end), anchored on the most
        recent date that has sales data (not calendar today)."""
        anchor = self._anchor_date()
        if period_type == 'week':
            cur_end = anchor                                  # last 7 days of data
            cur_start = anchor - timedelta(days=6)
            prev_end = cur_start - timedelta(days=1)
            prev_start = prev_end - timedelta(days=6)
        else:
            cur_end = anchor                                  # month-to-anchor
            cur_start = anchor.replace(day=1)
            prev_end = cur_start - timedelta(days=1)          # last day of prev month
            prev_start = prev_end.replace(day=1)
        return cur_start, cur_end, prev_start, prev_end

    @api.model
    def _aggregate(self, d_from, d_to):
        """Units + revenue per Flipkart FSN over [d_from, d_to] from FSN-level
        dashboard rows. Returns {fsn: {'units': int, 'amount': float, 'seller_sku': str}}.
        Sums across any seller_sku variants of the same FSN so each FSN is one row."""
        rows = self.env['flipkart.sales.dashboard'].read_group(
            [('is_fsn_row', '=', True), ('sku_id', '!=', False),
             ('order_date', '>=', d_from), ('order_date', '<=', d_to)],
            ['final_sale_units:sum', 'final_sale_amount:sum'],
            ['sku_id', 'seller_sku'], lazy=False)
        agg = {}
        for r in rows:
            fsn = r.get('sku_id')
            if not fsn:
                continue
            e = agg.setdefault(fsn, {'units': 0, 'amount': 0.0, 'seller_sku': ''})
            e['units'] += int(r['final_sale_units'] or 0)
            e['amount'] += float(r['final_sale_amount'] or 0.0)
            if not e['seller_sku'] and r.get('seller_sku'):
                e['seller_sku'] = r['seller_sku']
        return agg

    @api.model
    def _build(self, period_type):
        cur_start, cur_end, prev_start, prev_end = self._periods(period_type)
        cur = self._aggregate(cur_start, cur_end)
        prev = self._aggregate(prev_start, prev_end)

        # Clear this user's previous transient rows
        self.search([('period_type', '=', period_type)]).unlink()

        # First pass: build raw rows + track max swings for normalisation
        raw = []
        max_da = max_du = 0.0
        for fsn in set(cur) | set(prev):
            cu = cur.get(fsn, {}).get('units', 0)
            pu = prev.get(fsn, {}).get('units', 0)
            ca = cur.get(fsn, {}).get('amount', 0.0)
            pa = prev.get(fsn, {}).get('amount', 0.0)
            du = cu - pu
            da = ca - pa
            if cu == 0 and pu == 0:
                continue
            if pu == 0:
                pct, status = 1.0, 'new'
            elif cu == 0:
                pct, status = -1.0, 'stopped'
            else:
                pct = du / pu            # fraction; percentage widget multiplies by 100
                status = 'down' if du < 0 else ('up' if du > 0 else 'flat')
            seller_sku = cur.get(fsn, {}).get('seller_sku') or prev.get(fsn, {}).get('seller_sku') or ''
            raw.append({
                'fsn': fsn, 'seller_sku': seller_sku,
                'cu': cu, 'pu': pu, 'du': du, 'ca': ca, 'pa': pa, 'da': da,
                'pct': pct, 'status': status,
            })
            max_da = max(max_da, abs(da))
            max_du = max(max_du, abs(du))

        # Second pass: impact = 60% revenue swing + 40% unit swing, normalised 0-100
        max_da = max_da or 1.0
        max_du = max_du or 1.0
        vals = []
        for r in raw:
            impact = 100.0 * (0.6 * abs(r['da']) / max_da + 0.4 * abs(r['du']) / max_du)
            vals.append({
                'period_type': period_type,
                'fsn': r['fsn'], 'seller_sku': r['seller_sku'],
                'cur_units': r['cu'], 'prev_units': r['pu'], 'delta_units': r['du'],
                'cur_amount': r['ca'], 'prev_amount': r['pa'], 'delta_amount': r['da'],
                'pct_change': r['pct'], 'status': r['status'],
                'impact_score': impact,
            })
        return self.create(vals) if vals else self.browse()

    @api.model
    def action_open_weekly(self):
        return self._action_open('week')

    @api.model
    def action_open_monthly(self):
        return self._action_open('month')

    @api.model
    def _action_open(self, period_type):
        recs = self._build(period_type)
        title = _('Weekly Sales Report') if period_type == 'week' else _('Monthly Sales Report')
        return {
            'type': 'ir.actions.act_window',
            'name': title,
            'res_model': 'flipkart.sales.period.report',
            'view_mode': 'list,graph',
            'domain': [('id', 'in', recs.ids)],
            'context': {'search_default_group_status': 1},
            'target': 'current',
        }
