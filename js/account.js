import {ROLE_LABELS} from './permissions.js?v=1';
import { supabase } from './supabaseClient.js?v=permissions-1';
import { requireAccess } from './auth-guard.js?v=permissions-1';
const access = await requireAccess();
const $ = id => document.getElementById(id);
$('accountName').textContent = access.member.display_name || 'حساب المستخدم';
$('accountEmail').textContent = access.user.email;
$('accountRole').textContent = ROLE_LABELS[access.member.role];
let busy = false;
$('changePasswordForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const message = (text, error = false) => { $('passwordMessage').textContent = text; $('passwordMessage').toggleAttribute('data-error', error); };
  const password = $('newPassword').value;
  if (password.length < 12 || password !== $('confirmPassword').value) { message('كلمتا المرور غير متطابقتين أو أقل من 12 حرفًا.', true); return; }
  if (password === $('currentPassword').value) { message('اختر كلمة مرور مختلفة عن الحالية.', true); return; }
  busy = true; const button = event.submitter; button.disabled = true;
  try {
    // Reauthentication validates the current password even when the project setting is off.
    const { error: authError } = await supabase.auth.signInWithPassword({ email: access.user.email, password: $('currentPassword').value });
    if (authError) { message('تعذر التحقق من كلمة المرور الحالية. أعد المحاولة.', true); return; }
    const { error } = await supabase.auth.updateUser({ password, current_password: $('currentPassword').value });
    if (error) { message('تعذر تغيير كلمة المرور. استخدم كلمة أقوى أو حاول لاحقًا.', true); return; }
    $('changePasswordForm').reset();
    message('تم حفظ كلمة المرور. جارٍ تسجيل الخروج…');
    const { error: logoutError } = await supabase.auth.signOut({ scope: 'global' });
    if (logoutError) { message('تم تغيير كلمة المرور، لكن تعذر إنهاء الجلسات. استخدم تسجيل الخروج.', true); return; }
    location.replace('login.html');
  } catch { message('تعذر الاتصال. أعد المحاولة.', true); }
  finally { $('currentPassword').value = ''; busy = false; button.disabled = false; }
});
