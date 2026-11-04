{
    'name': 'Smart Reconciliation',
    'version': '20.0.1.0.0',
    'category': 'Accounting/Accounting',
    'summary': 'Reconcile a chosen set of invoices of a customer/vendor against that partner\'s payments',
    'depends': ['account'],
    'data': [
        'security/ir.access.csv',
        'views/smart_reconcile_views.xml',
    ],
    'assets': {
        'web.assets_tests': ['smart_reconciliation/static/tests/tours/*.js'],
    },
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
