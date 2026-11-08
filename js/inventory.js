import { selectInventoryRows, categoryOptions, buildPreordersState } from './inventory/model.js';
import { createInventoryView } from './inventory/view.js';
import {
  restoreInventoryView,
  persistInventoryView,
  inventoryViewUrl,
} from './inventory/view-state.js';
import { createInventoryHistory } from './inventory/history-dialogs.js';
import { inventoryCsv } from './inventory/export.js';
import {
  createReconciliationClient,
  mountReconciliationRecovery,
  reconciliationError,
} from './reconciliation-service.js';
import { canManage } from './permissions.js';
import { openImageViewer } from './image-viewer.js';
import { readStock, readItemMoves } from './inventory-data.js';
import { STOCK_FILTERS } from './inventory-model.js';
import { requireAccess } from './auth-guard.js';
const access = await requireAccess();
const canWrite = canManage(access.member, 'inventory') || canManage(access.member, 'adjustments');
const isAdmin = !!access.member?.is_active && access.member.role === 'admin';
let itemStatusBusy = false;
const viewKey = 'inventory-view:' + access.user.id;
let viewStorage;
try {
  viewStorage = sessionStorage;
} catch {
  /* Storage is optional. */
}
const restoredView = restoreInventoryView(location.href, viewStorage, viewKey);
const initialUrl = restoredView.url;
if (initialUrl.search !== location.search) history.replaceState(null, '', initialUrl);
const initialParams = initialUrl.searchParams;
let restoreScroll = restoredView.scroll;
function saveView() {
  persistInventoryView(viewStorage, viewKey, location.search, window.scrollY);
}
window.addEventListener('pagehide', saveView);
let snapshot = null,
  visibleRows = [],
  loading = false,
  adjustBusy = false;
import { supabase } from './supabaseClient.js';
import {
  $,
  escapeHtml,
  setMsg,
  materialLabel,
  getPublicImageUrl,
  getThumbnailImageUrl,
  unitLabel,
  todayISO,
  keysLookUnchanged,
  explainSupabaseError,
} from './shared.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

let LOW_STOCK_ROLLS_THRESHOLD = Number(initialParams.get('threshold')) || 10;
LOW_STOCK_ROLLS_THRESHOLD = Math.min(100000, Math.max(1, LOW_STOCK_ROLLS_THRESHOLD));

const msg = $('msg');
const reconciliationClient = createReconciliationClient({
  userId: access.user.id,
  scope: 'single',
});
const refreshReconciliationRecovery = mountReconciliationRecovery(
  reconciliationClient,
  msg,
  loadData,
);
if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
  setMsg(
    msg,
    'مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.',
    false,
  );
}

const tbody = $('tbody');
const summaryEl = $('summary');
const lowStockThresholdLabel = $('lowStockThresholdLabel');
if (lowStockThresholdLabel) lowStockThresholdLabel.textContent = String(LOW_STOCK_ROLLS_THRESHOLD);

let allRows = [];
let quickFilter = STOCK_FILTERS.includes(initialParams.get('filter'))
  ? initialParams.get('filter')
  : 'all';
let preordersByItem = new Map();
let preorderDetailsByItem = new Map();

const view = createInventoryView({
  escapeHtml,
  materialLabel,
  unitLabel,
  getPublicImageUrl,
  getThumbnailImageUrl,
});
const historyDialogs = createInventoryHistory({
  getRows: () => allRows,
  getOrderDetails: () => preorderDetailsByItem,
  readItemMoves,
  $,
  view,
  materialLabel,
  onError: (error) => setMsg(msg, explainSupabaseError(error), false),
});

function buildFilterOptions() {
  const mainSel = $('filterMain'),
    subSel = $('filterSub');
  const selectedMain = mainSel.value.trim(),
    selectedSub = subSel.value.trim();
  const { mains } = categoryOptions(allRows);
  const options = (values) =>
    '<option value="">الكل</option>' +
    values
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join('');
  mainSel.innerHTML = options(mains);
  if (mains.includes(selectedMain)) mainSel.value = selectedMain;
  const { subs } = categoryOptions(allRows, mainSel.value);
  subSel.innerHTML = options(subs);
  subSel.value = subs.includes(selectedSub) ? selectedSub : '';
}

