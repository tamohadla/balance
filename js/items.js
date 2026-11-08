import { openImageViewer } from './image-viewer.js';
import { saveImagePair, removeImagePair } from './item-image-store.js';
import { refreshSiteImages } from './image-cache.js';
import { allRows as readAllRows } from './stock-entries.js';
import { supabase } from './supabaseClient.js';
import {
  $,
  cleanText,
  setMsg,
  getPublicImageUrl,
  getThumbnailImageUrl,
  keysLookUnchanged,
  testSupabaseConnection,
  explainSupabaseError,
} from './shared.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

import {
  ITEM_FIELDS,
  distinctValues,
  filterItems,
  itemPayload,
  itemExportRows,
} from './items/model.js';
import { datalistOptions, categoryOptions, itemRowsHtml } from './items/view.js';
import { createItemsService } from './items/service.js';
import { createItemEditor } from './items/editor.js';

const itemsService = createItemsService(supabase, readAllRows);

/**
 * صفحة المواد (Items)
 * - المجموعات (main_category/sub_category) تنظيمية ويمكن تغييرها لاحقاً.
 * - هوية المادة لمنع التكرار: (item_name + color_code).
 */

const msg = $('msg');
const tbody = $('itemsTbody');
const mainList = $('mainList');
const subList = $('subList');
const nameList = $('nameList');

const searchEl = $('search');
const quickFiltersBar = $('quickFiltersBar');
const quickMainCategoryEl = $('quickMainCategory');
const quickSubCategoryEl = $('quickSubCategory');
const quickImageInputEl = $('quickImageInput');
const itemEditor = createItemEditor({
  getElement: $,
  save: itemsService.save,
  onSaved(data, id) {
    const index = ALL_ITEMS.findIndex((row) => String(row.id) === String(id));
    if (index >= 0) ALL_ITEMS[index] = { ...ALL_ITEMS[index], ...data };
    buildDatalists(ALL_ITEMS);
    buildQuickFilterOptions(ALL_ITEMS);
    render();
    setMsg(msg, '✅ تم تحديث المادة بنجاح.', true);
  },
  onError: (error) => setMsg(msg, explainSupabaseError(error), false),
});

if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
  setMsg(msg, 'مفاتيح Supabase غير مُعدلة. راجع js/supabaseClient.js', false);
}

let ALL_ITEMS = [];
let lastLoadedAt = 0;
// Reuse cached images on normal visits; bust only after an explicit image refresh.
let imageCacheSeed = 0;
let pendingImageItemId = null;
let copyingItem = false;
const itemImageVersions = new Map();
let focusedItemId = new URL(location.href).searchParams.get('item') || '';
let focusScrollPending = !!focusedItemId;
const quickFilters = {
  status: focusedItemId
    ? 'all'
    : ['active', 'inactive', 'all'].includes(new URL(location.href).searchParams.get('status'))
      ? new URL(location.href).searchParams.get('status')
      : 'active',
  mainCategory: '',
  subCategory: '',
};

function buildDatalists(items) {
  mainList.innerHTML = datalistOptions(distinctValues(items, 'main_category'));
  subList.innerHTML = datalistOptions(distinctValues(items, 'sub_category'));
  nameList.innerHTML = datalistOptions(distinctValues(items, 'item_name'));
}

function readItemForm(prefix = '') {
  return itemPayload(
    Object.fromEntries(ITEM_FIELDS.map((field) => [field, $(prefix + field).value])),
  );
}

function getItemImageUrl(row) {
  const rowVersion = itemImageVersions.get(String(row.id));
  return getPublicImageUrl(row.image_path, rowVersion || imageCacheSeed);
}

function markItemImageUpdated(itemId) {
  itemImageVersions.set(String(itemId), Date.now());
}

function refreshAllImagesFromCache() {
  refreshSiteImages();
  imageCacheSeed = Date.now();
  render();
}

function buildQuickFilterOptions(items) {
  if (!quickMainCategoryEl || !quickSubCategoryEl) return;
  quickMainCategoryEl.innerHTML = categoryOptions(
    distinctValues(items || [], 'main_category', { clean: true }),
    'فلترة حسب المجموعة الرئيسية',
  );
  quickMainCategoryEl.value = quickFilters.mainCategory;
  syncQuickSubCategoryOptions();
}

function syncQuickSubCategoryOptions() {
  if (!quickSubCategoryEl) return;
  const validSubs = distinctValues(ALL_ITEMS, 'sub_category', {
    mainCategory: quickFilters.mainCategory,
    clean: true,
  });
  const previous = cleanText(quickFilters.subCategory || '');
  quickSubCategoryEl.innerHTML = categoryOptions(validSubs, 'فلترة حسب المجموعة الفرعية');

  if (previous && !validSubs.includes(previous)) {
    quickFilters.subCategory = '';
  }
  quickSubCategoryEl.value = quickFilters.subCategory;
}

function applyQuickStatusButtons() {
  if (!quickFiltersBar) return;
  quickFiltersBar.querySelectorAll('[data-quick-status]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quickStatus === quickFilters.status);
  });
}

