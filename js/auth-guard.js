import { supabase } from './supabaseRaw.js';
import { checkAccess, safeNext } from './auth-core.js';

let initialCheck;
let rechecking = false;

function leave(reason) {
  document.documentElement.setAttribute('data-auth-pending', '');
  const login = new URL('login.html', location.href);
  login.searchParams.set('next', safeNext(location.href, location.href));
  login.searchParams.set('reason', reason);
  location.replace(login.href);
}

export function requireAccess() {
  if (!initialCheck) initialCheck = (async () => {
    let access;
    try { access = await checkAccess(supabase); }
    catch { access = { ok: false, reason: 'unavailable' }; }
    if (!access.ok) {
      leave(access.reason);
      throw new Error('Access denied'); // Stop every importing page module.
    }
    document.documentElement.removeAttribute('data-auth-pending');
    return access;
  })();
  return initialCheck;
}

async function recheck() {
  if (rechecking || document.hidden) return;
  rechecking = true;
  try {
    const access = await checkAccess(supabase);
    if (!access.ok) leave(access.reason);
  } catch { leave('unavailable'); }
  finally { rechecking = false; }
}

supabase.auth.onAuthStateChange((event) => {
  // Never await another Auth method while the SDK's auth lock is held.
  if (event === 'SIGNED_OUT') leave('signin');
  else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') setTimeout(recheck, 0);
});
window.addEventListener('focus', recheck);
window.addEventListener('pageshow', event => { if (event.persisted) recheck(); });
document.addEventListener('visibilitychange', recheck);
