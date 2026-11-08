import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreordersState,
  categoryOptions,
  selectInventoryRows,
  sortItemMoves,
} from '../js/inventory/model.js';
import { createInventoryView } from '../js/inventory/view.js';
import { createInventoryHistory } from '../js/inventory/history-dialogs.js';
import {
  inventoryViewUrl,
  persistInventoryView,
  restoreInventoryView,
} from '../js/inventory/view-state.js';
import { inventoryCsv } from '../js/inventory/export.js';

const row = (id, values = {}) => ({
  id,
  is_active: true,
  main_category: 'cotton',
  sub_category: 'plain',
  item_name: id,
  color_code: '1',
  balance_rolls: 2,
  balance_main: 10,
  preorder_total_rolls: 0,
  balance_after_orders: 2,
  unit_type: 'kg',
  ...values,
});
const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
const view = createInventoryView({
  escapeHtml,
  materialLabel: (r) => r.item_name,
  unitLabel: (u) => u,
  getPublicImageUrl: (path) => (path ? `https://example.test/${path}` : ''),
  getThumbnailImageUrl: (path) => `https://example.test/thumb/${path}`,
});

test('inventory selectors compose filters without mutating the loaded snapshot', () => {
  const rows = [
    row('a', { balance_rolls: 8 }),
    row('b', { balance_rolls: 3 }),
    row('c', { is_active: false }),
    row('d', { unit_type: 'm' }),
  ];
  Object.freeze(rows);
  const selected = selectInventoryRows(rows, {
    scope: 'active',
    unit: 'kg',
    main: 'cotton',
    search: '',
    quickFilter: 'positive_rolls',
    preset: 'most_rolls',
  });
  assert.deepEqual(
    selected.map((r) => r.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(
    selectInventoryRows(rows, { item: 'c', scope: 'inactive', search: 'c', preset: 'default' }).map(
      (r) => r.id,
    ),
    ['c'],
  );
  assert.deepEqual(selectInventoryRows(rows, { sub: 'missing' }), []);
});

test('category choices are unique, trimmed and constrained by selected main category', () => {
  const options = categoryOptions(
    [
      row('a'),
      row('b', { main_category: ' cotton ', sub_category: 'printed' }),
      row('c', { main_category: 'linen', sub_category: 'woven' }),
    ],
    'cotton',
  );
  assert.deepEqual(options.mains, ['cotton', 'linen']);
  assert.deepEqual(options.subs, ['plain', 'printed']);
});

test('reservation summary counts unique orders while keeping all detail lines', () => {
  const old = { id: 'order-1', created_at: '2026-01-01', customer_name: 'A', status: 'draft' };
  const recent = {
    id: 'order-2',
    created_at: '2026-01-02',
    customer_name: 'B',
    status: 'pending_sale',
  };
  const { preordersByItem, preorderDetailsByItem } = buildPreordersState([
    { item_id: 'a', qty_rolls: 2, customer_orders: old },
    { item_id: 'a', qty_rolls: 1, customer_orders: [old] },
    { item_id: 'a', qty_rolls: 4, customer_orders: recent },
  ]);
  assert.deepEqual(preordersByItem.get('a'), { totalRolls: 7, count: 2 });
  assert.equal(preorderDetailsByItem.get('a').length, 3);
  assert.equal(preorderDetailsByItem.get('a')[0].order_id, 'order-2');
});

test('view restoration honors explicit URLs and tolerates unavailable or malformed storage', () => {
  const stored = { getItem: () => JSON.stringify({ query: '?scope=inactive', scroll: 300 }) };
  assert.equal(
    restoreInventoryView('https://example.test/inventory.html', stored, 'key').scroll,
    300,
  );
  const explicit = restoreInventoryView(
    'https://example.test/inventory.html?scope=active',
    stored,
    'key',
  );
  assert.equal(explicit.url.search, '?scope=active');
  assert.equal(explicit.scroll, 0);
  assert.equal(
    restoreInventoryView('https://example.test/inventory.html', { getItem: () => '{bad' }, 'key')
      .scroll,
    0,
  );
  assert.equal(
    restoreInventoryView('https://example.test/inventory.html', undefined, 'key').scroll,
    0,
  );
  assert.equal(
    persistInventoryView(
      {
        setItem() {
          throw Error('quota');
        },
      },
      'key',
      '?scope=all',
      10,
    ),
    false,
  );
  const url = inventoryViewUrl('https://example.test/inventory.html?item=a', {
    scope: 'all',
    search: 'قماش & لون',
    threshold: 10,
  });
  assert.equal(url.searchParams.get('item'), 'a');
  assert.equal(url.searchParams.get('search'), 'قماش & لون');
});

test('view builders escape labels and attribute values, and respect available actions', () => {
  const malicious = row('a', {
    item_name: '<img src=x onerror=alert(1)>',
    color_name: '"<script>',
    image_path: 'x" onerror="alert(1)',
  });
  const html = view.rowsHtml([malicious], {
    preordersByItem: new Map(),
    canWrite: false,
    isAdmin: false,
    itemStatusBusy: false,
  });
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&quot; onerror=&quot;'));
  assert.equal(html.includes('data-act="edit-item"'), false);
  assert.equal(html.includes('data-act="adjust-item"'), false);
  assert.equal(html.includes('<script>'), false);
  const writable = view.rowsHtml([row('a')], {
    preordersByItem: new Map(),
    canWrite: true,
    isAdmin: true,
    itemStatusBusy: true,
  });
  assert.ok(writable.includes('data-act="edit-item"'));
  assert.ok(writable.includes('data-act="adjust-item"'));
  assert.ok(writable.includes('data-act="toggle-item-status" data-id="a" disabled'));
});

test('movement sorting and cumulative view preserve the source list and escape notes', () => {
  const moves = [
    {
      id: 'a',
      move_date: '2026-01-01',
      created_at: '2026-01-01',
      qty_main_in: 10,
      qty_rolls_in: 2,
      type: 'purchase',
    },
    {
      id: 'b',
      move_date: '2026-01-02',
      created_at: '2026-01-02',
      qty_main_out: 4,
      qty_rolls_out: 1,
      type: 'sale',
      note: '<script>x</script>',
    },
  ];
  const sorted = sortItemMoves(moves);
  assert.equal(sorted[0].id, 'b');
  assert.equal(moves[0].id, 'a');
  const html = view.movesHtml(sorted, 'kg');
  assert.ok(html.includes('6.000 kg / 1 توب'));
  assert.ok(html.includes('10.000 kg / 2 توب'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('closed history dialogs ignore both late success and late failure', async () => {
  for (const reject of [false, true]) {
    const elements = Object.fromEntries(
      ['movesTitle', 'movesTbody', 'movesModal'].map((id) => [
        id,
        { style: {}, innerHTML: '', textContent: '' },
      ]),
    );
    let finish,
      errors = 0;
    const history = createInventoryHistory({
      getRows: () => [row('a')],
      getOrderDetails: () => new Map(),
      readItemMoves: () =>
        new Promise((resolve, fail) => {
          finish = reject ? fail : resolve;
        }),
      $: (id) => elements[id],
      view,
      materialLabel: (r) => r.item_name,
      onError: () => errors++,
    });
    const pending = history.openMoves('a');
    history.invalidateMoves();
    const loading = elements.movesTbody.innerHTML;
    finish(reject ? Error('late') : []);
    await pending;
    assert.equal(elements.movesTbody.innerHTML, loading);
    assert.equal(errors, 0);
  }
});

test('CSV export preserves numeric zero and prevents spreadsheet formula injection', () => {
  const csv = inventoryCsv(
    [row('=HYPERLINK("x")', { balance_main: 0, description: 'unused' })],
    (u) => u,
  );
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"0","2"'));
  assert.equal(csv.split('\r\n').length, 2);
});
