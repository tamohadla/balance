import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemsService } from '../js/items/service.js';

function queryClient(response) {
  const calls = [];
  const query = {
    then(resolve, reject) {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  for (const method of [
    'from',
    'select',
    'order',
    'eq',
    'single',
    'limit',
    'update',
    'insert',
    'delete',
  ]) {
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  return { client: query, calls };
}

test('items service consistently propagates failures for reads, saves and deletes', async () => {
  const error = new Error('network');
  const { client } = queryClient({ error });
  const service = createItemsService(client, async (makeQuery) => {
    const result = await makeQuery();
    if (result.error) throw result.error;
    return result.data;
  });
  for (const operation of [
    () => service.get('id'),
    () => service.exists({ item_name: 'A', color_code: '1' }),
    () => service.save({ item_name: 'A' }),
    () => service.setActive('id', false),
    () => service.remove('id'),
    () => service.list(),
  ]) {
    await assert.rejects(operation(), (candidate) => candidate === error);
  }
});

test('items service uses explicit identity filters and paginated listing', async () => {
  const { client, calls } = queryClient({ data: { id: 'a' } });
  const service = createItemsService(client, async (makeQuery) => {
    await makeQuery();
    return [{ id: 'a' }];
  });
  assert.deepEqual(await service.list(), [{ id: 'a' }]);
  assert.ok(calls.some((call) => call[0] === 'order' && call[1] === 'id'));
  await service.save({ item_name: 'A' }, 'a');
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === 'a'));
  assert.ok(calls.some((call) => call[0] === 'update'));
  calls.length = 0;
  await service.save({ item_name: 'B' });
  assert.ok(calls.some((call) => call[0] === 'insert'));
  assert.ok(!calls.some((call) => call[0] === 'update'));
});
