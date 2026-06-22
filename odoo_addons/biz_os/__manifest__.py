# -*- coding: utf-8 -*-
{
    'name': 'Biz OS',
    'version': '18.0.1.0.0',
    'category': 'Business/Operations',
    'summary': 'Business OS analytics over native Odoo sales & stock (non-Flipkart)',
    'description': """
        Biz OS
        ======
        Operations analytics for businesses that are NOT on Flipkart, sourced
        entirely from native Odoo data (sale.order, purchase.order, stock,
        account.move):
        - Dead Stock analysis (sell-through over native sales)
        - Supplier Reorder recommendations (native sales velocity + PO pipeline)
        - Stock Valuation (BOM-exploded, main warehouse)
        - Partner Ledger (receivable/payable) + manual entry wizard
        The native Sales Dashboard is computed live in the portal (no model).
    """,
    'author': 'Robifel',
    'depends': ['base', 'mail', 'stock', 'sale_management', 'purchase', 'account', 'mrp', 'biz_money'],
    'data': [
        'security/ir.model.access.csv',
        'views/dead_stock_views.xml',
        'views/supplier_reorder_views.xml',
        'views/stock_valuation_views.xml',
        'views/ledger_views.xml',
    ],
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
