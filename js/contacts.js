import { supabase } from './supabaseClient.js';
import { readAllRows } from './core/pagination.js';
import { normalizeMatchToken } from './core/text-utils.js';

const kind = document.body.dataset.contactType;
const table = supabase.from('business_contacts');
const fields =
  kind === 'customers'
    ? ['name', 'brand_name', 'phone', 'address', 'customer_category']
    : ['name', 'phone', 'address', 'notes'];
const categoryLabels = { regular: 'عملاء', vip: 'كبار عملاء' };
const categoryFilter = document.getElementById('contactCategory');
const form = document.getElementById('contactForm');
const heading = document.getElementById('contactHeading');
const search = document.getElementById('contactSearch');
const rows = document.getElementById('contactRows');
const reload = document.getElementById('reloadContacts');
const cancel = document.getElementById('cancelEdit');
const saveStatus = document.getElementById('saveStatus');
const listStatus = document.getElementById('listStatus');
const save = form.querySelector('button[type="submit"]');
const nameInput = form.elements.namedItem('name');

let contacts = [];
let editing = null;
let saving = false;

function message(element, text, error = false) {
  element.textContent = text;
  element.toggleAttribute('data-error', error);
}

function setEditing(contact) {
  editing = contact?.id ?? null;
  form.reset();
  if (contact) {
    for (const field of fields) form.elements.namedItem(field).value = contact[field] ?? '';
  }
  cancel.hidden = !contact;
  heading.textContent = contact ? heading.dataset.edit : heading.dataset.add;
}

function render() {
  const token = normalizeMatchToken(search.value);
  const category = categoryFilter?.value;
  const visible = contacts.filter(
    (contact) =>
      (!category || contact.customer_category === category) &&
      [contact.name, contact.brand_name, contact.phone].some((value) =>
        normalizeMatchToken(value).includes(token),
      ),
  );
  rows.replaceChildren();
  for (const contact of visible) {
    const row = rows.insertRow();
    for (const field of fields) {
      const cell = row.insertCell();
      const value = document.createElement('bdi');
      if (field === 'phone') value.dir = 'ltr';
      value.textContent =
        (field === 'customer_category' ? categoryLabels[contact[field]] : contact[field]) || '—';
      cell.append(value);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = 'تعديل';
    edit.setAttribute('aria-label', `تعديل ${contact.name}`);
    edit.addEventListener('click', () => {
      if (saving) return;
      setEditing(contact);
      message(saveStatus, '');
      nameInput.focus();
    });
    row.insertCell().append(edit);
  }
  message(
    listStatus,
    visible.length ? `عدد السجلات المعروضة: ${visible.length}` : 'لا توجد نتائج.',
  );
}

async function loadContacts() {
  if (reload.disabled) return;
  reload.disabled = true;
  save.disabled = true;
  message(listStatus, 'جارٍ تحميل السجل…');
  try {
    contacts = await readAllRows(() =>
      table
        .select(['id', ...fields].join(','))
        .eq('kind', kind)
        .order('name')
        .order('id'),
    );
    render();
  } catch {
    message(listStatus, 'تعذر تحميل السجل. اضغط تحديث لإعادة المحاولة.', true);
  } finally {
    reload.disabled = false;
    save.disabled = saving;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || reload.disabled) return;
  const values = Object.fromEntries(
    fields.map((field) => [field, form.elements.namedItem(field).value.trim()]),
  );
  if (!values.name) {
    message(saveStatus, 'أدخل الاسم أولًا.', true);
    nameInput.focus();
    return;
  }

  saving = true;
  save.disabled = cancel.disabled = reload.disabled = true;
  for (const field of fields) form.elements.namedItem(field).disabled = true;
  message(saveStatus, 'جارٍ الحفظ…');
  try {
    const query = editing
      ? table.update(values).eq('id', editing).eq('kind', kind)
      : table.insert({ ...values, kind });
    const { error } = await query.select('id').single();
    if (error) throw error;
    setEditing(null);
    message(saveStatus, 'تم الحفظ.');
    reload.disabled = false;
    await loadContacts();
  } catch {
    message(saveStatus, 'تعذر الحفظ. تحقق من الاتصال والصلاحية ثم أعد المحاولة.', true);
  } finally {
    saving = false;
    save.disabled = cancel.disabled = reload.disabled = false;
    for (const field of fields) form.elements.namedItem(field).disabled = false;
  }
});

cancel.addEventListener('click', () => {
  setEditing(null);
  message(saveStatus, '');
  nameInput.focus();
});
function updateFilters() {
  if (!reload.disabled && !listStatus.hasAttribute('data-error')) render();
}
search.addEventListener('input', updateFilters);
categoryFilter?.addEventListener('change', updateFilters);
reload.addEventListener('click', loadContacts);
await loadContacts();
