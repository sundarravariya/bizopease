# -*- coding: utf-8 -*-
{
    'name': 'Biz Tasks',
    'version': '18.0.1.0.0',
    'category': 'Productivity/Tasks',
    'summary': 'Lightweight task / assignment tracker (non-Flipkart)',
    'description': """
        Biz Tasks
        =========
        Standalone task and assignment tracker for businesses that are NOT on
        Flipkart. Provides the same Tasks experience as Business OS without any
        Flipkart coupling.
    """,
    'author': 'Robifel',
    'depends': ['base', 'mail', 'hr'],
    'data': [
        'security/ir.model.access.csv',
        'security/task_security.xml',
        'views/task_views.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
