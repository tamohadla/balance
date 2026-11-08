import { cleanText, normalizeArabicDigits } from '../core/text-utils.js';

export const ITEM_FIELDS = [
  'main_category',
  'sub_category',
  'item_name',
  'color_code',
  'color_name',
  'unit_type',
  'description',
];

export function byText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ar');
}

export function compareItems(a, b) {
  for (const field of ['main_category', 'sub_category', 'item_name', 'color_code']) {
    const comparison = byText(a[field], b[field]);
    if (comparison) return comparison;
  }
  return 0;
}

export function distinctValues(items, field, { mainCategory = '', clean = false } = {}) {
  const selectedMain = cleanText(mainCategory);
  return [
    ...new Set(
      items
        .filter((row) => !selectedMain || cleanText(row.main_category) === selectedMain)
        .map((row) => (clean ? cleanText(row[field]) : row[field]))
        .filter(Boolean),
    ),
  ].sort(byText);
}

export function filterItems(
  items,
  { status = 'active', mainCategory = '', subCategory = '', query = '', focusedItemId = '' } = {},
) {
  const selectedMain = cleanText(mainCategory);
  const selectedSub = cleanText(subCategory);
  const search = String(query).trim().toLowerCase();
  return items
    .filter((row) => {
      if (focusedItemId && String(row.id) !== focusedItemId) return false;
      if (status === 'active' && row.is_active !== true) return false;
      if (status === 'inactive' && row.is_active === true) return false;
      if (selectedMain && cleanText(row.main_category) !== selectedMain) return false;
      if (selectedSub && cleanText(row.sub_category) !== selectedSub) return false;
      return (
        !search ||
        ITEM_FIELDS.map((field) => String(row[field] || ''))
          .join(' ')
          .toLowerCase()
          .includes(search)
      );
    })
    .sort(compareItems);
}

export function itemPayload(values) {
  return {
    main_category: cleanText(values.main_category),
    sub_category: cleanText(values.sub_category) || null,
    item_name: cleanText(values.item_name),
    color_code: normalizeArabicDigits(cleanText(values.color_code)),
    color_name: cleanText(values.color_name) || null,
    unit_type: values.unit_type,
    description: cleanText(values.description) || null,
  };
}

export function itemExportRows(items) {
  return [...items].sort(compareItems).map((row, index) => ({
    '#': index + 1,
    'المجموعة الأساسية': row.main_category || '',
    'المجموعة الفرعية': row.sub_category || '',
    'اسم المادة': row.item_name || '',
    'رقم اللون': row.color_code || '',
    'اسم اللون': row.color_name || '',
    الوحدة: row.unit_type || '',
    الشرح: row.description || '',
    الحالة: row.is_active ? 'نشط' : 'موقوف',
  }));
}