function render() {
  const rows = filterItems(ALL_ITEMS, {
    ...quickFilters,
    query: searchEl?.value || '',
    focusedItemId,
  });
  tbody.innerHTML = itemRowsHtml(rows, {
    fullImageUrl: getItemImageUrl,
    thumbnailUrl: (row) => getThumbnailImageUrl(row.image_path, imageCacheSeed),
  });

  if (focusScrollPending && rows.length) {
    tbody.closest('table')?.scrollIntoView({ block: 'start' });
    focusScrollPending = false;
  }
  setMsg(
    msg,
    focusedItemId
      ? rows.length
        ? 'عرض المادة المحددة — اضغط «الكل» لعرض جميع المواد.'
        : 'المادة غير موجودة أو لا تطابق الفلاتر — اضغط «الكل» لعرض جميع المواد.'
      : `تم عرض ${rows.length} مادة`,
    true,
  );
}

function exportAllItemsToExcel() {
  if (typeof XLSX === 'undefined') {
    setMsg(msg, 'تعذر إنشاء ملف Excel حالياً (مكتبة XLSX غير متاحة).', false);
    return;
  }

  const rows = itemExportRows(ALL_ITEMS);

  if (!rows.length) {
    setMsg(msg, 'لا توجد مواد للتنزيل حالياً.', false);
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'المواد');

  const now = new Date();
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(workbook, `items-${datePart}.xlsx`);
  setMsg(msg, `✅ تم تنزيل ملف Excel بعدد ${rows.length} مادة.`, true);
}

async function refreshFromDb(force = false) {
  const now = Date.now();
  // Avoid hammering refresh on fast typing; allow explicit reload
  if (!force && ALL_ITEMS.length && now - lastLoadedAt < 10_000) {
    render();
    return;
  }

  setMsg(msg, '⏳ جارٍ تحديث القائمة...', true);

  let data;
  try {
    data = await itemsService.list();
  } catch (error) {
    setMsg(msg, explainSupabaseError(error), false);
    return;
  }
  ALL_ITEMS = data || [];
  lastLoadedAt = Date.now();
  buildDatalists(ALL_ITEMS);
  buildQuickFilterOptions(ALL_ITEMS);
  render();
}

// --- الصور ---
async function uploadOrReplaceImage(itemId, existingPath, file) {
  const chosenFile = file || $('image_file')?.files?.[0];
  if (!chosenFile) return null;
  const { path, cleanupError } = await saveImagePair(supabase, itemId, existingPath, chosenFile);
  if (cleanupError)
    alert('تم حفظ الصورتين، لكن تعذر تنظيف النسخ القديمة من التخزين. ' + cleanupError.message);
  return path;
}

// --- حفظ/تعديل ---
$('itemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg(msg, 'جارٍ الحفظ...', true);

  const payload = readItemForm();

  try {
    const id = $('editId').value;

    // The database unique constraint remains the authority for concurrent saves.
    if (!id && (await itemsService.exists(payload))) {
      setMsg(msg, '⚠️ هذه المادة موجودة مسبقاً (نفس اسم المادة + رقم اللون).', false);
      return;
    }
    const savedItem = await itemsService.save(payload, id);

    const imgPath = await uploadOrReplaceImage(savedItem.id, savedItem.image_path);
    if (imgPath && savedItem.image_path !== imgPath) {
      markItemImageUpdated(savedItem.id);
    }

    if (copyingItem) {
      focusedItemId = String(savedItem.id);
      quickFilters.status = 'all';
      quickFilters.mainCategory = '';
      quickFilters.subCategory = '';
      searchEl.value = '';
      const url = new URL(location.href);
      url.searchParams.set('item', focusedItemId);
      url.searchParams.set('status', 'all');
      history.replaceState(null, '', url);
      copyingItem = false;
      applyQuickStatusButtons();
    }
    $('itemForm').reset();
    $('editId').value = '';
    setMsg(msg, '✅ تم حفظ المادة بنجاح', true);
    await refreshFromDb(true);
  } catch (err) {
    setMsg(msg, explainSupabaseError(err), false);
  }
});

