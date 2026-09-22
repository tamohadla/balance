import {canAccessPage,homePage} from './permissions.js?v=1';
import { supabase } from './supabaseRaw.js';
import { checkAccess, safeNext } from './auth-core.js?v=permissions-1';
import { createCheckLimiter } from './check-limiter.js';

let initialCheck;
function connectionUnavailable() {
  document.documentElement.setAttribute('data-auth-pending', '');
  const gate = document.getElementById('authGate');
  if (!gate) return;
  gate.replaceChildren(document.createTextNode('تعذر التحقق بسبب مشكلة في الاتصال. لم تُحذف جلسة دخولك. '));
  const retry = document.createElement('button');
  retry.type = 'button'; retry.textContent = 'إعادة المحاولة';
  retry.addEventListener('click', () => { retry.disabled = true; location.reload(); });
  gate.append(retry);
}

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
    try { access = await checkAccess(supabase, { localSession: true }); }
    catch { access = { ok: false, reason: 'unavailable' }; }
    if (!access.ok) {
      if (access.reason === 'unavailable') connectionUnavailable();
      else leave(access.reason);
      throw new Error('Access denied'); // Stop every importing page module.
    }
    if(!canAccessPage(access.member,location.pathname.split('/').pop()||'index.html')){location.replace(new URL(homePage(access.member),location.href).href);throw new Error('Page access denied');}
    document.documentElement.removeAttribute('data-auth-pending');
    limiter.markChecked();
    return access;
  })();
  return initialCheck;
}

const limiter = createCheckLimiter(async () => {
  try {
    const access = await checkAccess(supabase, { localSession: true });
    if (!access.ok) {
      if (access.reason === 'unavailable') connectionUnavailable();
      else leave(access.reason);
    } else if(!canAccessPage(access.member,location.pathname.split('/').pop()||'index.html')){location.replace(new URL(homePage(access.member),location.href).href);}
    else {if(JSON.stringify((await initialCheck).member)!==JSON.stringify(access.member)){location.reload();return;}document.documentElement.removeAttribute('data-auth-pending');}
  } catch { connectionUnavailable(); }
});
async function recheck() {
  if (document.hidden || navigator.onLine === false) return;
  // Never start a second check while initial module authorization is pending.
  if (!initialCheck) return;
  try { await initialCheck; } catch { return; }
  await limiter.run();
}

supabase.auth.onAuthStateChange((event) => {
  // Never await another Auth method while the SDK's auth lock is held.
  if (event === 'SIGNED_OUT') leave('signin');
  else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') setTimeout(recheck, 0);
});
window.addEventListener('focus', recheck);
window.addEventListener('pageshow', event => { if (event.persisted) recheck(); });
document.addEventListener('visibilitychange', recheck);

