import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchService } from '../js/import-review/batchServiceCore.js';

function mockClient(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, methods: [] };
      calls.push(call);
      const query = new Proxy(
        {},
        {
          get(_target, name) {
            if (name === 'then')
              return (resolve, reject) => {
                if (!responses.length)
                  return reject(new Error(`Unexpected query: ${JSON.stringify(call)}`));
                const next = responses.shift();
                Promise.resolve(typeof next === 'function' ? next(call) : next).then(
                  resolve,
                  reject,
                );
              };
            return (...args) => {
              call.methods.push([name, ...args]);
              return query;
            };
          },
        },
      );
      return query;
    },
  };
}
const batchId = '12345678-1234-4234-8234-123456789abc';
const row = {
  raw_item_name: 'Cotton',
  raw_color_code: '12',
  raw_qty_primary: '4.5',
  raw_rolls: '2',
  raw_date: '2026-11-08',
};
const savedRow = {
  ...row,
  batch_id: batchId,
  row_index: 1,
  raw_color_name: null,
  raw_notes: null,
  raw_qty_primary: 4.5,
  raw_rolls: 2,
};
const options = { uuid: () => batchId, now: () => new Date('2026-11-08T00:00:00Z') };

test('active import catalog reads beyond one API page with stable identity ordering', async () => {
  const client = mockClient([
    { data: Array.from({ length: 500 }, (_, i) => ({ id: i })) },
    { data: [{ id: 500 }] },
  ]);
  const rows = await createBatchService(client).loadActiveItems();
  assert.equal(rows.length, 501);
  assert.deepEqual(
    client.calls.map((call) => call.methods.find((method) => method[0] === 'range')),
    [
      ['range', 0, 499],
      ['range', 500, 999],
    ],
  );
  assert.equal(
    client.calls.every((call) =>
      call.methods.some((method) => method[0] === 'order' && method[1] === 'id'),
    ),
    true,
  );
});

test('invalid integer import data fails before creating a batch header', async () => {
  const client = mockClient([]);
  await assert.rejects(
    createBatchService(client, options).createBatchWithLines({
      batchType: 'purchase',
      lines: [{ ...row, raw_rolls: '1.6' }],
    }),
    /السطر 1/,
  );
  assert.equal(client.calls.length, 0);
});

test('an uncertain line insert is verified without replaying writes or deleting data', async () => {
  const client = mockClient([
    { data: { id: batchId } },
    { error: { message: 'network' } },
    { data: [savedRow] },
  ]);
  const result = await createBatchService(client, options).createBatchWithLines({
    batchType: 'purchase',
    lines: [row],
  });
  assert.equal(result.lines.length, 1);
  assert.equal(
    client.calls.filter((call) => call.methods.some((method) => method[0] === 'insert')).length,
    2,
  );
  assert.equal(
    client.calls.some((call) => call.methods.some((method) => method[0] === 'delete')),
    false,
  );
});

test('an unverified insert keeps the recovery identity instead of creating another batch', async () => {
  const client = mockClient([
    { data: { id: batchId } },
    { error: { message: 'network' } },
    { data: [] },
  ]);
  await assert.rejects(
    createBatchService(client, options).createBatchWithLines({
      batchType: 'purchase',
      lines: [row],
    }),
    (error) => error.batchId === batchId,
  );
  assert.equal(
    client.calls.some((call) => call.methods.some((method) => method[0] === 'delete')),
    false,
  );
});

test('failed reads after a committed insert also return the batch recovery identity', async () => {
  const client = mockClient([
    { data: { id: batchId } },
    { data: null },
    { error: { message: 'offline' } },
  ]);
  await assert.rejects(
    createBatchService(client, options).createBatchWithLines({
      batchType: 'purchase',
      lines: [row],
    }),
    (error) => error.batchId === batchId,
  );
});

test('matching patches with identical values are grouped into one update', async () => {
  const lines = [1, 2, 3].map((id) => ({
    id,
    raw_item_name: 'Cotton',
    raw_color_code: '12',
    match_status: 'exact_match',
    is_included: true,
    is_posted: false,
  }));
  const client = mockClient([
    { data: lines },
    { data: null },
    { data: lines },
    { data: { id: batchId } },
  ]);
  await createBatchService(client).runSmartValidation(batchId, [
    { id: 'i', item_name: 'Cotton', color_code: '12' },
  ]);
  const updates = client.calls.filter(
    (call) =>
      call.table === 'import_batch_lines' && call.methods.some((method) => method[0] === 'update'),
  );
  assert.equal(updates.length, 1);
  assert.deepEqual(
    updates[0].methods.find((method) => method[0] === 'in'),
    ['in', 'id', [1, 2, 3]],
  );
  assert.deepEqual(
    updates[0].methods.find((method) => method[0] === 'eq'),
    ['eq', 'is_posted', false],
  );
});

test('duplicate detection batches source reads and compares explicit zero rolls exactly', async () => {
  const lines = [
    { id: 'a', matched_item_id: 'i', raw_date: '2026-11-08', raw_qty_primary: 5, raw_rolls: 0 },
    { id: 'b', matched_item_id: 'i', raw_date: '2026-11-08', raw_qty_primary: 5, raw_rolls: 2 },
  ];
  const moves = [
    { id: 'm', item_id: 'i', move_date: '2026-11-08', qty_main_in: 5, qty_rolls_in: 0 },
  ];
  const client = mockClient([{ data: lines }, { data: moves }, { data: null }]);
  await createBatchService(client).detectDuplicates({ id: batchId, batch_type: 'purchase' });
  assert.equal(client.calls.filter((call) => call.table === 'stock_moves').length, 1);
  const update = client.calls.find((call) => call.methods.some((method) => method[0] === 'update'));
  assert.deepEqual(
    update.methods.find((method) => method[0] === 'in'),
    ['in', 'id', ['a']],
  );
});
