{
    'name': 'Invoice Customization',
    'version': '20.0.1.0.0',
    'category': 'Accounting/Accounting',
    'summary': 'Group items on the printed invoice, preview before printing (PDF/XLSX), Commercial Bill',
    'depends': ['supply_order', 'account'],
    'data': [
        'views/product_views.xml',
        'views/account_move_views.xml',
        'views/res_company_views.xml',
        'views/supply_order_views.xml',
        'report/commercial_bill_report.xml',
    ],
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
