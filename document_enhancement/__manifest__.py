{
    'name': 'Document Enhancement',
    'version': '20.0.1.0.0',
    'category': 'Technical',
    'summary': 'Editable line numbers (separate from sequence) and per-line notes',
    'depends': ['sale_stock', 'purchase_stock', 'account'],
    'data': [
        'views/document_views.xml',
        'views/res_company_views.xml',
        'report/report_templates.xml',
    ],
    'author': 'Elblasy',
    'license': 'LGPL-3',
    'installable': True,
}
