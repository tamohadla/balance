// Shared, testable access checks. Database RLS remains the authority.
export const APP_PAGES = new Set([
  'index.html', 'items.html', 'inventory.html', 'purchases.html', 'sales.html',
  'preorders.html', 'orders.html', 'reconciliation.html', 'adjustments.html',
  'color-names.html', 'import-printed.html', 'import-v2.html', 'import-batches.html',
  'import-batch-details.html', 'purchases-import-review.html', 'sales-import-review.html',
  'users.html', 'account.html'
]);

export function safeNext(value, currentUrl) {
  const base = new URL('./', currentUrl);
  const fallback = new URL('index.html', base).href;
  try {
    const next = new URL(value || 'index.html', base);
    const name = next.pathname.slice(base.pathname.length);
    if (next.origin !== base.origin || next.username || next.password ||
        !next.pathname.startsWith(base.pathname) || !APP_PAGES.has(name)) return fallback;
    next.hash = '';
    return next.href;
  } catch { return fallback; }
}

export async function checkAccess(client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user || data.user.is_anonymous) return { ok: false, reason: 'signin' };
  const result = await client.from('app_members')
    .select('user_id, display_name, role, is_active').eq('user_id', data.user.id).maybeSingle();
  if (result.error) return { ok: false, reason: 'unavailable' };
  const member = result.data;
  if (!member?.is_active || !['admin', 'viewer'].includes(member.role)) {
    return { ok: false, reason: 'access' };
  }
  return { ok: true, user: data.user, member };
}
