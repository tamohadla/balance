import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageStore } from '../js/core/image-store.js';
// Exercise the actual storage transaction without browser encoding or Auth.
const { saveImagePair, removeImagePair } = createImageStore({
  resizeImageBlob: async (blob, size) => ({ size }),
  thumbnailPath: (path) => path + '.thumb-224.jpg',
  uuid: () => 'test-upload',
});
function fixture(mode = '') {
  const state = {
    path: 'items/old.jpg',
    files: new Set(['items/old.jpg', 'items/old.jpg.thumb-224.jpg', 'items/old.jpg.thumb-200.jpg']),
    uploads: 0,
  };
  const bucket = {
    upload: async (p) => {
      if (mode === 'upload' && ++state.uploads === 2) return { error: Error('upload') };
      state.files.add(p);
      return {};
    },
    remove: async (paths) => {
      paths.forEach((p) => state.files.delete(p));
      return {};
    },
  };
  const client = {
    storage: { from: () => bucket },
    from: () => {
      let value;
      const q = {
        update: (v) => ((value = v), q),
        eq: () => q,
        is: () => q,
        select: () => q,
        single: () => q,
        then: (resolve) => {
          if (value) {
            if (mode === 'conflict') return resolve({ data: [] });
            if (mode === 'db' || mode === 'unknown') return resolve({ error: Error('write') });
            state.path = value.image_path;
            if (mode === 'lost') return resolve({ error: Error('network') });
            return resolve({ data: [{ id: 'id' }] });
          }
          resolve(
            mode === 'unknown' ? { error: Error('offline') } : { data: { image_path: state.path } },
          );
        },
      };
      return q;
    },
  };
  return { client, state };
}
test('replacement publishes both files, removes old pair, and deletion removes both versions', async () => {
  const { client, state } = fixture();
  const { path } = await saveImagePair(client, 'id', state.path, {});
  assert.equal(state.path, path);
  assert.deepEqual([...state.files].sort(), [path, path + '.thumb-224.jpg'].sort());
  await removeImagePair(client, path);
  assert.equal(state.files.size, 0);
});
for (const mode of ['upload', 'db', 'conflict'])
  test(`${mode} failure retains previous full image and thumbnail`, async () => {
    const { client, state } = fixture(mode);
    await assert.rejects(saveImagePair(client, 'id', state.path, {}));
    assert.equal(state.path, 'items/old.jpg');
    assert.deepEqual([...state.files].sort(), [
      'items/old.jpg',
      'items/old.jpg.thumb-200.jpg',
      'items/old.jpg.thumb-224.jpg',
    ]);
  });
test('lost response after commit never deletes the newly referenced pair', async () => {
  const { client, state } = fixture('lost');
  const { path } = await saveImagePair(client, 'id', state.path, {});
  assert.equal(state.path, path);
  assert.ok(state.files.has(path));
  assert.ok(state.files.has(path + '.thumb-224.jpg'));
});
test('unknown commit outcome retains files until status can be determined', async () => {
  const { client, state } = fixture('unknown');
  await assert.rejects(saveImagePair(client, 'id', state.path, {}));
  assert.equal(state.files.size, 5);
});

test('encoding finishes before uploads and uses injected identity and square derivative', async () => {
  const { client, state } = fixture();
  const input = { source: true },
    calls = [];
  const full = { full: true },
    small = { small: true };
  const store = createImageStore({
    resizeImageBlob: async (blob, size, square = false) => {
      assert.equal(state.files.size, 3, 'must not upload a partial pair while encoding');
      calls.push({ blob, size, square });
      return square ? small : full;
    },
    thumbnailPath: (path) => path + '.thumb-224.jpg',
    uuid: () => 'injected-id',
  });
  const result = await store.saveImagePair(client, 'item', state.path, input);
  assert.equal(result.path, 'items/item_injected-id.jpg');
  assert.deepEqual(calls, [
    { blob: input, size: 800, square: false },
    { blob: full, size: 224, square: true },
  ]);
});

test('post-commit cleanup failure is reported without losing the new pair', async () => {
  const { client, state } = fixture();
  const oldPath = state.path,
    failure = Error('storage cleanup offline');
  const storage = client.storage.from();
  storage.remove = async () => ({ error: failure });
  const replacements = [];
  const store = createImageStore({
    resizeImageBlob: async (blob, size) => ({ size }),
    thumbnailPath: (path) => path + '.thumb-224.jpg',
    uuid: () => 'new-id',
    recordImageReplacement: (previous, next) => replacements.push([previous, next]),
    refreshSiteImages: () => {
      throw Error('browser storage blocked');
    },
  });
  const result = await store.saveImagePair(client, 'item', oldPath, {});
  assert.equal(result.cleanupError, failure);
  assert.equal(state.path, result.path);
  assert.ok(state.files.has(result.path));
  assert.ok(state.files.has(result.path + '.thumb-224.jpg'));
  assert.ok(state.files.has(oldPath));
  assert.deepEqual(replacements, [[oldPath, result.path]]);
});