function currentFilters() {
  return {
    search: $('search').value,
    preset: $('preset').value,
    main: $('filterMain').value.trim(),
    sub: $('filterSub').value.trim(),
    scope: $('scope').value,
    unit: $('stockUnit').value,
    item: new URL(location.href).searchParams.get('item'),
    quickFilter,
    threshold: LOW_STOCK_ROLLS_THRESHOLD,
  };
}

function applyFiltersAndRender() {
  const filters = currentFilters();
  visibleRows = selectInventoryRows(allRows, filters, materialLabel);
  tbody.innerHTML = view.rowsHtml(visibleRows, {
    preordersByItem,
    canWrite,
    isAdmin,
    itemStatusBusy,
  });
  summaryEl.textContent = view.summaryText(visibleRows);
  $('inventoryMetrics').innerHTML = view.metricsHtml(visibleRows);
  $('inventoryEmpty').hidden = visibleRows.length > 0;
  history.replaceState(null, '', inventoryViewUrl(location.href, filters));
  saveView();
  setMsg(msg, `تم العرض: ${visibleRows.length} مادة`, true);
}

function syncQuickFilters() {
  const root = $('quickFilters');
  if (!root) return;
  root.querySelectorAll('button[data-qf]').forEach((btn) => {
    const isActive = btn.dataset.qf === quickFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function closeModal(id) {
  if (id === 'movesModal') historyDialogs.invalidateMoves();
  if (id === 'adjustModal' && adjustBusy) return;
  const el = $(id);
  if (el) el.style.display = 'none';
}

let adjustCurrentItem = null;

function openAdjustModal(itemId) {
  const row = allRows.find((r) => String(r.id) === String(itemId));
  if (!row || !canWrite || adjustBusy) return;
  adjustCurrentItem = row;

  $('adjustTitle').textContent = `تسوية المادة: ${materialLabel(row)}`;
  $('adjustDate').value = todayISO();
  $('adjustBookMain').value =
    `${Number(row.balance_main || 0).toFixed(3)} ${unitLabel(row.unit_type)}`;
  $('adjustBookRolls').value = String(parseInt(row.balance_rolls || 0, 10));
  $('adjustActualMain').value = '';
  $('adjustActualRolls').value = '';
  setMsg($('adjustMsg'), '', true);
  $('adjustModal').style.display = 'flex';
}

async function saveSingleItemAdjustment() {
  if (!adjustCurrentItem || !canWrite || adjustBusy) return;

  const currentItem = adjustCurrentItem;
  const reconDate = $('adjustDate').value;
  if (!reconDate) return setMsg($('adjustMsg'), 'اختر تاريخ التسوية', false);

  const actualMainRaw = $('adjustActualMain').value;
  const actualRollsRaw = $('adjustActualRolls').value;

  if (actualMainRaw === '' || actualRollsRaw === '') {
    return setMsg($('adjustMsg'), 'يجب إدخال الفعلي (رئيسية + أثواب) معاً لأي مادة', false);
  }

  const actualMain = Number(actualMainRaw);
  const actualRolls = Number(actualRollsRaw);
  if (!Number.isFinite(actualMain) || actualMain < 0 || actualRolls < 0)
    return setMsg($('adjustMsg'), 'أدخل كميات فعلية صحيحة وغير سالبة', false);
  if (!Number.isInteger(actualRolls))
    return setMsg($('adjustMsg'), 'الأثواب الفعلية يجب أن تكون عدد صحيح', false);

  const balMain = Number(adjustCurrentItem.balance_main || 0);
  const balRolls = Number(adjustCurrentItem.balance_rolls || 0);
  const diffMain = actualMain - balMain;
  const diffRolls = actualRolls - balRolls;

  if (diffMain === 0 && diffRolls === 0) {
    return setMsg($('adjustMsg'), 'لا يوجد فرق بين الرصيد والفعلي.', false);
  }

  adjustBusy = true;
  $('adjustSave').disabled = true;
  setMsg($('adjustMsg'), 'جارٍ اعتماد التسوية...', true);

  try {
    await reconciliationClient.save(reconDate, [
      {
        item_id: currentItem.id,
        book_main: balMain,
        book_rolls: balRolls,
        actual_main: actualMain,
        actual_rolls: actualRolls,
      },
    ]);
    setMsg($('adjustMsg'), 'تم اعتماد تسوية هذه المادة بنجاح.', true);
    await loadData();
    adjustBusy = false;
    closeModal('adjustModal');
  } catch (ex) {
    setMsg($('adjustMsg'), reconciliationError(ex), false);
  } finally {
    adjustBusy = false;
    $('adjustSave').disabled = false;
    refreshReconciliationRecovery();
  }
}

async function toggleItemStatus(itemId) {
  if (!isAdmin || loading || itemStatusBusy) return;
  const row = allRows.find((r) => String(r.id) === String(itemId));
  if (!row) return;
  const nextActive = !row.is_active;
  const actionLabel = nextActive ? 'تفعيل' : 'إيقاف';
  if (
    !confirm(
      `هل أنت متأكد من ${actionLabel} هذه المادة؟\n${materialLabel(row)}\nرقم اللون: ${row.color_code || '—'} — اسم اللون: ${row.color_name || '—'}`,
    )
  )
    return;
  itemStatusBusy = true;
  $('btnReload').disabled = true;
  tbody.querySelectorAll('[data-act="toggle-item-status"]').forEach((button) => {
    button.disabled = true;
  });
  setMsg(msg, `جارٍ ${actionLabel} المادة…`, true);
  try {
    const { data, error } = await supabase
      .from('items')
      .update({ is_active: nextActive })
      .eq('id', row.id)
      .select('id, is_active')
      .single();
    if (error) throw error;
    if (!data || data.is_active !== nextActive)
      throw new Error(`تعذر تأكيد ${actionLabel} المادة. حدّث الصفحة وحاول مجددًا.`);
    row.is_active = nextActive;
    for (const item of snapshot?.rows || []) {
      if (String(item.id) === String(row.id)) item.is_active = nextActive;
    }
    applyFiltersAndRender();
    setMsg(msg, `تم ${actionLabel} المادة بنجاح.`, true);
  } catch (ex) {
    setMsg(msg, explainSupabaseError(ex), false);
  } finally {
    itemStatusBusy = false;
    $('btnReload').disabled = false;
    tbody.querySelectorAll('[data-act="toggle-item-status"]').forEach((button) => {
      button.disabled = false;
    });
  }
}

async function loadData() {
  if (loading || itemStatusBusy) return;
  loading = true;
  $('btnReload').disabled = true;
  setMsg(msg, 'جارٍ تحديث الأرصدة والطلبات…');
  try {
    const next = await readStock();
    snapshot = next;
    ({ preordersByItem, preorderDetailsByItem } = buildPreordersState(next.lines));
    allRows = next.rows.map((r) => ({
      ...r,
      preorder_count: preordersByItem.get(r.id)?.count || 0,
    }));
    buildFilterOptions();
    if (initialViewPending) {
      $('filterMain').value = initialParams.get('main') || '';
      buildFilterOptions();
      $('filterSub').value = initialParams.get('sub') || '';
      initialViewPending = false;
    }
    syncQuickFilters();
    applyFiltersAndRender();
    $('lastStockUpdate').textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG');
  } catch (ex) {
    setMsg(msg, 'تعذر تحديث البيانات. ' + explainSupabaseError(ex), false);
  } finally {
    loading = false;
    $('btnReload').disabled = false;
  }
}
$('btnReload').addEventListener('click', loadData);
let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFiltersAndRender, 200);
});
$('preset').addEventListener('change', applyFiltersAndRender);
$('scope').addEventListener('change', applyFiltersAndRender);

