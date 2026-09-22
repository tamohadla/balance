// Shared, testable access checks. Database RLS remains the authority.
export const APP_PAGES = new Set([
  'index.html', 'items.html', 'item-groups.html', 'image-preview.html', 'inventory.html', 'purchases.html', 'sales.html', 'purchases-review.html', 'sales-review.html',
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

export async function checkAccess(client, { localSession = false } = {}) {
  // Local session is only a navigation hint. The membership query below is always
  // authenticated by Supabase and constrained by RLS; no role is trusted locally.
  const { data, error } = localSession ? await client.auth.getSession() : await client.auth.getUser();
  const user = localSession ? data?.session?.user : data?.user;
  if (error || !user || user.is_anonymous) return { ok: false, reason: 'signin' };
  const result = await client.from('app_members')
    .select('user_id, display_name, role, is_active, permissions').eq('user_id', user.id).maybeSingle();
  if (result.error) return { ok: false, reason: 'unavailable' };
  const member = result.data;
  if (!member?.is_active || !['admin', 'viewer', 'assistant'].includes(member.role)) {
    return { ok: false, reason: 'access' };
  }
  return { ok: true, user, member };
}

