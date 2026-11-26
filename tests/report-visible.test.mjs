import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPORT_BATCH_SIZE, visibleReportRows, nextReportRows } from '../js/report-visible.js';

test('reports start with twenty rows and expand without skipping previous rows', () => {
  assert.equal(REPORT_BATCH_SIZE, 20);
  assert.equal(visibleReportRows(REPORT_BATCH_SIZE, 147), 20);
  assert.equal(nextReportRows(20, 147), 40);
  assert.equal(nextReportRows(40, 147), 60);
  assert.equal(nextReportRows(140, 147), 147);
  assert.equal(visibleReportRows(147, 147), 147);
  assert.equal(visibleReportRows(REPORT_BATCH_SIZE, 10), 10);
  assert.equal(visibleReportRows(REPORT_BATCH_SIZE, 0), 0);
});

test('all report entry points use the same incremental display controls', () => {
  for (const name of ['sales', 'purchases']) {
    for (const suffix of ['report', 'report-preview', 'report-test']) {
      const html = readFileSync(new URL(`../${name}-${suffix}.html`, import.meta.url), 'utf8');
      for (const id of ['showMore', 'showAll', 'showLess', 'visibleCount']) {
        assert.ok(html.includes(`id="${id}"`), `${name}-${suffix}: ${id}`);
      }
      assert.ok(!html.includes('id="prevPage"'));
      assert.ok(!html.includes('id="nextPage"'));
    }
  }
});
