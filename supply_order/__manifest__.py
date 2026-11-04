{
    'name': 'Supply Order',
    'version': '20.0.1.0.0',
    'category': 'Inventory/Supply Chain',
    'summary': 'Central supply order: the operational hub that drives sales, purchase, stock and invoicing',
    'depends': ['document_enhancement', 'sale_stock', 'purchase_stock', 'account'],
    'data': [
        'security/supply_security.xml',
        'security/ir.access.csv',
        'data/ir_sequence_data.xml',
        'views/external_user_views.xml',
        'views/supply_order_views.xml',
        'views/inherited_views.xml',
        'views/menus.xml',
        'report/supply_order_report.xml',
    ],
    'demo': [
        'demo/supply_demo.xml',
    ],
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'application': True,
    'installable': True,
}
