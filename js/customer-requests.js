import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
import { readAllRows } from './core/pagination.js';
import { normalizeMatchToken } from './core/text-utils.js';

const { user } = await requireAccess();
const byId = (id) => document.getElementById(id);
const entry = byId('customerRequestForm');
const review = byId('reviewRequestForm');
const dialog = byId('reviewRequest');
const list = byId('requestList');
const listStatus = byId('requestListStatus');
const fields = ['name', 'brand_name', 'phone', 'address'];
const labels = {
  pending: 'بانتظار المراجعة',
  approved: 'معتمد',
  linked: 'مرتبط بزبون موجود',
  returned: 'معاد للتصحيح',
};
let busy = false;
let activeRequest;
let linkedId;
let customers = [];

function button(text, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'secondary';
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

function formValues(form, names) {
  return Object.fromEntries(
    names.map((name) => [name, form.elements.namedItem(name).value.trim()]),
  );
}

function fill(form, record, names) {
  for (const name of names) form.elements.namedItem(name).value = record[name] ?? '';
}

async function refresh() {
  listStatus.textContent = 'جارٍ تحميل الطلبات…';
  try {
    const requests = await readAllRows(() => {
      const query = supabase.from('customer_requests').select('*');
      return (entry ? query.eq('requested_by', user.id) : query.eq('status', 'pending'))
        .order('created_at', { ascending: false })
        .order('id');
    });
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const title of [
      'اسم الزبون',
      'المصنع أو البراند',
      'التاريخ',
      'الحالة',
      'ملاحظة المراجعة',
      'الإجراء',
    ]) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = title;
      header.append(cell);
    }
    const body = table.createTBody();
    for (const request of requests) {
      const row = body.insertRow();
      for (const value of [
        request.name,
        request.brand_name,
        new Date(request.created_at).toLocaleDateString('ar-EG'),
        labels[request.status],
        request.review_note,
      ])
        row.insertCell().textContent = value || '—';
      const actions = row.insertCell();
      if (review) actions.append(button('مراجعة', () => openReview(request)));
      if (entry && request.status === 'returned') {
        actions.append(
          button('نسخ للتصحيح', () => {
            fill(entry, request, fields);
            entry.elements.namedItem('name').focus();
          }),
        );
      }
    }
    list.replaceChildren(...(requests.length ? [table] : []));
    listStatus.textContent = requests.length ? '' : 'لا توجد طلبات.';
  } catch {
    listStatus.textContent = 'تعذر تحميل الطلبات. حاول تحديث الصفحة.';
  }
}

entry?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const submit = entry.querySelector('[type="submit"]');
  submit.disabled = true;
  const status = byId('requestStatus');
  try {
    const { error } = await supabase.from('customer_requests').insert(formValues(entry, fields));
    if (error) throw error;
    entry.reset();
    status.textContent = 'تم إرسال الطلب للمراجعة.';
    await refresh();
  } catch {
    status.textContent = 'تعذر إرسال الطلب.';
  } finally {
    busy = false;
    submit.disabled = false;
  }
});

function renderMatches() {
  linkedId = undefined;
  byId('linkCustomer').disabled = true;
  const term = normalizeMatchToken(byId('matchCustomer').value);
  const matches = customers
    .filter((customer) => {
      if (term)
        return fields
          .slice(0, 3)
          .some((field) => normalizeMatchToken(customer[field]).includes(term));
      return fields.slice(0, 3).some((field) => {
        const value = normalizeMatchToken(activeRequest[field]);
        return value && value === normalizeMatchToken(customer[field]);
      });
    })
    .slice(0, 12);
  const results = byId('customerMatches');
  results.replaceChildren();
  for (const customer of matches) {
    const label = document.createElement('label');
    const option = document.createElement('input');
    option.type = 'radio';
    option.name = 'existing_customer';
    option.addEventListener('change', () => {
      linkedId = customer.id;
      byId('linkCustomer').disabled = false;
    });
    label.append(
      option,
      [customer.name, customer.brand_name, customer.phone].filter(Boolean).join(' · '),
    );
    results.append(label);
  }
}

async function openReview(request) {
  if (busy || dialog.open) return;
  busy = true;
  activeRequest = request;
  review.reset();
  fill(review, { ...request, customer_category: 'regular' }, [...fields, 'customer_category']);
  customers = [];
  renderMatches();
  byId('reviewStatus').textContent = 'جارٍ البحث عن زبائن مطابقين…';
  dialog.showModal();
  try {
    customers = await readAllRows(() =>
      supabase
        .from('business_contacts')
        .select('id,name,brand_name,phone')
        .eq('kind', 'customers')
        .order('name')
        .order('id'),
    );
    renderMatches();
    byId('reviewStatus').textContent = '';
  } catch {
    byId('reviewStatus').textContent = 'تعذر جلب الزبائن للمطابقة. أغلق النافذة وحاول مجددًا.';
  } finally {
    busy = false;
  }
}

async function decide(decision) {
  if (busy || !activeRequest || (decision === 'linked' && !linkedId)) return;
  const status = byId('reviewStatus');
  const note = review.elements.namedItem('review_note').value.trim();
  if (decision === 'returned' && !note) {
    status.textContent = 'اكتب سبب الإرجاع.';
    return;
  }
  busy = true;
  try {
    const { error } = await supabase.rpc('review_customer_request', {
      request_id: activeRequest.id,
      decision,
      linked_id: linkedId ?? null,
      details: formValues(review, [...fields, 'customer_category']),
      note,
    });
    if (error) throw error;
    dialog.close();
    if (decision === 'approved') byId('reloadContacts').click();
    await refresh();
    listStatus.textContent = labels[decision];
  } catch {
    status.textContent = 'تعذر حفظ القرار. قد يكون الطلب قد روجع بالفعل.';
  } finally {
    busy = false;
  }
}

if (review) {
  byId('reviewFields').append(
    ...byId('contactForm').querySelector('.grid').cloneNode(true).children,
  );
  byId('refreshRequests').addEventListener('click', refresh);
  byId('matchCustomer').addEventListener('input', renderMatches);
  byId('linkCustomer').addEventListener('click', () => decide('linked'));
  byId('returnRequest').addEventListener('click', () => decide('returned'));
  byId('closeReview').addEventListener('click', () => {
    if (!busy) dialog.close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  review.addEventListener('submit', (event) => {
    event.preventDefault();
    decide('approved');
  });
}
await refresh();
