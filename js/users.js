import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
const access = await requireAccess();
const $ = id => document.getElementById(id);
if (access.member.role !== 'admin') { location.replace('account.html'); throw new Error('Admin required'); }
$('adminContent').hidden = false;
const errors = {
  ADMIN_REQUIRED: 'هذه العملية للأدمن المفعّل فقط.', SIGN_IN_REQUIRED: 'انتهت الجلسة. أعد تسجيل الدخول.',
  LAST_ADMIN: 'لا يمكن تعطيل آخر أدمن أو تغيير صلاحيته. فعّل أدمن آخر أولًا.',
  INVALID_MEMBER: 'تحقق من بيانات الحساب.', INVITE_FAILED: 'تعذر إرسال الدعوة. قد يكون البريد مسجلًا أو إعداد إرسال البريد غير جاهز أو تم تجاوز حد الإرسال.',
  INVITED_NOT_ACTIVATED: 'أُرسلت الدعوة لكن تعذر تفعيل الحساب. حدّث القائمة ثم عدّل الحساب لتفعيله.',
  RESET_FAILED: 'تعذر إرسال رابط كلمة المرور. تحقق من إعداد البريد أو حاول لاحقًا.',
  USER_NOT_FOUND: 'الحساب غير موجود.'
};
let page = 1, historyPage = 1, editing = null, busy = false;
let hasMoreUsers = false, hasMoreEvents = false;
const names = new Map();
const date = value => value ? new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }) : 'لم يدخل بعد';
function message(text, error = false, id = 'pageMessage') { $(id).textContent = text; $(id).toggleAttribute('data-error', error); }
async function api(body) {
  const { data, error } = await supabase.functions.invoke('manage-accounts', { body });
  if (error) {
    let code; try { code = (await error.context.json()).error; } catch { /* network or non-JSON gateway error */ }
    throw new Error(errors[code] || 'تعذر تنفيذ العملية. تحقق من الاتصال ثم حاول مرة أخرى.');
  }
  return data;
}
function cell(row, text, cls) { const td = row.insertCell(); td.textContent = text; if (cls) td.className = cls; return td; }
async function loadUsers() {
  const data = await api({ action: 'list', page });
  $('rolloutNotice').hidden = data.enforced;
  $('rolloutNotice').textContent = 'صفحات الحسابات جاهزة للمراجعة. حماية بيانات المخزون بالصلاحيات لم تُفعّل بعد على الموقع المنشور؛ يجب إكمال تفعيل الحماية قبل بدء استخدام حسابات الفريق.';
  $('usersBody').replaceChildren();
  for (const user of data.users) {
    names.set(user.id, user.email || user.id);
    const row = document.createElement('tr');
    cell(row, user.member?.display_name || '—'); cell(row, user.email, 'email');
    cell(row, user.member?.role === 'admin' ? 'أدمن' : 'عرض فقط');
    cell(row, !user.member?.is_active ? 'معطّل' : user.confirmed ? 'مفعّل' : 'بانتظار قبول الدعوة');
    cell(row, date(user.last_sign_in_at));
    const actions = cell(row, '');
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'تعديل'; edit.setAttribute('aria-label', `تعديل ${user.email}`);
    edit.addEventListener('click', () => {
      editing = user; $('editEmail').textContent = user.email; $('editName').value = user.member?.display_name || '';
      $('editRole').value = user.member?.role || 'viewer'; $('editActive').checked = Boolean(user.member?.is_active);
      message('', false, 'editMessage'); $('editDialog').showModal();
    });
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'رابط كلمة المرور'; reset.setAttribute('aria-label', `إرسال رابط كلمة المرور إلى ${user.email}`);
    reset.addEventListener('click', () => run(async () => {
      if (!confirm(`إرسال رابط إعادة تعيين كلمة المرور إلى ${user.email}؟`)) return;
      const result = await api({ action: 'reset', id: user.id });
      message(result.warning ? 'أُرسل طلب الرابط، لكن تعذر تسجيل العملية في السجل.' : 'أُرسل طلب رابط إعادة تعيين كلمة المرور.');
      await loadHistory();
    }));
    actions.append(edit, ' ', reset); $('usersBody').append(row);
  }
  if (!data.users.length) { const row = $('usersBody').insertRow(); const td = cell(row, 'لا توجد حسابات في هذه الصفحة.'); td.colSpan = 6; }
  $('pageLabel').textContent = `صفحة ${page}`; $('count').textContent = `${data.users.length} حساب في هذه الصفحة`;
  $('previous').disabled = page <= 1; $('next').disabled = !data.hasMore;
  hasMoreUsers = data.hasMore;
}
async function loadHistory() {
  const data = await api({ action: 'history', page: historyPage });
  $('historyBody').replaceChildren();
  for (const item of data.events) {
    const row = $('historyBody').insertRow(); cell(row, date(item.created_at)); cell(row, names.get(item.actor_id) || item.actor_id); cell(row, names.get(item.target_id) || item.target_id);
    const after = item.details?.after;
    cell(row, item.action === 'member_saved' ? `حفظ الحساب — ${after?.role === 'admin' ? 'أدمن' : 'عرض فقط'} — ${after?.is_active ? 'مفعّل' : 'معطّل'}` : 'طلب إعادة تعيين كلمة المرور');
  }
  if (!data.events.length) { const row = $('historyBody').insertRow(); const td = cell(row, 'لا توجد عمليات مسجلة بعد.'); td.colSpan = 4; }
  $('historyPageLabel').textContent = `صفحة ${historyPage}`;
  $('historyPrevious').disabled = historyPage <= 1; $('historyNext').disabled = !data.hasMore;
  hasMoreEvents = data.hasMore;
}
async function run(action, id = 'pageMessage') {
  if (busy) return; busy = true;
  const buttons = [...document.querySelectorAll('button')].map(b => [b, b.disabled]);
  buttons.forEach(([b]) => { b.disabled = true; }); message('جارٍ تنفيذ الطلب…', false, id);
  try { await action(); } catch (e) { message(e.message, true, id); }
  finally {
    busy = false; buttons.forEach(([b, disabled]) => { if (b.isConnected) b.disabled = disabled; });
    $('previous').disabled = page <= 1; $('next').disabled = !hasMoreUsers;
    $('historyPrevious').disabled = historyPage <= 1; $('historyNext').disabled = !hasMoreEvents;
  }
}
$('inviteForm').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  if ($('inviteRole').value === 'admin' && !confirm('سيحصل هذا الحساب على إدارة كاملة للنظام والحسابات. متابعة؟')) { message('أُلغي الطلب.'); return; }
  await api({ action: 'invite', name: $('inviteName').value.trim(), email: $('inviteEmail').value.trim(), role: $('inviteRole').value });
  $('inviteForm').reset(); page = 1; await loadUsers(); await loadHistory(); message('تم إنشاء الحساب وإرسال الدعوة.');
}); });
$('editForm').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await api({ action: 'save', id: editing.id, name: $('editName').value.trim(), role: $('editRole').value, active: $('editActive').checked });
  $('editDialog').close(); await loadUsers(); await loadHistory(); message('تم حفظ الحساب والصلاحيات.');
  if (editing.id === access.user.id) location.reload();
}, 'editMessage'); });
$('cancelEdit').addEventListener('click', () => { if (!busy) $('editDialog').close(); });
$('editDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('refresh').addEventListener('click', () => run(async () => { await loadUsers(); await loadHistory(); message('تم تحديث القائمة.'); }));
for (const [id, delta, history] of [['previous',-1,false],['next',1,false],['historyPrevious',-1,true],['historyNext',1,true]]) {
  $(id).addEventListener('click', () => run(async () => {
    if (history) { historyPage += delta; try { await loadHistory(); } catch(e) { historyPage -= delta; throw e; } }
    else { page += delta; try { await loadUsers(); } catch(e) { page -= delta; throw e; } }
    message('');
  }));
}
await run(async () => { await loadUsers(); await loadHistory(); message(''); });
