import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, toNumber, toInt, toISODate } from '../js/import-review/normalize.js';
import { parseSheetRows } from '../js/import-review/fileParser.js';
import { buildItemIndex, smartMatchLine } from '../js/import-review/matching.js';

test('numeric input keeps missing values missing and never rounds integer fields', () => {
  for (const value of [null, undefined, '', '   ', '\t', true, 'garbage', Infinity])
    assert.equal(toNumber(value), null);
  assert.equal(toNumber('٠'), 0);
  assert.equal(toNumber('۱,۲۳۴.۵'), 1234.5);
  assert.equal(toInt('١٢'), 12);
  for (const value of ['1.6', '-2.1', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(toInt(value), null);
});

test('dates reject impossible calendar values and accept real leap days', () => {
  for (const value of [
    '2026-02-31',
    '2026-02-29',
    '1900-02-29',
    '31/04/2026',
    '2026-13-01',
    '2026-01-00',
    'bad',
    '',
  ])
    assert.equal(toISODate(value), null, value);
  assert.equal(toISODate('٢٠٢٤/٢/٢٩'), '2024-02-29');
  assert.equal(toISODate('29.02.2000'), '2000-02-29');
  assert.equal(toISODate('8/11/2026'), '2026-11-08');
  assert.equal(toISODate(new Date(2026, 10, 8)), '2026-11-08');
});

test('Excel serial dates need no window and support an injected decoder', () => {
  assert.equal(toISODate(45000), null);
  assert.equal(toISODate('45000'), null);
  const decoder = (serial) => (serial === 45000 ? { y: 2023, m: 3, d: 15 } : null);
  assert.equal(toISODate(45000, decoder), '2023-03-15');
  assert.equal(toISODate('٤٥٠٠٠', decoder), '2023-03-15');
  assert.equal(
    toISODate(60, () => ({ y: 1900, m: 2, d: 29 })),
    null,
  );
});

test('sheet parsing retains explicit zeroes and identifies invalid dates by row', () => {
  const [row] = parseSheetRows([{ item: 'A', rolls: 0, qty: 0, date: '2026-11-08' }]);
  assert.equal(row.raw_rolls, 0);
  assert.equal(row.raw_qty_primary, 0);
  assert.equal(row.raw_date, '2026-11-08');
  assert.throws(() => parseSheetRows([{ item: 'A', date: '2026-02-31' }]), /السطر 1/);
});

test('matching is a pure module with shared Arabic digit normalization', () => {
  const index = buildItemIndex([{ id: 'i', item_name: 'Cotton', color_code: '12' }]);
  assert.equal(
    smartMatchLine({ raw_item_name: ' cotton ', raw_color_code: '١٢' }, index).matched_item_id,
    'i',
  );
  assert.equal(normalizeText('أبيض_۱۲'), 'ابيض 12');
});

test('ISO timestamps retain a valid calendar day and reject malformed time/calendar parts', () => {
  assert.equal(toISODate('2026-11-08T00:00:00.000Z'), '2026-11-08');
  assert.equal(toISODate('2026-11-08T23:30:00-05:00'), '2026-11-08');
  assert.equal(toISODate('2026-11-08T12:30'), '2026-11-08');
  for (const value of [
    '2026-02-31T00:00:00Z',
    '2026-11-08T24:00:00Z',
    '2026-11-08T12:60:00Z',
    '2026-11-08T12:30:99Z',
    '2026-11-08T12:30:00+25:00',
  ])
    assert.equal(toISODate(value), null);
});
