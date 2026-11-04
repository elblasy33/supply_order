{
    'name': 'Supply Orders API',
    'version': '20.0.1.0.0',
    'category': 'Inventory/Supply Chain',
    'summary': 'Service layer for the Next.js app: id-based methods over JSON-2, idempotent writes, '
               'role checks and key-authenticated print/download routes',
    'depends': [
        'supply_order', 'product_tracking_plus', 'smart_alerts', 'invoice_customization',
        'discounts_rebates', 'smart_reconciliation',
    ],
    'data': [
        'security/ir.access.csv',
    ],
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
