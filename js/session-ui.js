import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';

const access = await requireAccess();
const bar = document.createElement('aside');
bar.className = 'session-bar';
bar.setAttribute('aria-label', 'الحساب');
const label = document.createElement('span');
label.textContent = `${access.member.display_name || access.user.email || 'حسابي'} — ${access.member.role === 'admin' ? 'أدمن' : 'عرض فقط'}`;
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
    label.textContent = 'تعذر تسجيل الخروج. تحقق من الاتصال وأعد المحاولة.';
    logout.disabled = false;
  }
});
bar.append(label, logout);
document.body.prepend(bar);
