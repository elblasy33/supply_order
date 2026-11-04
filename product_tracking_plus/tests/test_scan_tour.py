from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestScanTour(HttpCase):

    def test_scan_field_in_the_browser(self):
        self.env['res.partner'].create({'name': 'Scan Tour Customer'})
        self.env['product.product'].create({
            'name': 'Scan Tour Item', 'type': 'consu', 'barcode': '7771', 'list_price': 3})
        self.start_tour('/odoo/action-supply_order.supply_order_action/new', 'supply_scan_tour', login='admin')
