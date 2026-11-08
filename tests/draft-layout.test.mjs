import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockEntryDraft } from '../js/stock-entry/draft.js';

// Minimal DOM adapter: exercise the exported controller without source parsing.
class Element {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.hidden = false;
    this.listeners = new Map();
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  before(...nodes) {
    const index = this.parent.children.indexOf(this);
    for (const node of nodes) node.parent = this.parent;
    this.parent.children.splice(index, 0, ...nodes);
  }
  closest(selector) {
    for (let node = this; node; node = node.parent)
      if (selector === '.entry-layout' && node.className === 'entry-layout') return node;
    return null;
  }
  replaceChildren() {
    this.children = [];
  }
  setAttribute() {}
  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }
}

function fixture({ mode = 'empty', saved, state = {} } = {}) {
  const main = new Element('main'),
    layout = new Element('layout'),
    form = new Element('form'),
    aside = new Element('aside');
  layout.className = 'entry-layout';
  main.append(layout);
  layout.append(form, aside);
  const ids = {
    moveForm: form,
    entryFields: {},
    saveEntry: {},
    btnCancel: {},
    btnBulkImport: {},
    move_date: { value: '2026-11-08' },
    groupNote: { value: '' },
    rows: new Element('rows'),
    orderPrefillNotice: { hidden: true },
  };
  const values = new Map();
  if (mode === 'saved' || saved)
    values.set('test', JSON.stringify(saved || { lines: [{ item_id: 'sample' }] }));
  const storage = {
    getItem(key) {
      if (mode === 'unreadable') throw Error('blocked');
      return values.get(key) || null;
    },
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const current = { busy: false, pending: null, admin: true, prefill: null, ...state },
    restored = [],
    eventTarget = new Element('window');
  const controller = createStockEntryDraft({
    $: (id) => ids[id],
    document: { createElement: (name) => new Element(name) },
    eventTarget,
    storage,
    key: 'test',
    getState: () => current,
    todayISO: () => '2026-11-08',
    clearPrefill: () => {
      current.prefill = null;
    },
    setPrefill: (value) => {
      current.prefill = value;
    },
    prefillKey: 'order-prefill',
    addRow(line) {
      restored.push(line);
      const fields = {
        '.itemSearch': { value: line.search || '' },
        '.qtyMain': { value: line.qty_main ?? '' },
        '.qtyRolls': { value: line.qty_rolls ?? '' },
        '.lineNote': { value: line.note || '' },
      };
      ids.rows.children.push({
        dataset: { item: line.item_id },
        querySelector: (selector) => fields[selector],
      });
    },
    lock(value) {
      current.busy = value;
      for (const id of ['entryFields', 'saveEntry', 'btnCancel', 'btnBulkImport'])
        ids[id].disabled = value;
    },
  });
  return { controller, main, layout, form, aside, ids, storage, current, restored, eventTarget };
}

for (const mode of ['empty', 'saved', 'unreadable'])
  test(`draft notices preserve form and summary columns: ${mode}`, () => {
    const { controller, main, layout, form, aside, ids, eventTarget } = fixture({ mode });
    controller.mount();
    assert.deepEqual(layout.children, [form, aside]);
    assert.equal(main.children.length, 3);
    assert.equal(main.children[2], layout);
    assert.equal(main.children[1].id, 'draftStatus');
    assert.equal(main.children[0].hidden, mode !== 'saved');
    if (mode === 'saved') assert.equal(ids.entryFields.disabled, true);
    assert.equal(form.listeners.get('input'), controller.persist);
    assert.equal(eventTarget.listeners.get('pagehide'), controller.persist);
  });

test('restore retains partial field strings and linked order prefill', () => {
  const saved = {
    date: '2026-11-07',
    note: 'استلام',
    prefill: { order_id: 'order', customer_name: 'Customer' },
    lines: [{ item_id: null, search: 'غير مكتمل', qty_main: '', qty_rolls: '0', note: 'سطر' }],
  };
  const { controller, main, ids, storage, current, restored } = fixture({ saved });
  controller.mount();
  main.children[0].children[1].onclick();
  assert.equal(main.children[0].hidden, true);
  assert.equal(ids.entryFields.disabled, false);
  assert.equal(ids.move_date.value, saved.date);
  assert.equal(ids.groupNote.value, saved.note);
  assert.deepEqual(current.prefill, saved.prefill);
  assert.deepEqual(JSON.parse(storage.getItem('order-prefill')), saved.prefill);
  assert.deepEqual(restored, saved.lines);
  assert.equal(ids.orderPrefillNotice.hidden, false);
  assert.deepEqual(JSON.parse(storage.getItem('test')).lines, saved.lines);
});

test('discard unlocks form and removes a previous draft', () => {
  const { controller, main, ids, storage } = fixture({ mode: 'saved' });
  controller.mount();
  main.children[0].children[2].onclick();
  assert.equal(main.children[0].hidden, true);
  assert.equal(ids.entryFields.disabled, false);
  assert.equal(storage.getItem('test'), null);
});

test('pending requests and read-only access never overwrite a stored draft', () => {
  for (const state of [{ pending: { p_id: 'pending' } }, { admin: false }]) {
    const { controller, main, storage } = fixture({ mode: 'saved', state }),
      before = storage.getItem('test');
    controller.mount();
    controller.persist();
    assert.equal(main.children[0].hidden, true);
    assert.equal(storage.getItem('test'), before);
  }
});
