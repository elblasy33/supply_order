from odoo import api, fields, models, _
from odoo.exceptions import UserError


class LineNumberingMixin(models.AbstractModel):
    """Display line number (``line_no``) and a free note for document lines.

    ``line_no`` is for display and is independent from Odoo's internal ``sequence``. Models using the
    mixin set ``_line_parent_field`` to the many2one pointing to the document that owns the lines.
    Typing a new number in the cell moves the line there and renumbers the others.
    """
    _name = 'line.numbering.mixin'
    _description = 'Document line numbering and notes'
    _line_parent_field = None
    _line_sync_sequence = True  # also reorder the internal sequence so the list shows the new order

    line_no = fields.Integer(string='No.', copy=False, index=True)
    line_note = fields.Char(string='Item Note')

    def _is_numbered_line(self):
        """Sections, notes and accounting lines are not numbered."""
        return True

    def _siblings(self):
        """Numbered lines of the same document, ordered by display number."""
        self.ensure_one()
        field = self._line_parent_field
        if not field:
            raise UserError(_("%s does not define a line parent field.", self._name))
        lines = self.search([(field, '=', self[field].id)], order='line_no, id')
        return lines.filtered(lambda l: l._is_numbered_line())

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        field = self._line_parent_field
        if not field:
            return records
        for parent in {r[field] for r in records if r[field]}:
            todo = records.filtered(lambda r: r[field] == parent and not r.line_no and r._is_numbered_line())
            if not todo:
                continue
            existing = self.search([(field, '=', parent.id), ('id', 'not in', todo.ids)])
            last = max(existing.filtered(lambda l: l._is_numbered_line()).mapped('line_no') or [0])
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
        sync = self._line_sync_sequence and 'sequence' in self._fields
        for index, line in enumerate(ordered, start=1):
            vals = {}
            if line.line_no != index:
                vals['line_no'] = index
            if sync and line.sequence != index * 10:
                vals['sequence'] = index * 10
            if vals:
                line.with_context(skip_line_renumber=True).write(vals)
        return True

    def write(self, vals):
        if 'line_no' in vals and len(self) == 1 and not self.env.context.get('skip_line_renumber'):
            new_no = vals.pop('line_no')
            res = super().write(vals) if vals else True
            if new_no and new_no != self.line_no and self._is_numbered_line():
                self.with_context(skip_line_renumber=True).set_position(new_no)
            return res
        return super().write(vals)
