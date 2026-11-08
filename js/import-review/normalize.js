import { normalizeArabicDigits } from '../core/text-utils.js';
export { toNumber, toInt } from '../core/number-utils.js';

export function normalizeText(value) {
  return normalizeArabicDigits(String(value ?? ''))
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[-_/|]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fromParts(yearValue, monthValue, dayValue) {
  const year = Number(yearValue),
    month = Number(monthValue),
    day = Number(dayValue);
  if (
    ![year, month, day].every(Number.isInteger) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1
  )
    return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthDays[month - 1]) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Excel parsing is optional and can be injected by tests or another runtime. */
export function toISODate(value, parseExcelDate = globalThis.XLSX?.SSF?.parse_date_code) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : fromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const text = normalizeArabicDigits(value).trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    if (typeof parseExcelDate !== 'function') return null;
    const parsed = parseExcelDate(Number(text));
    return parsed ? fromParts(parsed.y, parsed.m, parsed.d) : null;
  }
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return fromParts(iso[1], iso[2], iso[3]);
  const timestamp = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))?$/i,
  );
  if (timestamp) {
    const date = fromParts(timestamp[1], timestamp[2], timestamp[3]);
    if (
      !date ||
      Number(timestamp[4]) > 23 ||
      Number(timestamp[5]) > 59 ||
      Number(timestamp[6] ?? 0) > 59 ||
      Number(timestamp[7] ?? 0) > 23 ||
      Number(timestamp[8] ?? 0) > 59
    )
      return null;
    // Timestamp inputs preserve their local calendar day, independent of the
    // machine's timezone; importing a date must not shift it across midnight.
    return date;
  }
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return fromParts(dmy[3], dmy[2], dmy[1]);
  // Avoid engine-dependent parsing and silent normalization of malformed dates.
  return null;
}
