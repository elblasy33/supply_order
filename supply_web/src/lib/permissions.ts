/** What a user may do. Authoritative here: Odoo only knows the integration account. */
export const PERMISSIONS = {
  "orders.view": "عرض أوامر التوريد",
  "orders.create": "إنشاء أمر توريد",
  "orders.from_document": "إنشاء أمر توريد من أمر بيع/شراء قائم",
  "orders.edit_draft": "تعديل أصناف الأمر وهو مسودة",
  "orders.edit_confirmed": "تعديل أصناف أمر مؤكد (إضافة، كمية، سعر، حذف)",
  "orders.substitute": "استبدال صنف",
  "orders.confirm": "تأكيد الأمر",
  "orders.cancel": "إلغاء الأمر وإعادته لمسودة",
  "orders.close": "إغلاق الأمر",
  "orders.scan": "مسح الباركود",
  "orders.prepare_transfer": "تجهيز التسليم / الاستلام",
  "orders.create_sale": "إنشاء أمر بيع من الأمر",
  "orders.create_purchase": "إنشاء أمر شراء من الأمر",
  "orders.invoice": "إنشاء فاتورة من الكميات الفعلية",
  "orders.print": "طباعة وتنزيل المستندات",
  "alerts.view": "عرض التنبيهات (الصلاحية والمشتريات التلقائية)",
  "accounting.reconcile": "التسوية الجماعية للفواتير",
  "rebates.view": "عرض الخصومات المؤجلة",
  "rebates.manage": "تكوين وتسوية الخصومات المؤجلة",
  "settings.users": "إدارة المستخدمين",
  "settings.roles": "إدارة الأدوار والصلاحيات",
  "settings.odoo": "إعدادات الاتصال بأودو",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { title: string; keys: Permission[] }[] = [
  {
    title: "أوامر التوريد",
    keys: [
      "orders.view", "orders.create", "orders.from_document", "orders.edit_draft", "orders.edit_confirmed",
      "orders.substitute", "orders.confirm", "orders.cancel", "orders.close", "orders.scan",
      "orders.prepare_transfer", "orders.create_sale", "orders.create_purchase", "orders.invoice", "orders.print",
    ],
  },
  { title: "التنبيهات", keys: ["alerts.view"] },
  { title: "المحاسبة", keys: ["accounting.reconcile", "rebates.view", "rebates.manage"] },
  { title: "الإعدادات", keys: ["settings.users", "settings.roles", "settings.odoo"] },
];

/** Roles created on first run; all of them can be edited in the app. */
export const DEFAULT_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: "مدير النظام", permissions: ALL_PERMISSIONS },
  {
    name: "مدير توريد",
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("settings.")),
  },
  {
    name: "مندوب مبيعات",
    permissions: [
      "orders.view", "orders.create", "orders.from_document", "orders.edit_draft", "orders.confirm",
      "orders.cancel", "orders.scan", "orders.create_sale", "orders.create_purchase", "orders.print",
    ],
  },
  {
    name: "أمين مخزن",
    permissions: [
      "orders.view", "orders.edit_draft", "orders.edit_confirmed", "orders.substitute", "orders.scan",
      "orders.prepare_transfer", "orders.print", "alerts.view",
    ],
  },
  {
    name: "محاسب",
    permissions: [
      "orders.view", "orders.invoice", "orders.print", "accounting.reconcile", "rebates.view", "rebates.manage",
    ],
  },
];

/** The order action (as named by supply.api `allowed_actions`) each permission opens. */
export const ACTION_PERMISSION: Record<string, Permission> = {
  edit: "orders.edit_draft",
  add_line: "orders.edit_draft",
  substitute: "orders.substitute",
  confirm: "orders.confirm",
  cancel: "orders.cancel",
  reset_draft: "orders.cancel",
  close: "orders.close",
  prepare_transfer: "orders.prepare_transfer",
  create_sale_order: "orders.create_sale",
  create_purchase_order: "orders.create_purchase",
  create_invoice: "orders.invoice",
  print: "orders.print",
};
