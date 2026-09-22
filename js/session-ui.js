import {applyPermissionUI} from './permission-ui.js?v=1';
import "./image-viewer.js?v=1";
import "./image-cache.js?v=224-1";
import { supabase } from './supabaseClient.js?v=permissions-1';
import { requireAccess } from './auth-guard.js?v=permissions-1';
import { buildHeader } from './site-header.js?v=permissions-1';

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

applyPermissionUI(access.member);
