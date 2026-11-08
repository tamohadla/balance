import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows } from '../js/core/pagination.js';
import { createOrderService } from '../js/orders/service.js';
import { createCatalogService } from '../js/preorders/service.js';

function clientFor(respond) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [], orders: [] };
      calls.push(call);
      const q = {
        select(fields) {
          call.fields = fields;
          return q;
        },
        in(field, values) {
          call.filters.push(['in', field, values]);
          return q;
        },
        eq(field, value) {
          call.filters.push(['eq', field, value]);
          return q;
        },
        is(field, value) {
          call.filters.push(['is', field, value]);
          return q;
        },
        order(field, options) {
          call.orders.push([field, options]);
          return q;
        },
        update(values) {
          call.values = values;
          return q;
        },
        delete() {
          call.deleted = true;
          return q;
        },
        range(start, end) {
          call.range = [start, end];
          return Promise.resolve(respond(call));
        },
        maybeSingle() {
          return Promise.resolve(respond(call));
        },
        then(resolve, reject) {
          return Promise.resolve(respond(call)).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test('pagination reads full pages, preserves order, and propagates errors instead of partial results', async () => {
  const ranges = [];
  const rows = await readAllRows(
    () => ({
      range(start, end) {
        ranges.push([start, end]);
        return { data: start === 0 ? [1, 2] : [3] };
      },
    }),
    { pageSize: 2 },
  );
  assert.deepEqual(rows, [1, 2, 3]);
  assert.deepEqual(ranges, [
    [0, 1],
    [2, 3],
  ]);
  const error = new Error('offline');
  await assert.rejects(
    readAllRows(() => ({ range: () => ({ error }) })),
    error,
  );
  await assert.rejects(
    readAllRows(() => ({ range: () => ({ data: { unexpected: true } }) })),
    TypeError,
  );
  await assert.rejects(
    readAllRows(() => ({}), { pageSize: 0 }),
    RangeError,
  );
});

test('material lookups batch IDs, cache missing rows, and retain retryability on failures', async () => {
  let fail = false;
  const client = clientFor((call) =>
    fail
      ? { error: new Error('offline') }
      : { data: call.filters[0][2].filter((id) => id !== 'missing').map((id) => ({ id })) },
  );
  const service = createOrderService(client);
  const ids = Array.from({ length: 151 }, (_, i) => String(i));
  ids.push('missing');
  const map = await service.itemsByIds(ids);
  assert.equal(client.calls.length, 2);
  assert.equal(map.get('missing'), null);
  await service.itemsByIds(['0', 'missing']);
  assert.equal(client.calls.length, 2);
  fail = true;
  await assert.rejects(service.itemsByIds(['new']), /offline/);
  assert.ok(!service.itemCache.has('new'));
  fail = false;
  await service.itemsByIds(['new']);
  assert.ok(service.itemCache.has('new'));
});

test('order mutations compare the current fields and reject stale results', async () => {
  const client = clientFor(() => ({ data: { id: 'o' } }));
  const service = createOrderService(client);
  await service.mutate(
    { id: 'o', status: 'draft', customer_name: 'old', customer_phone: '123', note: null },
    { customer_name: 'new' },
  );
  assert.deepEqual(client.calls[0].filters, [
    ['eq', 'id', 'o'],
    ['eq', 'status', 'draft'],
    ['eq', 'customer_name', 'old'],
    ['eq', 'customer_phone', '123'],
    ['is', 'note', null],
  ]);
  const stale = createOrderService(clientFor(() => ({ data: null })));
  await assert.rejects(
    stale.mutate({ id: 'o', status: 'draft' }, { status: 'confirmed' }),
    /تغيّر الطلب/,
  );
});

test('catalog service uses paged summaries instead of downloading movement history', async () => {
  const client = clientFor((call) => ({
    data:
      call.table === 'inventory_balances'
        ? [{ id: 'a', balance_rolls: '8' }]
        : [{ item_id: 'a', qty_rolls: 3 }],
  }));
  const map = await createCatalogService(client).loadCatalog();
  assert.equal(map.get('a').balance_rolls, 8);
  assert.equal(map.get('a').pending_rolls, 3);
  assert.deepEqual(
    client.calls.map((call) => call.table),
    ['inventory_balances', 'customer_order_lines'],
  );
  assert.ok(client.calls.every((call) => call.orders[0][0] === 'id'));
});
