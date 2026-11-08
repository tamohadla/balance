/** Pure text helpers. These functions never read the DOM, storage, or sessions. */
export function cleanText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeArabicDigits(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 1776 ? code - 1776 : code - 1632);
  });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function materialLabel(row) {
  const main = cleanText(row?.main_category);
  const sub = cleanText(row?.sub_category);
  const name = cleanText(row?.item_name);
  const group = sub ? `${main} / ${sub}` : main;
  return group ? `${group} — ${name}` : name;
}

export function normalizeMatchToken(value) {
  return normalizeArabicDigits(cleanText(value)).toLowerCase();
}

export function formatItemFullLabel(row) {
  return `${materialLabel(row)} | ${cleanText(row?.color_code)} | ${cleanText(row?.color_name)}`
    .replace(/\s+\|\s+\|/g, ' | ')
    .trim();
}

export function groupLabel(row) {
  const main = cleanText(row?.main_category);
  const sub = cleanText(row?.sub_category);
  return sub ? `${main} / ${sub}` : main;
}
