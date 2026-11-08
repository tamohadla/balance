import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemEditor } from '../js/items/editor.js';
import { ITEM_FIELDS } from '../js/items/model.js';

function element() {
  const events = new Map();
  return {
    value: '',
    style: {},
    events,
    addEventListener(name, handler) {
      events.set(name, handler);
    },
  };
}
function controls() {
  const values = new Map(
    [
      'editItemModal',
      'editItemForm',
      'editModalId',
      'editItemModalClose',
      'editItemModalCancel',
      ...ITEM_FIELDS.map((field) => 'edit_' + field),
    ].map((id) => [id, element()]),
  );
  const button = { disabled: false };
  const form = values.get('editItemForm');
  form.querySelectorAll = () => [button];
  form.reset = () => {};
  values.get('editItemModal').ownerDocument = element();
  return {
    getElement: (id) => values.get(id),
    button,
    submit: () => form.events.get('submit')({ preventDefault() {} }),
  };
}

test('item editor prevents duplicate saves, preserves fields on failure, and retries', async () => {
  const ui = controls();
  let release,
    calls = 0;
  const errors = [];
  const editor = createItemEditor({
    ...ui,
    save: async () => {
      calls++;
      await new Promise((resolve) => (release = resolve));
      throw Error('offline');
    },
    onSaved() {
      assert.fail('unexpected success');
    },
    onError: (error) => errors.push(error.message),
  });
  editor.open({ id: 'a', item_name: 'قطن', unit_type: 'kg' });
  const saving = ui.submit();
  assert.equal(ui.button.disabled, true);
  await ui.submit();
  editor.close();
  assert.equal(calls, 1);
  assert.equal(ui.getElement('editItemModal').style.display, 'flex');
  release();
  await saving;
  assert.deepEqual(errors, ['offline']);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.getElement('edit_item_name').value, 'قطن');
});

test('item editor saves normalized form values and closes after success', async () => {
  const ui = controls();
  let saved;
  const editor = createItemEditor({
    ...ui,
    save: async (values, id) => {
      saved = { values, id };
      return { id, ...values };
    },
    onSaved() {},
    onError(error) {
      throw error;
    },
  });
  editor.open({ id: 'a', item_name: '  قطن  ', color_code: '١٢', unit_type: 'kg' });
  await ui.submit();
  assert.equal(saved.id, 'a');
  assert.equal(saved.values.item_name, 'قطن');
  assert.equal(saved.values.color_code, '12');
  assert.equal(ui.getElement('editItemModal').style.display, 'none');
  assert.equal(ui.getElement('editModalId').value, '');
});
