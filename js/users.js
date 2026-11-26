import { SECTIONS, ROLE_LABELS } from './permissions.js';
import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
const access = await requireAccess();
const $ = (id) => document.getElementById(id);
if (access.member.role !== 'admin') {
  location.replace('account.html');
  throw new Error('Admin required');
}
$('adminContent').hidden = false;
const errors = {
  ADMIN_REQUIRED: 'هذه العملية للأدمن المفعّل فقط.',
  SIGN_IN_REQUIRED: 'انتهت الجلسة. أعد تسجيل الدخول.',
  LAST_ADMIN: 'لا يمكن تعطيل آخر أدمن أو تغيير صلاحيته. فعّل أدمن آخر أولًا.',
  INVALID_MEMBER: 'تحقق من بيانات الحساب.',
  INVITE_FAILED:
    'تعذر إرسال الدعوة. قد يكون البريد مسجلًا أو إعداد إرسال البريد غير جاهز أو تم تجاوز حد الإرسال.',
  INVITED_NOT_ACTIVATED:
    'أُرسلت الدعوة لكن تعذر تفعيل الحساب. حدّث القائمة ثم عدّل الحساب لتفعيله.',
  RESET_FAILED: 'تعذر إرسال رابط كلمة المرور. تحقق من إعداد البريد أو حاول لاحقًا.',
  USER_NOT_FOUND: 'الحساب غير موجود.',
};
let page = 1,
  historyPage = 1,
  editing = null,
  busy = false;
let hasMoreUsers = false,
  hasMoreEvents = false;
const names = new Map();
const date = (value) =>
  value
    ? new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })
    : 'لم يدخل بعد';
