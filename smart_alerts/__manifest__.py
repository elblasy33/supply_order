{
    'name': 'Smart Alerts',
    'version': '20.0.1.0.0',
    'category': 'Inventory/Supply Chain',
    'summary': 'Expiry alerts (per product/category/lot) and tracking of automatically created purchase orders',
    'depends': ['supply_order', 'product_expiry', 'purchase_stock'],
    'data': [
        'data/ir_cron_data.xml',
        'views/product_category_views.xml',
        'views/stock_lot_views.xml',
        'views/purchase_order_views.xml',
        'views/menus.xml',
    ],
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
