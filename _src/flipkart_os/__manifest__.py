{
    'name': 'Business OS',
    'version': '18.0.3.5.0',
    'category': 'Business/Operations',
    'summary': 'Unified Flipkart Operations Analytics & Inventory Management',
    'description': """
        Business OS
        ===========
        Comprehensive business operations management:
        - Advanced Sales Analytics & Performance tracking
        - Daily Orders & Returns automation with BOM Explosion
        - FBF Inventory monitoring & Multi-barcode mapping
        - Smart Replenishment (FBF & Supplier Reorder)
        - Custom Procurement & Agent Accounting (Native Extension)
        - Consolidated Warehouse Operations
    """,
    'author': 'Robifel',
    'depends': ['base', 'web', 'mail', 'stock', 'mrp', 'purchase', 'purchase_stock'],
    'data': [
        'security/ir.model.access.csv',
        'security/ai_security.xml',
        'security/task_security.xml',
        'views/qz_print_wizard_views.xml',
        'views/ai_assistant_views.xml',
        'views/config_views.xml',
        'views/consignment_views.xml',
        'views/listing_views.xml',
        'views/fbf_stock_views.xml',
        'views/sales_dashboard_views.xml',
        'views/fbf_replenishment_views.xml',
        'views/main_replenishment_views.xml',
        'views/upload_wizard_views.xml',
        'views/dead_stock_views.xml',
        'views/daily_order_views.xml',
        'views/returns_views.xml',
        'views/agent_views.xml',
        'views/stock_valuation_views.xml',
        'views/purchase_order_inherit_views.xml',
        'views/partner_ledger_views.xml',
        'views/bill_payment_views.xml',
        'views/unified_ledger_views.xml',
        'views/menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'flipkart_os/static/src/js/lib/qz-tray.min.js',
            'flipkart_os/static/src/js/qz_direct_print.js',
            'flipkart_os/static/src/js/ai_assistant.js',
            'flipkart_os/static/src/xml/ai_assistant.xml',
            'flipkart_os/static/src/css/ai_assistant.css',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
