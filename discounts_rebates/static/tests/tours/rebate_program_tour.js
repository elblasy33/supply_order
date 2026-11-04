import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("rebate_program_tour", {
    url: "/odoo/action-discounts_rebates.rebate_program_action/new",
    steps: () => [
        {
            content: "Name the program",
            trigger: ".o_field_widget[name=name] input",
            run: "edit Tour volume rebate",
        },
        {
            content: "Add a tier",
            trigger: "div[name=tier_ids] .o_field_x2many_list_row_add button",
            run: "click",
        },
        {
            trigger: ".o_data_row .o_field_widget[name=threshold] input",
            run: "edit 1000",
        },
        {
            trigger: ".o_data_row .o_field_widget[name=value] input",
            run: "edit 2",
        },
        { content: "Save", trigger: ".o_form_button_save", run: "click" },
        {
            content: "Saved with its tier",
            trigger: ".o_form_saved .o_data_row:contains('1,000.00')",
        },
        {
            content: "The compute button is there",
            trigger: "button[name=action_compute_closed_periods]",
        },
    ],
});