function message(text, error = false, id = 'pageMessage') {
  $(id).textContent = text;
  $(id).toggleAttribute('data-error', error);
}
async function api(body) {
  const { data, error } = await supabase.functions.invoke('manage-accounts', { body });
  if (error) {
    let code;
    try {
      code = (await error.context.json()).error;
    } catch {
      /* network or non-JSON gateway error */
    }
    throw new Error(errors[code] || 'تعذر تنفيذ العملية. تحقق من الاتصال ثم حاول مرة أخرى.');
  }
  return data;
}
function cell(row, text, cls) {
  const td = row.insertCell();
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}
let activityRequest = 0;
const activityEntities = {
  items: 'مادة',
  stock_moves: 'بند حركة مخزون',
  customer_orders: 'طلب',
  customer_order_lines: 'بند طلب',
  recon_sessions: 'تسوية',
  stock_entry_groups: 'فاتورة',
};
const activityActions = { create: 'إضافة', insert: 'إضافة', update: 'تعديل', delete: 'حذف' };
async function showActivity(user) {
  const request = ++activityRequest;
  const list = $('activityList');
  list.replaceChildren();
  $('activityName').textContent = user.member?.display_name || user.email;
  $('activityStatus').textContent = 'جارٍ تحميل السجل…';
  $('activityDialog').showModal();
  try {
    const recent = (table, fields, actor) =>
      supabase
        .from(table)
        .select(fields)
        .eq(actor, user.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(12);
    const [audit, invoices, orders] = await Promise.all([
      recent('operation_events', 'id,created_at,action,entity,before_data,after_data', 'actor_id'),
      recent('stock_entry_groups', 'id,created_at,type', 'created_by'),
      recent('customer_orders', 'id,created_at,customer_name', 'created_by'),
    ]);
    if (request !== activityRequest) return;
    if ([audit, invoices, orders].some((result) => result.error)) throw new Error();
    const itemIds = [
      ...new Set(
        audit.data.map((e) => e.after_data?.item_id || e.before_data?.item_id).filter(Boolean),
      ),
    ];
    const itemNames = new Map();
    if (itemIds.length) {
      const { data, error } = await supabase
        .from('items')
        .select('id,item_name,color_name')
        .in('id', itemIds);
      if (request !== activityRequest) return;
      if (error) throw error;
      for (const item of data)
        itemNames.set(item.id, [item.item_name, item.color_name].filter(Boolean).join(' · '));
    }
    const entries = audit.data.map((event) => {
      const before = event.before_data || {};
      const after = event.after_data || {};
      const item =
        after.item_name ||
        before.item_name ||
        after.customer_name ||
        before.customer_name ||
        itemNames.get(after.item_id || before.item_id);
      const change = event.entity === 'items' && event.action === 'update';
      let detail = item;
      if (change && before.item_name && after.item_name && before.item_name !== after.item_name)
        detail = [before.item_name, after.item_name].join(' ← ');
      else if (change && before.image_path !== after.image_path)
        detail = [item, 'تغيير الصورة'].filter(Boolean).join(' · ');
      return {
        time: event.created_at,
        label: [
          activityActions[event.action] || event.action,
          activityEntities[event.entity] || event.entity,
          detail,
          after.color_name || before.color_name,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    });
    for (const entry of invoices.data)
      entries.push({
        time: entry.created_at,
        label: entry.type === 'sale' ? 'إضافة فاتورة مبيعات' : 'إضافة فاتورة مشتريات',
      });
    for (const order of orders.data)
      entries.push({ time: order.created_at, label: 'إنشاء طلب · ' + (order.customer_name || '') });
    if (user.last_sign_in_at) entries.push({ time: user.last_sign_in_at, label: 'آخر تسجيل دخول' });
    entries.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    for (const entry of entries.slice(0, 12)) {
      const li = document.createElement('li');
      li.textContent =
        new Date(entry.time).toLocaleString('ar-EG', {
          timeZone: 'Africa/Cairo',
          dateStyle: 'medium',
          timeStyle: 'short',
        }) +
        ' — ' +
        entry.label;
      list.append(li);
    }
    $('activityStatus').textContent = entries.length ? '' : 'لا توجد عمليات مسجّلة لهذا الحساب.';
  } catch {
    if (request === activityRequest)
      $('activityStatus').textContent = 'تعذّر تحميل السجل. أغلق النافذة وحاول مجددًا.';
  }
}
async function loadUsers() {
  const data = await api({ action: 'list', page });
  $('rolloutNotice').hidden = data.enforced;
  $('rolloutNotice').textContent =
    'صفحات الحسابات جاهزة للمراجعة. حماية بيانات المخزون بالصلاحيات لم تُفعّل بعد على الموقع المنشور؛ يجب إكمال تفعيل الحماية قبل بدء استخدام حسابات الفريق.';
  $('usersBody').replaceChildren();
  for (const user of data.users) {
    names.set(user.id, user.email || user.id);
    const row = document.createElement('tr');
    cell(row, user.member?.display_name || '—');
    cell(row, user.email, 'email');
    cell(row, ROLE_LABELS[user.member?.role] || 'غير معتمد');
    cell(row, !user.member?.is_active ? 'معطّل' : user.confirmed ? 'مفعّل' : 'بانتظار قبول الدعوة');
    cell(row, date(user.last_sign_in_at));
    const actions = cell(row, '');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'الحساب والصلاحيات';
    edit.setAttribute('aria-label', `تعديل ${user.email}`);
    edit.addEventListener('click', () => {
      editing = user;
      $('editEmail').textContent = user.email;
      $('editName').value = user.member?.display_name || '';
      $('editRole').value = user.member?.role || 'viewer';
      $('editActive').checked = Boolean(user.member?.is_active);
      renderPermissions('edit', user.member?.permissions || {});
      message('', false, 'editMessage');
      $('editDialog').showModal();
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'رابط كلمة المرور';
    reset.setAttribute('aria-label', `إرسال رابط كلمة المرور إلى ${user.email}`);
    reset.addEventListener('click', () =>
      run(async () => {
        if (!confirm(`إرسال رابط إعادة تعيين كلمة المرور إلى ${user.email}؟`)) return;
        const result = await api({ action: 'reset', id: user.id });
        message(
          result.warning
            ? 'أُرسل طلب الرابط، لكن تعذر تسجيل العملية في السجل.'
            : 'أُرسل طلب رابط إعادة تعيين كلمة المرور.',
        );
        await loadHistory();
      }),
    );
    const activity = document.createElement('button');
    activity.type = 'button';
    activity.textContent = 'سجل العمليات';
    activity.onclick = () => showActivity(user);
    actions.append(edit, ' ', reset, ' ', activity);
    $('usersBody').append(row);
  }
  if (!data.users.length) {
    const row = $('usersBody').insertRow();
    const td = cell(row, 'لا توجد حسابات في هذه الصفحة.');
    td.colSpan = 6;
  }
  $('pageLabel').textContent = `صفحة ${page}`;
  $('count').textContent = `${data.users.length} حساب في هذه الصفحة`;
  $('previous').disabled = page <= 1;
  $('next').disabled = !data.hasMore;
  hasMoreUsers = data.hasMore;
}
async function loadHistory() {
  const data = await api({ action: 'history', page: historyPage });
  $('historyBody').replaceChildren();
  for (const item of data.events) {
    const row = $('historyBody').insertRow();
    cell(row, date(item.created_at));
    cell(row, names.get(item.actor_id) || item.actor_id);
    cell(row, names.get(item.target_id) || item.target_id);
    const after = item.details?.after;
    cell(
      row,
      item.action === 'member_saved'
        ? `حفظ الحساب — ${ROLE_LABELS[after?.role] || 'غير معتمد'} — ${after?.is_active ? 'مفعّل' : 'معطّل'}`
        : 'طلب إعادة تعيين كلمة المرور',
    );
  }
  if (!data.events.length) {
    const row = $('historyBody').insertRow();
    const td = cell(row, 'لا توجد عمليات مسجلة بعد.');
    td.colSpan = 4;
  }
  $('historyPageLabel').textContent = `صفحة ${historyPage}`;
  $('historyPrevious').disabled = historyPage <= 1;
  $('historyNext').disabled = !data.hasMore;
  hasMoreEvents = data.hasMore;
}
async function run(action, id = 'pageMessage') {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('button')].map((b) => [b, b.disabled]);
  buttons.forEach(([b]) => {
    b.disabled = true;
  });
  message('جارٍ تنفيذ الطلب…', false, id);
  try {
    await action();
  } catch (e) {
    message(e.message, true, id);
  } finally {
    busy = false;
    buttons.forEach(([b, disabled]) => {
      if (b.isConnected) b.disabled = disabled;
    });
    $('previous').disabled = page <= 1;
    $('next').disabled = !hasMoreUsers;
    $('historyPrevious').disabled = historyPage <= 1;
    $('historyNext').disabled = !hasMoreEvents;
  }
}
$('inviteForm').addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    if (
      $('inviteRole').value === 'admin' &&
      !confirm('سيحصل هذا الحساب على إدارة كاملة للنظام والحسابات. متابعة؟')
    ) {
      message('أُلغي الطلب.');
      return;
    }
    await api({
      action: 'invite',
      name: $('inviteName').value.trim(),
      email: $('inviteEmail').value.trim(),
      role: $('inviteRole').value,
      permissions: readPermissions('invite'),
    });
    $('inviteForm').reset();
    renderPermissions('invite');
    page = 1;
    await loadUsers();
    await loadHistory();
    message('تم إنشاء الحساب وإرسال الدعوة.');
  });
});
$('editForm').addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    await api({
      action: 'save',
      id: editing.id,
      name: $('editName').value.trim(),
      role: $('editRole').value,
      active: $('editActive').checked,
      permissions: readPermissions('edit'),
    });
    $('editDialog').close();
    await loadUsers();
    await loadHistory();
    message('تم حفظ الحساب والصلاحيات.');
    if (editing.id === access.user.id) location.reload();
  }, 'editMessage');
});
$('cancelEdit').addEventListener('click', () => {
  if (!busy) $('editDialog').close();
});
$('editDialog').addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});
$('refresh').addEventListener('click', () =>
  run(async () => {
    await loadUsers();
    await loadHistory();
    message('تم تحديث القائمة.');
  }),
);
for (const [id, delta, history] of [
  ['previous', -1, false],
  ['next', 1, false],
  ['historyPrevious', -1, true],
  ['historyNext', 1, true],
]) {
  $(id).addEventListener('click', () =>
    run(async () => {
      if (history) {
        historyPage += delta;
        try {
          await loadHistory();
        } catch (e) {
          historyPage -= delta;
          throw e;
        }
      } else {
        page += delta;
        try {
          await loadUsers();
        } catch (e) {
          page -= delta;
          throw e;
        }
      }
      message('');
    }),
  );
}

