import io

import xlsxwriter

from odoo import http, _
from odoo.http import request
from odoo.http.stream import content_disposition
from odoo.addons.web.controllers.report import ReportController

# HTML reports that get the preview toolbar -> model of the printed record
PREVIEW_MODELS = {
    'account.report_invoice': 'account.move',
    'account.report_invoice_with_payments': 'account.move',
    'supply_order.report_supply_quotation': 'supply.order',
    'invoice_customization.report_commercial_bill': 'supply.order',
}

TOOLBAR = """
<style>
.ic-toolbar{position:fixed;top:0;left:0;right:0;z-index:9999;background:#2b2f36;color:#fff;padding:8px 16px;
display:flex;gap:8px;align-items:center;font-family:sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.ic-toolbar a,.ic-toolbar button{background:#0d8f99;color:#fff;border:0;border-radius:4px;padding:6px 14px;
cursor:pointer;text-decoration:none;font-size:14px}
.ic-toolbar span{flex:1;opacity:.8}
body{padding-top:48px}
@media print{.ic-toolbar{display:none}body{padding-top:0}}
</style>
<div class="ic-toolbar"><span>%(title)s</span>
<button type="button" onclick="window.print()">%(print)s</button>
<a href="%(pdf)s">%(pdf_label)s</a>
<a href="%(xlsx)s">%(xlsx_label)s</a></div>
"""


class PreviewReportController(ReportController):

    @http.route()
    def report_routes(self, reportname, docids=None, converter=None, **data):
        response = super().report_routes(reportname, docids=docids, converter=converter, **data)
        model = PREVIEW_MODELS.get(reportname)
        ids = [i for i in (docids or '').split(',') if i.isdigit()]
        if converter != 'html' or not model or len(ids) != 1 or not hasattr(response, 'get_data'):
            return response
        base = '/ic/download/%s/%s/%s' % ('%s', model, ids[0])
        toolbar = TOOLBAR % {
            'title': _("Preview"), 'print': _("Print"), 'pdf_label': _("Download PDF"), 'xlsx_label': _("Download XLSX"),
            'pdf': base % 'pdf' + '?report=%s' % reportname, 'xlsx': base % 'xlsx' + '?report=%s' % reportname}
        html = response.get_data(as_text=True)
        body_start = html.find('<body')
        if body_start >= 0:
            insert_at = html.find('>', body_start) + 1
            response.set_data(html[:insert_at] + toolbar + html[insert_at:])
        return response


class DownloadController(http.Controller):

    def _record(self, model, rid):
        if model not in set(PREVIEW_MODELS.values()):
            raise request.not_found()
        record = request.env[model].browse(rid).exists()
        if not record:
            raise request.not_found()
        record.check_access('read')
        return record

    @http.route('/ic/download/pdf/<string:model>/<int:rid>', type='http', auth='user', readonly=True)
    def download_pdf(self, model, rid, report=None, **kw):
        record = self._record(model, rid)
        report_name = report if PREVIEW_MODELS.get(report) == model else record._ic_report_name()
        pdf, _fmt = request.env['ir.actions.report']._render_qweb_pdf(report_name, [rid])
        name = (record.display_name or 'document').replace('/', '_')
        return request.make_response(pdf, headers=[
            ('Content-Type', 'application/pdf'), ('Content-Length', len(pdf)),
            ('Content-Disposition', content_disposition(name + '.pdf'))])

    @http.route('/ic/download/xlsx/<string:model>/<int:rid>', type='http', auth='user', readonly=True)
    def download_xlsx(self, model, rid, report=None, **kw):
        return build_xlsx_response(self._record(model, rid), model, report)


def build_xlsx_response(record, model, report=None):
    """The XLSX of a printable document (shared with the key-authenticated routes of supply_api)."""
    data = record._ic_xlsx_data(report) if model == 'supply.order' else record._ic_xlsx_data()
    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, {'in_memory': True})
    sheet = book.add_worksheet(data['sheet'][:31])
    bold = book.add_format({'bold': True})
    head = book.add_format({'bold': True, 'bg_color': '#0d8f99', 'font_color': '#ffffff', 'border': 1})
    money = book.add_format({'num_format': '#,##0.00'})
    sheet.write(0, 0, data['title'], book.add_format({'bold': True, 'font_size': 14}))
    row = 2
    for label, value in data['info']:
        sheet.write(row, 0, label, bold)
        sheet.write(row, 1, value)
        row += 1
    row += 1
    for col, title in enumerate(data['columns']):
        sheet.write(row, col, title, head)
    for values in data['rows']:
        row += 1
        for col, value in enumerate(values):
            sheet.write(row, col, value, money if isinstance(value, float) else None)
    row += 2
    last = len(data['columns']) - 1
    for label, value in data['totals']:
        sheet.write(row, max(last - 1, 0), label, bold)
        sheet.write(row, last, value, money)
        row += 1
    sheet.set_column(0, 0, 6)
    sheet.set_column(1, 1, 40)
    sheet.set_column(2, last, 14)
    book.close()
    return request.make_response(out.getvalue(), headers=[
        ('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        ('Content-Disposition', content_disposition(data['filename'] + '.xlsx'))])
