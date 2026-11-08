import { normalizeArabicDigits } from './text-utils.js';

/** Empty/invalid values stay missing; zero is a valid explicit input. */
export function toNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const raw = normalizeArabicDigits(value).replace(/,/g, '').trim();
  if (!raw) return null;
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}

/** Integer fields never silently round fractional input. */
export function toInt(value) {
  const result = toNumber(value);
  return result !== null && Number.isSafeInteger(result) ? result : null;
}