function renderPermissions(prefix, values = {}) {
  const panel = $(prefix + 'Permissions');
  panel.hidden = $(prefix + 'Role').value !== 'assistant';
  panel.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = 'صلاحيات الأقسام';
  panel.append(title);
  const help = document.createElement('p');
  help.className = 'hint';
  help.textContent =
    'القسم المغلق لا يظهر ولا يفتح بالرابط. عرض وإدارة يتيح الإضافة والتعديل والحذف داخل القسم. تنفيذ الطلبات يتطلب أيضًا إدارة المبيعات. إدارة المستخدمين للأدمن فقط.';
  panel.append(help);
  for (const [key, label] of SECTIONS) {
    const row = document.createElement('label');
    row.className = 'permission-row';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    select.dataset.section = key;
    select.setAttribute('aria-label', label);
    for (const [v, t] of [
      ['', 'مغلق'],
      ['read', 'عرض فقط'],
      ['manage', 'عرض وإدارة'],
    ]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      select.append(o);
    }
    select.value = values[key] || '';
    row.append(name, select);
    panel.append(row);
  }
}
function readPermissions(prefix) {
  return Object.fromEntries(
    [...$(prefix + 'Permissions').querySelectorAll('select')]
      .filter((s) => s.value)
      .map((s) => [s.dataset.section, s.value]),
  );
}
for (const prefix of ['invite', 'edit']) {
  $(prefix + 'Role').addEventListener('change', () =>
    renderPermissions(prefix, readPermissions(prefix)),
  );
  renderPermissions(prefix);
}

await run(async () => {
  await loadUsers();
  await loadHistory();
  message('');
});