// --- أحداث الجدول ---
tbody.addEventListener('click', async (e) => {
  // فتح الصورة كبيرة عند الضغط عليها
  const imgEl = e.target.closest('img.thumb');
  if (imgEl && imgEl.dataset.full) {
    openImageViewer(imgEl.dataset.full);
    return;
  }

  const btn = e.target.closest('button');
  if (!btn) return;

  const { act, id, val } = btn.dataset;

  try {
    if (act === 'copy-color') {
      const item = ALL_ITEMS.find((r) => String(r.id) === String(id));
      if (!item) return;
      $('itemForm').reset();
      $('editId').value = '';
      copyingItem = true;
      for (const key of ['main_category', 'sub_category', 'item_name', 'unit_type', 'description'])
        $(key).value = item[key] || '';
      $('color_code').value = '';
      $('color_name').value = '';
      $('image_file').value = '';
      $('itemForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
      $('color_code').focus({ preventScroll: true });
      setMsg(msg, 'أدخل رقم اللون الجديد واسمه وصورته ثم احفظ.', true);
      return;
    }
    if (act === 'edit') {
      const item = (ALL_ITEMS || []).find((r) => String(r.id) === String(id));
      if (item) itemEditor.open(item);
      else {
        itemEditor.open(await itemsService.get(id));
      }
      return;
    }

    if (act === 'change-image') {
      pendingImageItemId = id;
      quickImageInputEl.value = '';
      quickImageInputEl.click();
      return;
    }

    if (act === 'toggle') {
      const next = val === 'false'; // val is current is_active
      await itemsService.setActive(id, next);
      await refreshFromDb(true);
      return;
    }

    if (act === 'delete') {
      if (!confirm('⚠️ هل أنت متأكد من حذف هذه المادة نهائياً؟')) return;
      setMsg(msg, 'جارٍ الحذف...', true);

      // نقرأ مسار الصورة أولاً (لأن الحذف قد يفشل بسبب الحركات)
      const row = await itemsService.get(id, 'image_path');
      try {
        await itemsService.remove(id);
      } catch {
        setMsg(
          msg,
          'لا يمكن الحذف: المادة مرتبطة بحركات مخزنية (يفضل إيقافها بدلاً من حذفها)',
          false,
        );
        return;
      }
      {
        // حذف الصورة من Storage (بدون ترك مخلفات)
        if (row?.image_path) {
          try {
            await removeImagePair(supabase, row.image_path);
          } catch (ex) {
            await refreshFromDb(true);
            setMsg(msg, 'حُذفت المادة، لكن تعذر حذف ملفات صورها: ' + ex.message, false);
            return;
          }
        }
        setMsg(msg, 'تم حذف المادة بنجاح', true);
        await refreshFromDb(true);
      }
      return;
    }
  } catch (ex) {
    setMsg(msg, explainSupabaseError(ex), false);
  }
});

// --- تحكم ---
$('btnReload').onclick = () => refreshFromDb(true);
$('btnExportExcel').onclick = exportAllItemsToExcel;
$('btnRefreshImages').onclick = () => {
  try {
    refreshAllImagesFromCache();
    setMsg(msg, 'تم طلب أحدث الصور لكل صفحات الموقع وتبويباته في هذا المتصفح.', true);
  } catch {
    setMsg(
      msg,
      'تعذر حفظ تحديث الصور المشترك. اسمح بتخزين بيانات الموقع في المتصفح ثم أعد المحاولة.',
      false,
    );
  }
};
$('btnCancel').onclick = () => {
  copyingItem = false;
  $('itemForm').reset();
  $('editId').value = '';
  setMsg(msg, '', true);
};

if ($('btnBulk')) {
  $('btnBulk').onclick = () => {
    $('bulkModal').style.display = 'flex';
  };
}

let tSearch = null;
if (searchEl) {
  searchEl.addEventListener('input', () => {
    clearTimeout(tSearch);
    tSearch = setTimeout(() => render(), 120);
  });
}

if (quickFiltersBar) {
  quickFiltersBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick-status]');
    if (!btn) return;
    const { quickStatus } = btn.dataset;
    if (quickStatus === 'all') {
      focusedItemId = '';
      focusScrollPending = false;
      const url = new URL(location.href);
      url.searchParams.delete('item');
      history.replaceState(null, '', url);
      quickFilters.status = 'all';
      quickFilters.mainCategory = '';
      quickFilters.subCategory = '';
      if (quickMainCategoryEl) quickMainCategoryEl.value = '';
      syncQuickSubCategoryOptions();
    } else {
      quickFilters.status = quickStatus;
    }
    applyQuickStatusButtons();
    render();
  });
}

if (quickMainCategoryEl) {
  quickMainCategoryEl.addEventListener('change', () => {
    quickFilters.mainCategory = quickMainCategoryEl.value;
    quickFilters.subCategory = '';
    syncQuickSubCategoryOptions();
    render();
  });
}
if (quickSubCategoryEl) {
  quickSubCategoryEl.addEventListener('change', () => {
    quickFilters.subCategory = quickSubCategoryEl.value;
    render();
  });
}

if (quickImageInputEl) {
  quickImageInputEl.addEventListener('change', async () => {
    const file = quickImageInputEl.files?.[0];
    const itemId = pendingImageItemId;
    pendingImageItemId = null;
    quickImageInputEl.value = '';
    if (!file || !itemId) return;

    try {
      setMsg(msg, 'جارٍ تحديث الصورة...', true);
      const item = (ALL_ITEMS || []).find((r) => String(r.id) === String(itemId));
      if (!item) throw new Error('تعذر العثور على المادة.');

      const imgPath = await uploadOrReplaceImage(itemId, item.image_path, file);
      if (imgPath && item.image_path !== imgPath) {
        item.image_path = imgPath;
      }
      markItemImageUpdated(itemId);
      render();
      setMsg(msg, '✅ تم تحديث صورة المادة بنجاح.', true);
    } catch (ex) {
      setMsg(msg, explainSupabaseError(ex), false);
    }
  });
}

// start
(async () => {
  if (await testSupabaseConnection(msg)) {
    applyQuickStatusButtons();
    await refreshFromDb(true);
  }
})();
