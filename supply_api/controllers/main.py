from odoo import http, _
from odoo.http import request
from odoo.http.stream import content_disposition
from odoo.addons.invoice_customization.controllers.main import build_xlsx_response

PRINT_KINDS = {
    'quotation': ('supply.order', 'supply_order.report_supply_quotation'),
    'commercial_bill': ('supply.order', 'invoice_customization.report_commercial_bill'),
    'invoice': ('account.move', 'account.report_invoice'),
}


class SupplyApiPrintController(http.Controller):
    """Documents for the Next.js server: same reports as the Odoo preview, but authenticated with the
    integration user's API key (``Authorization: Bearer ...``) instead of a browser session."""

    @http.route('/supply_api/print/<string:kind>/<string:fmt>/<int:rid>', type='http', auth='bearer',
                bearer_scope='rpc', methods=['GET'], readonly=True)
    def print_document(self, kind, fmt, rid, lang=None, **kw):
        if kind not in PRINT_KINDS or fmt not in ('html', 'pdf', 'xlsx'):
            raise request.not_found()
        model, report_name = PRINT_KINDS[kind]
        if lang:
            request.update_context(lang=lang)
        record = request.env[model].browse(rid).exists()
        if not record:
            raise request.not_found()
        record.check_access('read')
        name = (record.display_name or kind).replace('/', '_')
        if fmt == 'xlsx':
            return build_xlsx_response(record, model, report_name)
        reports = request.env['ir.actions.report']
        if fmt == 'pdf':
            content, _fmt = reports._render_qweb_pdf(report_name, [rid])
            mimetype, filename = 'application/pdf', name + '.pdf'
        else:
            content, _fmt = reports._render_qweb_html(report_name, [rid])
            mimetype, filename = 'text/html; charset=utf-8', None
        headers = [('Content-Type', mimetype), ('Content-Length', len(content))]
        if filename:
            headers.append(('Content-Disposition', content_disposition(filename)))
        return request.make_response(content, headers=headers)
