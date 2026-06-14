{
    'name': 'B2B OS',
    'version': '18.0.7.0',
    'category': 'Sales/B2B',
    'summary': 'B2B Order Request System with Global Gatekeeping & Approval',
    'author': 'Antigravity',
    'description': """
        Full B2B Order Request System for Queenfinger:
        - Global website lockdown (first page is Login/Signup).
        - Extended signup with Phone, Business Name, and Photo.
        - Approval workflow with "Account Under Review" page.
        - Fixed login visibility (handling /web/assets and /website/translations).
        - Footer removed from website.
    """,
    'depends': ['sale_management', 'website_sale', 'auth_signup', 'portal', 'account'],
    'data': [
        'security/ir.model.access.csv',
        'views/menus.xml',
        'views/b2b_category_templates.xml',
        'views/b2b_mobile_nav_templates.xml',
        'views/website_sale_templates.xml',
        'views/b2b_checkout_templates.xml',
        'views/portal_templates.xml',
        'views/portal_ledger_templates.xml',
        'views/sale_order_views.xml',
        'views/stock_availability_views.xml',
        'views/b2b_ledger_views.xml',
        'views/b2b_registration_templates.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'b2b_os/static/src/xml/b2b_cart_notification.xml',
            'b2b_os/static/src/js/b2b_hide_notification_price.js',
            'b2b_os/static/src/css/b2b_style.css',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
