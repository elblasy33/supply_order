from odoo import api, fields, models, _
from odoo.exceptions import UserError


class LineNumberingMixin(models.AbstractModel):
    """Display line number (``line_no``) and a free note for document lines.

    ``line_no`` is for display and is independent from Odoo's internal
    ``sequence``. Models using the mixin set ``_line_parent_field`` to the
    many2one pointing to the document that owns the lines.
    """
    _name = 'line.numbering.mixin'
    _description = 'Document line numbering and notes'
    _line_parent_field = None

    line_no = fields.Integer(string='No.', copy=False, index=True)
    line_note = fields.Char(string='Item Note')

    def _siblings(self):
        """Lines of the same document, ordered by display number."""
        self.ensure_one()
        field = self._line_parent_field
        if not field:
            raise UserError(_("%s does not define a line parent field.", self._name))
        return self.search([(field, '=', self[field].id)], order='line_no, id')

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for parent in {r[self._line_parent_field] for r in records if self._line_parent_field}:
            todo = records.filtered(lambda r: r[self._line_parent_field] == parent and not r.line_no)
            if not todo:
                continue
            last = max(self.search([(self._line_parent_field, '=', parent.id)]).mapped('line_no') or [0])
            for rec in todo.sorted('id'):
                last += 1
                rec.line_no = last
        return records

    def set_position(self, new_no):
        """Move this line to position ``new_no`` and renumber the others 1..n."""
        self.ensure_one()
        lines = self._siblings() - self
        new_no = max(1, min(int(new_no), len(lines) + 1))
        ordered = list(lines)
        ordered.insert(new_no - 1, self)
        for index, line in enumerate(ordered, start=1):
            if line.line_no != index:
                line.with_context(skip_line_renumber=True).line_no = index
        return True

    def write(self, vals):
        if 'line_no' in vals and len(self) == 1 and not self.env.context.get('skip_line_renumber'):
            new_no = vals.pop('line_no')
            res = super().write(vals) if vals else True
            if new_no and new_no != self.line_no:
                self.with_context(skip_line_renumber=True).set_position(new_no)
            return res
        return super().write(vals)
