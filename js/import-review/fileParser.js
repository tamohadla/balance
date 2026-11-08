import { toISODate } from './normalize.js';

const CANDIDATE_KEYS = {
  raw_item_name: ['item', 'item_name', 'المادة', 'اسم المادة', 'اسم الصنف'],
  raw_color_code: ['color_code', 'كود اللون', 'رقم اللون'],
  raw_color_name: ['color_name', 'اسم اللون'],
  raw_qty_primary: ['qty', 'qty_main', 'quantity', 'الكمية', 'الكمية الرئيسية'],
  raw_rolls: ['rolls', 'qty_rolls', 'عدد الاثواب', 'عدد الأثواب', 'الاثواب'],
  raw_date: ['date', 'التاريخ'],
  raw_notes: ['note', 'notes', 'ملاحظات'],
};

function pickValue(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
  }
  return null;
}

export function parseSheetRows(sheetRows, parseExcelDate = globalThis.XLSX?.SSF?.parse_date_code) {
  if (!Array.isArray(sheetRows) || sheetRows.length > 10000)
    throw new Error('الحد الأقصى للملف 10000 سطر.');
  return sheetRows
    .map((row, index) => {
      const dateValue = pickValue(row, CANDIDATE_KEYS.raw_date);
      const date = toISODate(dateValue, parseExcelDate);
      if (dateValue !== null && date === null)
        throw new Error(`السطر ${index + 1}: التاريخ غير صالح.`);
      return {
        row_index: index + 1,
        raw_item_name: pickValue(row, CANDIDATE_KEYS.raw_item_name),
        raw_color_code: pickValue(row, CANDIDATE_KEYS.raw_color_code),
        raw_color_name: pickValue(row, CANDIDATE_KEYS.raw_color_name),
        raw_qty_primary: pickValue(row, CANDIDATE_KEYS.raw_qty_primary),
        raw_rolls: pickValue(row, CANDIDATE_KEYS.raw_rolls),
        raw_date: date,
        raw_notes: pickValue(row, CANDIDATE_KEYS.raw_notes),
      };
    })
    .filter((row) =>
      [row.raw_item_name, row.raw_color_code, row.raw_qty_primary, row.raw_rolls].some(
        (value) => value !== null && value !== '',
      ),
    );
}

export async function readXlsxFile(file) {
  if (!file || file.size > 20 * 1024 * 1024) throw new Error('حجم ملف Excel يتجاوز 20 ميغابايت.');
  const xlsx = globalThis.XLSX;
  if (!xlsx?.read || !xlsx.utils?.sheet_to_json)
    throw new Error('تعذر تحميل قارئ Excel. حدّث الصفحة وأعد المحاولة.');
  const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array' });
  const first = workbook.Sheets[workbook.SheetNames[0]];
  if (!first) throw new Error('الملف لا يحتوي على ورقة بيانات.');
  const rows = xlsx.utils.sheet_to_json(first, { defval: '' });
  return parseSheetRows(rows, xlsx.SSF?.parse_date_code);
}
