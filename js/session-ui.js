import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
import { buildHeader } from './site-header.js?v=3';

const access = await requireAccess();
const logout = document.createElement('button');
logout.type = 'button';
logout.className = 'secondary';
logout.textContent = 'تسجيل الخروج';
logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    localStorage.removeItem('sales_prefill_from_order');
    location.replace(new URL('login.html', location.href).href);
  } catch {
    errorMessage.textContent = 'تعذر تسجيل الخروج. تحقق من الاتصال وأعد المحاولة.';
    logout.disabled = false;
  }
});
const errorMessage = buildHeader(access, logout);
