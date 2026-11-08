import test from 'node:test';
import assert from 'node:assert/strict';
import { orderCards, orderDetails, orderPreview, sortOrderLines } from '../js/orders/views.js';
import { productCards, checkoutLines, savedOrderSnapshot } from '../js/preorders/views.js';
import { catalogFromSummaries } from '../js/preorders/service.js';

const attack = '<img src=x onerror="alert(1)">';
const item = {
  id: 'item',
  item_name: attack,
  color_code: attack,
  color_name: attack,
  main_category: attack,
  sub_category: 'Sub',
  is_active: true,
  image_path: 'photo',
  balance_rolls: 5,
  pending_rolls: 2,
};
const imageUrl = () => 'https://images.example/image?x=" onerror="alert(1)';
const order = {
  id: 'order',
  customer_name: attack,
  customer_phone: attack,
  note: attack,
  status: 'draft',
  created_at: '2026-01-01T12:00:00Z',
  customer_order_lines: [{ item_id: 'item', qty_rolls: 2 }],
};
const itemMap = new Map([['item', item]]);

test('order and catalog views encode every untrusted text field and image attribute', () => {
  const outputs = [
    orderCards([order], itemMap, imageUrl),
    orderDetails(order, order.customer_order_lines, itemMap, imageUrl),
    productCards([item], { item: 2 }, false, imageUrl),
    checkoutLines([['item', 2]], itemMap, false, imageUrl),
    savedOrderSnapshot(
      {
        id: 'receipt',
        createdAt: order.created_at,
        customer: { name: attack, phone: attack, note: attack },
        lines: [{ item, qty_rolls: 2 }],
      },
      imageUrl,
    ),
  ];
  for (const html of outputs) {
    assert.ok(!html.includes(attack));
    assert.ok(html.includes('&lt;img'));
    assert.ok(!html.includes('x=" onerror="'));
  }
});

test('previews deduplicate material identities, bound photos and tolerate missing material data', () => {
  const lines = ['item', 'item', 'missing', 'third', 'fourth'].map((item_id) => ({ item_id }));
  const html = orderPreview(lines, itemMap, imageUrl);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.ok(html.includes('preview-more">+1'));
  assert.ok(orderPreview([], itemMap, imageUrl).includes('لا يحتوي'));
  assert.doesNotThrow(() =>
    savedOrderSnapshot(
      { id: 'x', createdAt: '2026-01-01', customer: { name: 'a' }, lines: [{ qty_rolls: 1 }] },
      imageUrl,
    ),
  );
});

test('order line sorting is stable, puts missing materials last and leaves source arrays intact', () => {
  const lines = [
    { id: 'missing', item_id: 'missing' },
    { id: 'b', item_id: 'b' },
    { id: 'a', item_id: 'a' },
  ];
  const items = new Map([
    ['a', { main_category: 'A', item_name: 'Material', color_code: '2' }],
    ['b', { main_category: 'A', item_name: 'Material', color_code: '10' }],
  ]);
  assert.deepEqual(
    sortOrderLines(lines, items).map((line) => line.id),
    ['a', 'b', 'missing'],
  );
  assert.equal(lines[0].id, 'missing');
});

test('catalog summaries preserve purchase metadata and normalize numeric values without mutating source', () => {
  const source = [
    {
      id: 'a',
      main_category: '  Main  ',
      sub_category: ' Sub ',
      balance_rolls: '7',
      last_purchase_key: '2026-01-01|2026-01-01T12:00:00Z',
    },
    { id: 'b', main_category: '', balance_rolls: 0 },
  ];
  const map = catalogFromSummaries(source, [
    { item_id: 'a', qty_rolls: '2' },
    { item_id: 'a', qty_rolls: 3 },
    { item_id: 'missing', qty_rolls: 99 },
  ]);
  assert.equal(map.get('a').balance_rolls, 7);
  assert.equal(map.get('a').pending_rolls, 5);
  assert.equal(map.get('a').main_category, 'Main');
  assert.equal(map.get('a').last_purchase_key, source[0].last_purchase_key);
  assert.equal(map.get('b').main_category, 'غير مصنف');
  assert.equal(source[0].main_category, '  Main  ');
  assert.ok(!('pending_rolls' in source[0]));
});
