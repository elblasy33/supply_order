{
    'name': 'Discounts & Rebates',
    'version': '20.0.1.0.0',
    'category': 'Accounting/Accounting',
    'summary': 'Conditional price discounts and deferred rebates (tiers, period, credit/debit note) for sales and purchases',
    'depends': ['supply_order', 'sale_stock', 'purchase_stock', 'account'],
    'data': [
        'security/ir.access.csv',
        'data/ir_cron_data.xml',
        'views/conditional_discount_views.xml',
        'views/rebate_views.xml',
        'views/res_company_views.xml',
        'views/menus.xml',
    ],
    'assets': {
        'web.assets_tests': ['discounts_rebates/static/tests/tours/*.js'],
    },
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
