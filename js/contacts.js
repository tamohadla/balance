import { supabase } from './supabaseClient.js';
import { readAllRows } from './core/pagination.js';
import { contactColumns, parseContacts } from './contact-workbook.js';
import { normalizeMatchToken } from './core/text-utils.js';

const kind = document.body.dataset.contactType;
const table = supabase.from('business_contacts');
const columns = contactColumns[kind];
const fields = columns.map(([field]) => field);
const categoryLabels = { regular: 'عملاء', vip: 'كبار عملاء' };
const categoryFilter = document.getElementById('contactCategory');
const form = document.getElementById('contactForm');
const editDialog = document.getElementById('contactEdit');
const editForm = document.getElementById('contactEditForm');
const editStatus = document.getElementById('editStatus');
const importDialog = document.getElementById('contactImport');
const fileInput = document.getElementById('contactFile');
const importStatus = document.getElementById('importStatus');
const preview = document.getElementById('importPreview');
const confirmImport = document.getElementById('confirmContactImport');
document
  .getElementById('contactEditFields')
  .append(...form.querySelector('.grid').cloneNode(true).children);
const search = document.getElementById('contactSearch');
const rows = document.getElementById('contactRows');
const reload = document.getElementById('reloadContacts');
const saveStatus = document.getElementById('saveStatus');
const listStatus = document.getElementById('listStatus');
const save = form.querySelector('button[type="submit"]');

let contacts = [];
let editing = null;
let saving = false;
let importRows = [];
let fileVersion = 0;

function message(element, text, error = false) {
  element.textContent = text;
  element.toggleAttribute('data-error', error);
}

function openEdit(contact) {
  if (saving) return;
  editing = contact.id;
  for (const field of fields) editForm.elements.namedItem(field).value = contact[field] ?? '';
  message(editStatus, '');
  editDialog.showModal();
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
    edit.addEventListener('click', () => openEdit(contact));
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

async function saveContact(event) {
  event.preventDefault();
  if (saving || reload.disabled) return;
  const activeForm = event.currentTarget;
  const isEdit = activeForm === editForm;
  const status = isEdit ? editStatus : saveStatus;
  const values = Object.fromEntries(
    fields.map((field) => [field, activeForm.elements.namedItem(field).value.trim()]),
  );
  if (!values.name) {
    message(status, 'أدخل الاسم أولًا.', true);
    activeForm.elements.namedItem('name').focus();
    return;
  }

  saving = true;
  const controls = [...activeForm.elements];
  for (const control of controls) control.disabled = true;
  message(status, 'جارٍ الحفظ…');
  try {
    const query = isEdit
      ? table.update(values).eq('id', editing).eq('kind', kind)
      : table.insert({ ...values, kind });
    const { error } = await query.select('id').single();
    if (error) throw error;
    activeForm.reset();
    if (isEdit) editDialog.close();
    message(saveStatus, 'تم الحفظ.');
    await loadContacts();
  } catch {
    message(status, 'تعذر الحفظ. تحقق من الاتصال والصلاحية ثم أعد المحاولة.', true);
  } finally {
    saving = false;
    for (const control of controls) control.disabled = false;
    save.disabled = false;
  }
}

form.addEventListener('submit', saveContact);
editForm.addEventListener('submit', saveContact);
document.getElementById('closeContactEdit').addEventListener('click', () => editDialog.close());

for (const dialog of [editDialog, importDialog]) {
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
}

document.getElementById('openContactImport').addEventListener('click', () => {
  if (saving) return;
  importDialog.showModal();
});
document.getElementById('closeContactImport').addEventListener('click', () => {
  if (!saving) importDialog.close();
});
importDialog.addEventListener('close', () => {
  fileVersion++;
  fileInput.value = '';
  importRows = [];
  confirmImport.disabled = true;
  message(importStatus, '');
  preview.replaceChildren();
});

document.getElementById('downloadContactTemplate').addEventListener('click', () => {
  const xlsx = globalThis.XLSX;
  if (!xlsx) {
    message(importStatus, 'تعذر تحميل أداة Excel. أعد تحميل الصفحة.', true);
    return;
  }
  const book = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([columns.map(([, [label]]) => label)]);
  xlsx.utils.book_append_sheet(book, sheet, 'Data');
  xlsx.writeFile(book, `${kind}-template.xlsx`);
});

fileInput.addEventListener('change', async () => {
  const version = ++fileVersion;
  const file = fileInput.files[0];
  importRows = [];
  confirmImport.disabled = true;
  preview.replaceChildren();
  message(importStatus, '');
  if (!file) return;

  try {
    if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 5 * 1024 * 1024)
      throw new Error('اختر ملف Excel بحجم لا يتجاوز 5 ميغابايت.');
    const xlsx = globalThis.XLSX;
    if (!xlsx) throw new Error('تعذر تحميل أداة Excel. أعد تحميل الصفحة.');
    const bytes = await file.arrayBuffer();
    if (version !== fileVersion) return;
    const book = xlsx.read(bytes, { type: 'array', sheetRows: 1002 });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error('الملف لا يحتوي على ورقة بيانات.');
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    if (data.length > 1001) throw new Error('الحد الأقصى 1000 صف بيانات في الملف.');
    const { entries, errors } = parseContacts(data, kind);
    if (errors.length) throw new Error(errors.slice(0, 8).join(' | '));
    if (!entries.length) throw new Error('لا توجد سجلات للاستيراد.');

    const grid = document.createElement('table');
    const header = grid.createTHead().insertRow();
    for (const [, [label]] of columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      header.append(cell);
    }
    const body = grid.createTBody();
    for (const entry of entries.slice(0, 10)) {
      const row = body.insertRow();
      for (const field of fields) {
        row.insertCell().textContent =
          field === 'customer_category' ? categoryLabels[entry[field]] : entry[field];
      }
    }
    preview.append(grid);
    importRows = entries;
    confirmImport.disabled = false;
    message(
      importStatus,
      `جاهز للاستيراد: ${entries.length} سجل. المعاينة تعرض أول ${Math.min(entries.length, 10)}.`,
    );
  } catch (error) {
    if (version === fileVersion) message(importStatus, error.message || 'تعذر قراءة الملف.', true);
  }
});

confirmImport.addEventListener('click', async () => {
  if (saving || !importRows.length) return;
  saving = true;
  confirmImport.disabled = fileInput.disabled = true;
  try {
    const { error } = await table.insert(importRows);
    if (error) throw error;
    message(saveStatus, `تم استيراد ${importRows.length} سجل.`);
    importDialog.close();
    await loadContacts();
  } catch {
    message(importStatus, 'تعذر تأكيد الاستيراد. حدّث السجل للتحقق قبل إعادة المحاولة.', true);
  } finally {
    saving = false;
    fileInput.disabled = false;
    form.querySelector('button[type="submit"]').disabled = false;
  }
});

function updateFilters() {
  if (!reload.disabled && !listStatus.hasAttribute('data-error')) render();
}
search.addEventListener('input', updateFilters);
categoryFilter?.addEventListener('change', updateFilters);
reload.addEventListener('click', loadContacts);
await loadContacts();
