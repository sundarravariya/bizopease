# -*- coding: utf-8 -*-
{
    'name': 'Biz Money Manager',
    'version': '18.0.1.0.0',
    'category': 'Accounting/Accounting',
    'summary': 'Money Manager, vendor/associate ledgers and expenses (non-Flipkart)',
    'description': """
        Biz Money Manager
        =================
        Cash-flow / money-management toolkit for businesses that are NOT on
        Flipkart. Tracks bill-payment vendors, money associates, their ledgers,
        owner-level expenses and associate-to-associate transfers. Mirrors the
        Business OS money manager without any Flipkart (carrying-agent /
        settlement) coupling.
    """,
    'author': 'Robifel',
    'depends': ['base', 'mail', 'account', 'hr'],
    'data': [
        'security/ir.model.access.csv',
        'data/sequence.xml',
        'views/money_views.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
