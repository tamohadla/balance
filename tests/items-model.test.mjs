import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctValues, filterItems, itemPayload, itemExportRows } from '../js/items/model.js';
import { categoryOptions, datalistOptions, itemRowsHtml } from '../js/items/view.js';

const items = [
  {
    id: 'b',
    main_category: 'صيف',
    sub_category: 'قطن',
    item_name: 'ثاني',
    color_code: '2',
    is_active: false,
    description: 'ملاحظة',
  },
  {
    id: 'a',
    main_category: 'شتاء',
    sub_category: 'قطن',
    item_name: 'أول',
    color_code: '1',
    is_active: true,
    unit_type: 'kg',
  },
  {
    id: 'c',
    main_category: 'صيف',
    sub_category: 'حرير',
    item_name: 'ثالث',
    color_code: '3',
    is_active: true,
  },
];

test('items filtering composes status, exact categories, focused identity and search without mutation', () => {
  assert.deepEqual(
    filterItems(items)
      .map((row) => row.id)
      .sort(),
    ['a', 'c'],
  );
  assert.deepEqual(
    filterItems(items, { status: 'inactive', mainCategory: ' صيف ', query: 'ملاحظة' }).map(
      (row) => row.id,
    ),
    ['b'],
  );
  assert.deepEqual(
    filterItems(items, { status: 'all', focusedItemId: 'a', subCategory: 'قطن' }).map(
      (row) => row.id,
    ),
    ['a'],
  );
  assert.equal(filterItems(items, { status: 'active', focusedItemId: 'b' }).length, 0);
  assert.deepEqual(
    items.map((row) => row.id),
    ['b', 'a', 'c'],
  );
});

test('items form normalization is shared by create and modal editing', () => {
  assert.deepEqual(
    itemPayload({
      main_category: ' صيف  جديد ',
      item_name: ' قطن ',
      color_code: ' ١٢ ',
      unit_type: 'kg',
      description: '  ',
    }),
    {
      main_category: 'صيف جديد',
      sub_category: null,
      item_name: 'قطن',
      color_code: '12',
      color_name: null,
      unit_type: 'kg',
      description: null,
    },
  );
  assert.deepEqual(distinctValues(items, 'sub_category', { mainCategory: 'شتاء', clean: true }), [
    'قطن',
  ]);
  assert.equal(itemExportRows(items).length, 3);
  assert.equal(itemExportRows(items).find((row) => row['رقم اللون'] === '2')['الحالة'], 'موقوف');
});

test('item view builders escape text and attribute values, including image URLs and identities', () => {
  const hostile = '" onerror="alert(1)';
  const html = itemRowsHtml(
    [
      {
        id: hostile,
        item_name: '<script>bad</script>',
        description: '<img src=x>',
        is_active: true,
      },
    ],
    { fullImageUrl: () => hostile, thumbnailUrl: () => hostile },
  );
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes('data-id="&quot; onerror=&quot;alert(1)"'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('src="" onerror='));
  assert.equal(datalistOptions(['<x>']), '<option value="&lt;x&gt;">');
  assert.ok(categoryOptions(['"'], '<all>').includes('&lt;all&gt;'));
});
