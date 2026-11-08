import { supabase } from './supabaseClient.js';
import { $, setMsg, explainSupabaseError } from './shared.js';
import { allRows } from './stock-entries.js';
import {
  bulkPreviewRows,
  itemKey,
  parseBulkLines,
  renderBulkPreview,
  sheetRowsToBulkText,
} from './import-review/bulkItems.js';

const bulkModal = $('bulkModal'),
  bulkTbody = $('bulkTbody'),
  bulkMsg = $('bulkMsg');
const bulkText = $('bulkText'),
  bulkFile = $('bulkFile'),
  btnApply = $('bulkApply');
const previewButton = $('bulkPreview');
let busy = false;

async function fetchExistingKeys(candidates) {
  const names = [...new Set(candidates.map((item) => item.item_name))];
  const result = new Set();
  for (let offset = 0; offset < names.length; offset += 100) {
    const chunk = names.slice(offset, offset + 100);
    const rows = await allRows(() =>
      supabase.from('items').select('id,item_name,color_code').in('item_name', chunk).order('id'),
    );
    for (const row of rows) result.add(itemKey(row));
  }
  return result;
}

function setBusy(value) {
  busy = value;
  for (const id of ['bulkApply', 'bulkPreview', 'bulkClear', 'bulkClose', 'bulkText', 'bulkFile'])
    $(id).disabled = value;
}

async function handlePreview() {
  if (busy) return;
  setBusy(true);
  btnApply.style.display = 'none';
  try {
    setMsg(bulkMsg, 'جارٍ فحص البيانات ومطابقتها…');
    const parsed = parseBulkLines(bulkText.value);
    const candidates = parsed.filter((row) => row.ok).map((row) => row.data);
    const existing = await fetchExistingKeys(candidates);
    renderBulkPreview(bulkTbody, bulkPreviewRows(parsed, existing));
    const count = candidates.filter((item) => !existing.has(itemKey(item))).length;
    btnApply.style.display = count ? 'inline-block' : 'none';
    setMsg(
      bulkMsg,
      count ? `فحص مكتمل: ${count} صنف جديد جاهز للحفظ.` : 'لا توجد بيانات جديدة صالحة للحفظ.',
      count > 0,
    );
  } catch (error) {
    bulkTbody.replaceChildren();
    setMsg(bulkMsg, `تعذر التحقق من البيانات. ${explainSupabaseError(error)}`, false);
  } finally {
    setBusy(false);
  }
}

async function handleApply() {
  if (busy) return;
  setBusy(true);
  try {
    const parsed = parseBulkLines(bulkText.value);
    const candidates = parsed.filter((row) => row.ok).map((row) => row.data);
    const existing = await fetchExistingKeys(candidates);
    const rows = candidates.filter((item) => !existing.has(itemKey(item)));
    if (!rows.length) return setMsg(bulkMsg, 'لا توجد بيانات جديدة صالحة للحفظ.', false);
    setMsg(bulkMsg, `جارٍ حفظ ${rows.length} صنف…`);
    const { error } = await supabase.from('items').insert(rows);
    if (error) throw error;
    setMsg(bulkMsg, 'تم حفظ البيانات بنجاح. جارٍ تحديث الصفحة…');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    setMsg(bulkMsg, explainSupabaseError(error), false);
  } finally {
    setBusy(false);
  }
}

bulkFile.addEventListener('change', async () => {
  const file = bulkFile.files?.[0];
  if (!file || busy) return;
  setBusy(true);
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('حجم ملف Excel يتجاوز 20 ميغابايت.');
    const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const first = workbook.Sheets[workbook.SheetNames[0]];
    if (!first) throw new Error('الملف لا يحتوي على ورقة بيانات.');
    const rows = globalThis.XLSX.utils.sheet_to_json(first, { header: 1 });
    bulkText.value = sheetRowsToBulkText(rows);
    btnApply.style.display = 'none';
    bulkTbody.replaceChildren();
    setMsg(bulkMsg, 'تمت قراءة الملف. اضغط فحص ومعاينة.');
  } catch (error) {
    setMsg(bulkMsg, error.message || 'تعذرت قراءة ملف Excel.', false);
  } finally {
    setBusy(false);
  }
});

bulkText.addEventListener('input', () => {
  btnApply.style.display = 'none';
});
previewButton.addEventListener('click', handlePreview);
btnApply.addEventListener('click', handleApply);
$('bulkClear').addEventListener('click', () => {
  bulkText.value = '';
  bulkFile.value = '';
  bulkTbody.replaceChildren();
  btnApply.style.display = 'none';
  setMsg(bulkMsg, '');
});
$('bulkClose').addEventListener('click', () => {
  if (!busy) bulkModal.style.display = 'none';
});
