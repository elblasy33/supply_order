from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestRebateProgramTour(HttpCase):

    def test_program_form_in_the_browser(self):
        self.start_tour('/odoo/action-discounts_rebates.rebate_program_action/new', 'rebate_program_tour',
                        login='admin')
        program = self.env['rebate.program'].search([('name', '=', 'Tour volume rebate')])
        self.assertEqual(len(program), 1)
        self.assertEqual((program.tier_ids.threshold, program.tier_ids.value, program.tier_ids.reward_type),
                         (1000, 2, 'percent'))
