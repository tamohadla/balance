import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { APP_PAGES, safeNext, checkAccess } from '../js/auth-core.js';

const base = 'https://example.test/balance/login.html';
test('redirects stay in the application and only target known pages', () => {
  for (const value of ['https://evil.test/', '//evil.test/', 'javascript:alert(1)', '../other/index.html', 'login.html', 'https://x@example.test/balance/index.html', '/balance/%2e%2e/index.html']) {
    assert.equal(safeNext(value, base), 'https://example.test/balance/index.html');
  }
  assert.equal(safeNext('orders.html?id=123#fragment', base), 'https://example.test/balance/orders.html?id=123');
});
function client(user, member, error = null) {
  return {
    auth: { getUser: async () => ({data: {user}, error: null}) },
    from: name => {
      assert.equal(name, 'app_members');
      return {select: () => ({eq: (column, id) => {
        assert.equal(column, 'user_id'); assert.equal(id, user.id);
        return {maybeSingle: async () => ({data: member, error})};
      }})};
    }
  };
}
test('missing sessions and anonymous Auth users are denied', async () => {
  assert.equal((await checkAccess(client(null))).ok, false);
  assert.equal((await checkAccess(client({id: 'u', is_anonymous: true}))).ok, false);
});
test('signing up or changing user metadata does not grant membership', async () => {
  const user = {id: 'u', user_metadata: {role: 'admin'}};
  assert.equal((await checkAccess(client(user, null))).reason, 'access');
  assert.equal((await checkAccess(client(user, {role:'admin', is_active:false}))).ok, false);
  assert.equal((await checkAccess(client(user, {role:'unexpected', is_active:true}))).ok, false);
});
test('active members pass; database failures fail closed', async () => {
  for (const role of ['admin','viewer']) assert.equal((await checkAccess(client({id:'u'}, {role,is_active:true}))).ok, true);
  assert.equal((await checkAccess(client({id:'u'}, null, {message:'offline'}))).reason, 'unavailable');
});
test('every business page has a gate and the shared client waits for authorization', () => {
  for (const page of APP_PAGES) {
    const html = readFileSync(new URL('../'+page, import.meta.url), 'utf8');
    assert.match(html, /<html[^>]*data-auth-pending/);
    assert.match(html, /js\/session-ui.js/);
    assert.match(html, /id="authGate"/);
  }
  const clientSource = readFileSync(new URL('../js/supabaseClient.js',import.meta.url),'utf8');
  assert.match(clientSource, /await requireAccess\(\)/);
  const pages = readdirSync(new URL('../',import.meta.url)).filter(p=>p.endsWith('.html') && p!=='login.html');
  assert.equal(pages.length, APP_PAGES.size);
});
