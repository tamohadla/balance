import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBulkLines,
  bulkPreviewRows,
  renderBulkPreview,
  sheetRowsToBulkText,
} from '../js/import-review/bulkItems.js';

function fakeDocument() {
  const create = (tag) => ({
    tag,
    children: [],
    textContent: '',
    append(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    set innerHTML(_value) {
      throw new Error('Untrusted HTML must never be parsed.');
    },
  });
  return { createElement: create, createDocumentFragment: () => create('fragment') };
}

test('bulk preview treats imported HTML and quotes as text in every dynamic cell', () => {
  const payload = '<img src=x onerror="globalThis.pwned=1">';
  const parsed = parseBulkLines(
    `${payload}|${payload}|${payload}|${payload}|${payload}|kg|${payload}`,
  );
  const doc = fakeDocument(),
    tbody = doc.createElement('tbody');
  tbody.ownerDocument = doc;
  renderBulkPreview(tbody, bulkPreviewRows(parsed, new Set()));
  const cells = tbody.children[0].children[0].children;
  assert.equal(cells[2].textContent.includes(payload), true);
  for (const index of [3, 4, 6]) assert.equal(cells[index].textContent, payload);
  assert.equal(globalThis.pwned, undefined);
});

test('bulk parsing validates fields and rejects duplicate lines before submission', () => {
  const rows = parseBulkLines(
    'Main|Sub|Cotton|١٢|White|kg\nMain|Sub|cotton|12|White|kg\nA|B|C|D|E|invalid\nA|B||D|E|m',
  );
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].data.color_code, '12');
  assert.equal(rows[1].ok, false);
  assert.match(rows[1].reason, /مكرر/);
  assert.equal(rows[2].ok, false);
  assert.equal(rows[3].ok, false);
});

test('Excel-to-text conversion preserves numeric zero and description delimiters', () => {
  const text = sheetRowsToBulkText([['header'], ['A', 'B', 'C', 0, 'white', 'kg', 'part|two']]);
  assert.equal(text, 'A|B|C|0|white|kg|part|two');
  assert.equal(parseBulkLines(text)[0].data.description, 'part|two');
});
