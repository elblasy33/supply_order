{
    'name': 'Product Tracking Plus',
    'version': '20.0.1.0.0',
    'category': 'Inventory/Supply Chain',
    'summary': 'Automatic lot numbers, barcode and lot scanning on supply, sales and purchase orders',
    'depends': ['supply_order', 'product_expiry'],
    'data': [
        'views/product_views.xml',
        'views/supply_order_views.xml',
        'views/res_config_settings_views.xml',
    ],
    'assets': {
        'web.assets_tests': ['product_tracking_plus/static/tests/tours/*.js'],
    },
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
