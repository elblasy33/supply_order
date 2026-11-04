# Invoice Customization (`invoice_customization`)

- **Item grouping on the printed invoice**: set an *Invoice Group* on a product (or override it on the supply order line); tick *Group items when printing* on the invoice (or make it the company default). Items of the same group print as one line (quantities and amounts summed). Display only: invoice lines, journal items, stock moves and costs are not changed. If items of one group differ in tax, unit or discount, none of that group is merged and the invoice shows a warning.

- **Preview before printing**: the invoice *Print* button opens an HTML preview with *Print*, *Download PDF* and *Download XLSX*. The same toolbar is on the supply order quotation and Commercial Bill. The usual Print menu still downloads the PDF directly.

- **Commercial Bill** (supply order): built from the order data (what was really moved, else what was asked), grouped, no file to upload. Title, prices, item notes and footer text are company settings; the design is a QWeb template you can inherit.
