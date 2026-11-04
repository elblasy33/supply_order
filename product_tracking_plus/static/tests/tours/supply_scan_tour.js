import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("supply_scan_tour", {
    url: "/odoo/action-supply_order.supply_order_action/new",
    steps: () => [
        {
            content: "Pick the partner",
            trigger: ".o_field_widget[name=partner_id] input",
            run: "edit Scan Tour Customer",
        },
        {
            trigger: ".o-autocomplete--dropdown-item:contains('Scan Tour Customer')",
            run: "click",
        },
        {
            content: "Scan a product barcode in the scan field",
            trigger: ".o_field_widget[name=scan_input] input",
            run: "edit 7771",
        },
        { trigger: ".o_field_widget[name=scan_input] input", run: "press Enter" },
        {
            content: "The product line was added",
            trigger: ".o_field_x2many_list .o_data_row:contains('Scan Tour Item')",
        },
        {
            content: "The scan field is cleared and still focused: no need to click again",
            trigger: ".o_field_widget[name=scan_input] input:focus:value()",
            run: "edit 7771",
        },
        { trigger: ".o_field_widget[name=scan_input] input", run: "press Enter" },
        {
            content: "Scanning again raised the quantity to 2",
            trigger: ".o_data_row [name=qty_requested]:contains('2.00')",
        },
        { content: "Save", trigger: ".o_form_button_save", run: "click" },
        {
            content: "Saved: the form is clean again",
            trigger: ".o_form_saved",
        },
    ],
});
