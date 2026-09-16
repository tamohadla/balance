import { supabase } from './supabaseRaw.js';
import { checkAccess, safeNext } from './auth-core.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
const passwordMode = params.get('mode') === 'password' || ['recovery', 'invite'].includes(fragment.get('type'));
const next = safeNext(params.get('next'), location.href);
let busy = false;
function message(text, error = false) {
  $('authMessage').textContent = text;
  $('authMessage').toggleAttribute('data-error', error);
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('form button').forEach(button => { button.disabled = value; });
}
function showPasswordForm() {
  $('loginForm').hidden = true;
  $('passwordForm').hidden = false;
  $('authTitle').textContent = 'تعيين كلمة المرور';
  $('authIntro').textContent = 'اختر كلمة مرور من 12 حرفًا على الأقل.';
}
async function enter() {
  const access = await checkAccess(supabase);
  if (access.ok) { localStorage.removeItem('sales_prefill_from_order'); location.replace(next); return; }
  message(access.reason === 'access'
    ? 'الحساب غير مفعّل للوصول إلى النظام. تواصل مع مسؤول النظام.'
    : 'تعذر التحقق من صلاحية الدخول. تحقق من الاتصال وأعد المحاولة.', true);
  await supabase.auth.signOut({ scope: 'local' });
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true); message('جارٍ تسجيل الدخول...');
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    $('password').value = '';
    if (error) { message('تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور أو حاول لاحقًا.', true); return; }
    await enter();
  } catch { message('تعذر الاتصال. حاول مرة أخرى.', true); }
  finally { setBusy(false); }
});
$('forgotPassword').addEventListener('click', async () => {
  if (busy) return;
  if (!$('email').reportValidity()) return;
  setBusy(true);
  try {
    const redirect = new URL('login.html', location.href);
    redirect.searchParams.set('mode', 'password');
    const { error } = await supabase.auth.resetPasswordForEmail($('email').value.trim(), { redirectTo: redirect.href });
    if (error) throw error;
    message('إذا كان البريد مسجلًا، فستصلك رسالة لإعادة تعيين كلمة المرور.');
  } catch { message('تعذر إرسال الطلب الآن. حاول لاحقًا أو تواصل مع المسؤول.', true); }
  finally { setBusy(false); }
});
$('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const password = $('newPassword').value;
  if (password.length < 12 || password !== $('confirmPassword').value) {
    message('تأكد من تطابق كلمتي المرور وأن الطول 12 حرفًا على الأقل.', true); return;
  }
  setBusy(true);
  try {
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data?.user) { message('الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.', true); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { message('تعذر حفظ كلمة المرور. استخدم كلمة أقوى أو اطلب رابطًا جديدًا.', true); return; }
    $('newPassword').value = ''; $('confirmPassword').value = '';
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) throw signOutError;
    history.replaceState({}, '', new URL('login.html', location.href));
    $('passwordForm').hidden = true; $('loginForm').hidden = false;
    $('authTitle').textContent = 'تسجيل الدخول';
    $('authIntro').textContent = 'أدخل بيانات حسابك للوصول إلى المخزون.';
    message('تم حفظ كلمة المرور. يمكنك تسجيل الدخول الآن.');
  } catch { message('تعذر إكمال العملية. تحقق من الاتصال ثم حاول تسجيل الدخول.', true); }
  finally { setBusy(false); }
});

supabase.auth.onAuthStateChange(event => {
  if (event === 'PASSWORD_RECOVERY') showPasswordForm();
});
if (passwordMode) showPasswordForm();
else if (params.get('reason') === 'access') message('الحساب غير مفعّل. تواصل مع مسؤول النظام.', true);
else if (params.get('reason') === 'unavailable') message('تعذر التحقق من الوصول. أعد المحاولة بعد التأكد من الاتصال.', true);
if (fragment.has('error') || params.has('error')) message('الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.', true);
