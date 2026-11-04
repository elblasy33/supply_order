import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("smart_reconcile_tour", {
    url: "/odoo/action-smart_reconciliation.smart_reconcile_wizard_action",
    steps: () => [
        {
            content: "Choose the customer",
            trigger: ".modal .o_field_widget[name=partner_id] input",
            run: "edit Tour Reco Customer",
        },
        {
            trigger: ".o-autocomplete--dropdown-item:contains('Tour Reco Customer')",
            run: "click",
        },
        {
            content: "Load the open invoices and payments",
            trigger: ".modal button:contains('Load open items')",
            run: "click",
        },
        {
            content: "Payments come pre-selected, invoices do not: select the invoice",
            trigger: ".modal .o_data_row:contains('INV/') td[name=selected]",
            run: "click",
        },
        {
            content: "The totals follow the selection",
            trigger: ".modal .o_field_widget[name=selected_total]:contains('100.00')",
        },
        {
            content: "Reconcile",
            trigger: ".modal button:contains('Reconcile')",
            run: "click",
        },
        {
            content: "The result lists the pair that was reconciled",
            trigger: ".modal .o_data_row:contains('INV/'):contains('60.00')",
        },
        {
            content: "And what is still due",
            trigger: ".modal .o_field_widget[name=remaining_total]:contains('40.00')",
        },
        { content: "Close", trigger: ".modal button:contains('Close')", run: "click" },
    ],
});
