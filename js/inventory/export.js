import { csvCell } from '../inventory-model.js';

/** Serialize only the currently visible rows using the same CSV escaping policy. */
export function inventoryCsv(rows, unitLabel) {
  const headers = [
    'المجموعة الرئيسية',
    'المجموعة الفرعية',
    'المادة',
    'كود اللون',
    'اسم اللون',
    'الوحدة',
    'الرصيد الرئيسي',
    'الأثواب',
    'طلبات قائمة بالأثواب',
    'الرصيد بعد الطلبات',
  ];
  const values = rows.map((row) => [
    row.main_category,
    row.sub_category,
    row.item_name,
    row.color_code,
    row.color_name,
    unitLabel(row.unit_type),
    row.balance_main,
    row.balance_rolls,
    row.preorder_total_rolls,
    row.balance_after_orders,
  ]);
  return '\ufeff' + [headers, ...values].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
