# PoC: deliver first (no SO), then build a draft SO, link moves, confirm -> expect no duplicate picking
env.cr.execute("SAVEPOINT poc")
partner = env['res.partner'].create({'name': 'POC Customer'})
prod = env['product.product'].create({'name': 'POC Chips', 'is_storable': True, 'list_price': 10})
wh = env['stock.warehouse'].search([], limit=1)
env['stock.quant']._update_available_quantity(prod, wh.lot_stock_id, 100)
out_type = wh.out_type_id
picking = env['stock.picking'].create({
    'picking_type_id': out_type.id, 'partner_id': partner.id,
    'location_id': out_type.default_location_src_id.id,
    'location_dest_id': env.ref('stock.stock_location_customers').id,
    'move_ids': [(0, 0, {'product_id': prod.id, 'product_uom_qty': 30,
        'location_id': out_type.default_location_src_id.id,
        'location_dest_id': env.ref('stock.stock_location_customers').id})],
})
picking.action_confirm(); picking.action_assign()
picking.move_ids.picked = True
picking.move_ids.quantity = 30
picking.button_validate()
print('picking state', picking.state)
so = env['sale.order'].create({'partner_id': partner.id,
    'order_line': [(0, 0, {'product_id': prod.id, 'product_uom_qty': 30, 'price_unit': 10})]})
print('SO state before', so.state)
rule = wh.delivery_route_id.rule_ids.filtered(lambda r: r.picking_type_id == out_type and r.action in ('pull', 'pull_push'))[:1]
print('rule', rule.name, rule.action)
picking.move_ids.write({'sale_line_id': so.order_line.id, 'rule_id': rule.id, 'warehouse_id': wh.id})
so.action_confirm()
print('SO state', so.state, '| pickings:', so.picking_ids.mapped('name'), so.picking_ids.mapped('state'))
print('qty_delivered', so.order_line.qty_delivered, '| method', so.order_line.qty_delivered_method)
print('picking.sale_id', picking.sale_id.name)
inv = so._create_invoices()
print('invoice qty', inv.invoice_line_ids.mapped('quantity'))
print('quant after', env['stock.quant']._get_available_quantity(prod, wh.lot_stock_id))
env.cr.execute("ROLLBACK TO SAVEPOINT poc")
