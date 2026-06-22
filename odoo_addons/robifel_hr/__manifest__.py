# -*- coding: utf-8 -*-
{
    'name': 'HR Attendance & Salary',
    'version': '18.0.1.0.0',
    'category': 'Human Resources',
    'summary': 'Staff attendance (GPS + selfie), live location, and salary engine',
    'description': 'Portal-driven attendance and salary management for small teams.',
    'author': 'BizOpease',
    'depends': ['base', 'hr', 'hr_attendance'],
    'data': [
        'security/ir.model.access.csv',
        'security/hr_security.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
