import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_PAGES, safeNext } from '../js/auth-core.js';
import { canAccessPage } from '../js/permissions.js';

const names = [
  'sales-report.html',
  'purchases-report.html',
  'sales-report-preview.html',
  'purchases-report-preview.html',
  'sales-report-test.html',
  'purchases-report-test.html',
];

test('all report links are protected by the existing shared session', () => {
  const base = 'https://example.test/balance/login.html';
  const admin = { role: 'admin', is_active: true };
  const viewer = { role: 'viewer', is_active: true };
  const assistant = {
    role: 'assistant',
    is_active: true,
    permissions: { sales: 'read', purchases: 'none' },
  };
  for (const page of names) {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    assert.equal(APP_PAGES.has(page), true, page);
    assert.equal(safeNext(page, base), 'https://example.test/balance/' + page);
    assert.match(html, /<html[^>]*data-auth-pending/);
    assert.match(html, /src="js\\/session-ui\\.js/);
    assert.match(html, /src="js\\/reports-preview\\.js/);
    assert.equal(canAccessPage(admin, page), true, page);
    assert.equal(canAccessPage(viewer, page), false, page);
    assert.equal(canAccessPage(assistant, page), page.startsWith('sales-'), page);
  }
});

test('report data uses the shared guarded Supabase client, not a second sign-in flow', () => {
  const source = readFileSync(new URL('../js/reports-preview.js', import.meta.url), 'utf8');
  assert.match(source, /import \\{ supabase \\} from '\\.\\/supabaseClient\\.js'/);
  assert.doesNotMatch(source, /signInWithPassword|buildHeader\\(|from '\\.\\/supabaseRaw\\.js'/);
});