$('filterMain').addEventListener('change', () => {
  buildFilterOptions();
  applyFiltersAndRender();
});
$('filterSub').addEventListener('change', applyFiltersAndRender);

$('quickFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-qf]');
  if (!btn) return;
  quickFilter = btn.dataset.qf || 'all';
  if (quickFilter === 'inactive_stock') $('scope').value = 'inactive';
  syncQuickFilters();
  applyFiltersAndRender();
});

$('btnClearFilters').addEventListener('click', () => {
  const u = new URL(location.href);
  u.searchParams.delete('item');
  history.replaceState(null, '', u);
  $('stockUnit').value = '';
  $('scope').value = 'active';
  $('preset').value = 'default';
  $('search').value = '';
  $('filterMain').value = '';
  buildFilterOptions();
  $('filterSub').value = '';
  quickFilter = 'all';
  syncQuickFilters();
  applyFiltersAndRender();
});

tbody.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('.mobile-menu-toggle');
  if (toggleBtn) {
    const wrap = toggleBtn.closest('.mobile-actions');
    if (!wrap) return;
    const menu = wrap.querySelector('.mobile-actions-menu');
    if (!menu) return;

    const isOpen = !menu.hasAttribute('hidden');
    tbody.querySelectorAll('.mobile-actions-menu').forEach((m) => m.setAttribute('hidden', ''));
    if (!isOpen) menu.removeAttribute('hidden');
    return;
  }

  const img = e.target.closest('img.thumb.zoomable');
  if (img) {
    openImageViewer(img.dataset.full || img.src, img.alt);
    return;
  }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const itemId = btn.getAttribute('data-id');
  if (!itemId) return;

  const act = btn.getAttribute('data-act');
  if (act === 'view-moves') historyDialogs.openMoves(itemId);
  else if (act === 'adjust-item') openAdjustModal(itemId);
  else if (act === 'toggle-item-status') void toggleItemStatus(itemId);
  else if (act === 'edit-item' && isAdmin)
    window.open(`./items.html?item=${encodeURIComponent(itemId)}&status=all`, '_blank', 'noopener');
  else if (act === 'view-orders') historyDialogs.openOrders(itemId);

  tbody.querySelectorAll('.mobile-actions-menu').forEach((m) => m.setAttribute('hidden', ''));
});

