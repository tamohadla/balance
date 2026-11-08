import { cleanText, materialLabel, normalizeArabicDigits } from '../core/text-utils.js';

export const MAX_IMPORT_ROWS = 10000;
export const itemKey = (item) =>
  `${cleanText(item.item_name)}||${cleanText(item.color_code)}`.toLowerCase();

export function parseBulkLines(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > MAX_IMPORT_ROWS)
    throw new Error(`الملف يتجاوز الحد الأقصى (${MAX_IMPORT_ROWS} سطر).`);
  const seen = new Set();
  return lines.map((raw, index) => {
    const parts = raw.split('|').map((part) => part.trim());
    const idx = index + 1;
    if (parts.length < 6) return { idx, ok: false, reason: 'بيانات ناقصة (تحتاج 6 أعمدة)' };
    const unit = parts[5].toLowerCase();
    if (!['kg', 'm'].includes(unit))
      return { idx, ok: false, reason: 'الوحدة يجب أن تكون kg أو m' };
    const data = {
      main_category: cleanText(parts[0]),
      sub_category: cleanText(parts[1]),
      item_name: cleanText(parts[2]),
      color_code: normalizeArabicDigits(cleanText(parts[3])),
      color_name: cleanText(parts[4]),
      unit_type: unit,
      description: parts.slice(6).join('|') || null,
      is_active: true,
    };
    if (!data.main_category || !data.item_name || !data.color_code)
      return { idx, ok: false, reason: 'المجموعة واسم المادة وكود اللون مطلوبة' };
    const key = itemKey(data);
    if (seen.has(key)) return { idx, ok: false, reason: 'سطر مكرر داخل الملف' };
    seen.add(key);
    return { idx, ok: true, data };
  });
}

/** Row descriptions carry text only. Rendering never interprets file content as HTML. */
export function bulkPreviewRows(parsed, existingKeys) {
  return parsed.map((row) => {
    if (!row.ok)
      return { className: 'status-error', cells: [row.idx, '❌ خطأ', row.reason], error: true };
    const exists = existingKeys.has(itemKey(row.data));
    return {
      className: exists ? 'status-exists' : 'status-new',
      cells: [
        row.idx,
        exists ? 'موجود مسبقاً' : 'جديد (جاهز)',
        materialLabel(row.data),
        row.data.color_code,
        row.data.color_name,
        row.data.unit_type,
        row.data.description ?? '-',
      ],
    };
  });
}

export function renderBulkPreview(tbody, rows) {
  const doc = tbody.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const row of rows) {
    const tr = doc.createElement('tr');
    tr.className = row.className;
    row.cells.forEach((value, index) => {
      const cell = doc.createElement('td');
      cell.textContent = String(value ?? '');
      if (row.error && index === 2) cell.colSpan = 5;
      tr.append(cell);
    });
    fragment.append(tr);
  }
  tbody.replaceChildren(fragment);
}

export function sheetRowsToBulkText(rows) {
  return rows
    .slice(1)
    .filter((row) => row.length > 0)
    .map((row) => row.map((cell) => String(cell ?? '').trim()).join('|'))
    .join('\n');
}
