env.cr.execute("SAVEPOINT poc")
wh = env['stock.warehouse'].search([], limit=1)
# --- A: SO qty 50 but 30 already delivered
partner = env['res.partner'].create({'name': 'POC C2'})
prod = env['product.product'].create({'name': 'POC Salt', 'is_storable': True, 'list_price': 5})
env['stock.quant']._update_available_quantity(prod, wh.lot_stock_id, 100)
ot = wh.out_type_id
pk = env['stock.picking'].create({'picking_type_id': ot.id, 'partner_id': partner.id,
  'location_id': ot.default_location_src_id.id, 'location_dest_id': env.ref('stock.stock_location_customers').id,
  'move_ids': [(0,0,{'product_id': prod.id,'product_uom_qty':30,'location_id': ot.default_location_src_id.id,'location_dest_id': env.ref('stock.stock_location_customers').id})]})
pk.action_confirm(); pk.action_assign(); pk.move_ids.picked=True; pk.move_ids.quantity=30; pk.button_validate()
so = env['sale.order'].create({'partner_id': partner.id,'order_line':[(0,0,{'product_id':prod.id,'product_uom_qty':50,'price_unit':5})]})
rule = wh.delivery_route_id.rule_ids.filtered(lambda r: r.picking_type_id == ot and r.action in ('pull','pull_push'))[:1]
pk.move_ids.write({'sale_line_id': so.order_line.id,'rule_id': rule.id,'warehouse_id': wh.id})
so.action_confirm()
print('A pickings', [(p.name,p.state,p.move_ids.mapped('product_uom_qty')) for p in so.picking_ids])
# --- B: receipt first
vendor = env['res.partner'].create({'name': 'POC V'})
rt = wh.in_type_id
rp = env['stock.picking'].create({'picking_type_id': rt.id,'partner_id': vendor.id,
  'location_id': env.ref('stock.stock_location_suppliers').id,'location_dest_id': rt.default_location_dest_id.id,
  'move_ids':[(0,0,{'product_id':prod.id,'product_uom_qty':40,'location_id': env.ref('stock.stock_location_suppliers').id,'location_dest_id': rt.default_location_dest_id.id})]})
rp.action_confirm(); rp.move_ids.picked=True; rp.move_ids.quantity=40; rp.button_validate()
po = env['purchase.order'].create({'partner_id': vendor.id,'order_line':[(0,0,{'product_id':prod.id,'product_qty':40,'price_unit':3})]})
rp.move_ids.write({'purchase_line_id': po.order_line.id})
po.button_confirm()
print('B receipts', [(p.name,p.state) for p in po.picking_ids], 'qty_received', po.order_line.qty_received, po.order_line.qty_received_method)
env.cr.execute("ROLLBACK TO SAVEPOINT poc")