document.addEventListener('click', (e) => {
  if (e.target.closest('.mobile-actions')) return;
  tbody.querySelectorAll('.mobile-actions-menu').forEach((m) => m.setAttribute('hidden', ''));
});

$('imageModal').addEventListener('click', () => {
  $('imageModal').style.display = 'none';
  $('imageModalImg').src = '';
});

$('movesClose').addEventListener('click', () => closeModal('movesModal'));
$('ordersClose').addEventListener('click', () => closeModal('ordersModal'));
$('adjustClose').addEventListener('click', () => closeModal('adjustModal'));

$('movesModal').addEventListener('click', (e) => {
  if (e.target.id === 'movesModal') closeModal('movesModal');
});
$('ordersModal').addEventListener('click', (e) => {
  if (e.target.id === 'ordersModal') closeModal('ordersModal');
});
$('adjustModal').addEventListener('click', (e) => {
  if (e.target.id === 'adjustModal') closeModal('adjustModal');
});

$('adjustReset').addEventListener('click', () => {
  $('adjustActualMain').value = '';
  $('adjustActualRolls').value = '';
  setMsg($('adjustMsg'), '', true);
});

$('adjustSave').addEventListener('click', saveSingleItemAdjustment);

$('stockThreshold').value = LOW_STOCK_ROLLS_THRESHOLD;
$('stockThreshold').addEventListener('change', () => {
  LOW_STOCK_ROLLS_THRESHOLD = Math.min(
    100000,
    Math.max(1, Number($('stockThreshold').value) || 10),
  );
  $('stockThreshold').value = LOW_STOCK_ROLLS_THRESHOLD;
  lowStockThresholdLabel.textContent = LOW_STOCK_ROLLS_THRESHOLD;
  applyFiltersAndRender();
});
$('exportStock').onclick = () => {
  if (!snapshot) return;
  const blob = new Blob([inventoryCsv(visibleRows, unitLabel)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `ADLATEX_stock_${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !adjustBusy)
    ['movesModal', 'ordersModal', 'adjustModal', 'imageModal'].forEach(closeModal);
});
if (!canWrite) document.querySelectorAll('[data-stock-admin]').forEach((n) => (n.hidden = true));
if (['kg', 'm'].includes(initialParams.get('unit')))
  $('stockUnit').value = initialParams.get('unit');
$('stockUnit').onchange = applyFiltersAndRender;
if (['all', 'inactive'].includes(initialParams.get('scope')))
  $('scope').value = initialParams.get('scope');
let initialViewPending = true;
$('search').value = initialParams.get('search') || '';
if ([...$('preset').options].some((o) => o.value === initialParams.get('sort')))
  $('preset').value = initialParams.get('sort');
await loadData();
if (restoreScroll)
  requestAnimationFrame(() => {
    window.scrollTo(0, restoreScroll);
    restoreScroll = 0;
  });
