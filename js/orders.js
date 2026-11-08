import { exportElementToPng } from './ui/image-export.js';
import { mountOrderLineEditor } from './orders/line-editor.js';
import { createOrderService } from './orders/service.js';
import {
  orderCards,
  orderPreview,
  orderDetails,
  orderReference as reference,
  sortOrderLines,
} from './orders/views.js';
import { canManage } from './permissions.js';
import { openImageViewer } from './image-viewer.js';
import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
import { $, explainSupabaseError, getThumbnailImageUrl } from './shared.js';
import { statusOf, filterOrders, transferOrder, SALES_PREFILL_KEY } from './orders-model.js';

const access = await requireAccess();
const canWrite = canManage(access.member, 'orders');
const PAGE_SIZE = 12;
const dialog = $('orderDialog');
let orders = [],
  page = 1,
  activeStatus = 'all',
  loadVersion = 0,
  detailVersion = 0,
  renderVersion = 0;
let current = null,
  currentLines = [],
  currentItems = new Map(),
  action = null,
  busy = false,
  loaded = false;
const service = createOrderService(supabase);
const { itemCache, itemsByIds, fetchAllOrders, fetchLines, freshOrder, mutate } = service;
const number = new Intl.NumberFormat('en-US');
function message(text = '', error = false, target = 'msg') {
  const el = $(target);
  el.textContent = text;
  el.hidden = !text;
  el.dataset.error = String(error);
}
function friendly(error) {
  return error?.message && !error.code ? error.message : explainSupabaseError(error);
}
function params() {
  return {
    search: $('search').value,
    status: activeStatus,
    period: $('period').value,
    sort: $('sort').value,
  };
}
function filtered() {
  return filterOrders(orders, params());
}
function updateStats() {
  const counts = { all: orders.length, draft: 0, confirmed: 0, pending_sale: 0, executed: 0 };
  for (const o of orders) if (statusOf(o) in counts) counts[statusOf(o)]++;
  for (const [state, key] of [
    ['all', 'All'],
    ['draft', 'Draft'],
    ['confirmed', 'Confirmed'],
    ['pending_sale', 'PendingSale'],
    ['executed', 'Executed'],
  ]) {
    $('stat' + key).textContent = number.format(counts[state]);
    $('count' + key).textContent = number.format(counts[state]);
  }
}
function render() {
  const version = ++renderVersion;
  const rows = filtered(),
    pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, pages);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  $('resultCount').textContent = rows.length
    ? `عرض ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} من ${number.format(rows.length)} طلب`
    : 'لا توجد طلبات للعرض';
  $('pageInfo').textContent = `${page} / ${pages}`;
  $('prevPage').disabled = page <= 1;
  $('nextPage').disabled = page >= pages;
  const hasFilter =
    $('search').value.trim() || activeStatus !== 'all' || $('period').value !== 'all';
  $('resetFilters').hidden = !hasFilter;
  $('ordersGrid').innerHTML = orderCards(visible, itemCache, getThumbnailImageUrl);
  $('ordersGrid').setAttribute('aria-busy', 'false');
  $('emptyState').hidden = !!rows.length;
  $('emptyTitle').textContent = hasFilter ? 'لا توجد نتائج مطابقة' : 'لا توجد طلبات بعد';
  $('emptyText').textContent = hasFilter
    ? 'جرّب اسمًا آخر أو امسح الفلاتر لعرض كل الطلبات.'
    : 'ستظهر هنا الطلبات التي تحفظها من صفحة إنشاء الطلب.';
  $('emptyAction').textContent = hasFilter ? 'مسح الفلاتر' : 'طلب جديد';
  $('emptyAction').dataset.mode = hasFilter ? 'reset' : 'new';
  $('emptyAction').hidden = false;
  hydratePreviews(visible, version);
}
async function hydratePreviews(visible, version) {
  try {
    await itemsByIds(
      visible.flatMap((o) => (o.customer_order_lines || []).slice(0, 3).map((l) => l.item_id)),
    );
    if (version !== renderVersion) return;
    for (const el of $('ordersGrid').querySelectorAll('[data-preview]')) {
      const o = visible.find((x) => String(x.id) === el.dataset.preview);
      if (o)
        el.innerHTML = orderPreview(o.customer_order_lines || [], itemCache, getThumbnailImageUrl);
    }
  } catch {
    /* Images are optional; order data stays usable during a network failure. */
  }
}
async function load() {
  const version = ++loadVersion;
  $('btnReload').disabled = true;
  message();
  if (!loaded) {
    $('ordersGrid').innerHTML = '<div class="skeleton"></div>'.repeat(6);
    $('ordersGrid').setAttribute('aria-busy', 'true');
    $('emptyState').hidden = true;
  }
  try {
    const result = await fetchAllOrders();
    if (version !== loadVersion) return;
    orders = result;
    loaded = true;
    itemCache.clear();
    updateStats();
    render();
    const id = new URL(location.href).searchParams.get('id');
    if (id && !dialog.open) await openOrder(id);
  } catch (error) {
    if (version !== loadVersion) return;
    message(`تعذر تحديث الطلبات. ${friendly(error)}`, true);
    if (!loaded) {
      $('ordersGrid').innerHTML = '';
      $('ordersGrid').setAttribute('aria-busy', 'false');
      $('emptyState').hidden = false;
      $('emptyTitle').textContent = 'تعذر تحميل الطلبات';
      $('emptyText').textContent = 'تحقق من الاتصال ثم أعد المحاولة.';
      $('emptyAction').textContent = 'إعادة المحاولة';
      $('emptyAction').dataset.mode = 'retry';
      $('emptyAction').hidden = false;
      $('resultCount').textContent = 'لم يتم تحميل البيانات';
    }
  } finally {
    if (version === loadVersion) $('btnReload').disabled = false;
  }
}
function updateOrderCache(order, lines) {
  const index = orders.findIndex((o) => String(o.id) === String(order.id));
  const value = {
    ...order,
    customer_order_lines: lines ?? orders[index]?.customer_order_lines ?? [],
  };
  if (index < 0) orders.unshift(value);
  else orders[index] = value;
  updateStats();
  render();
}
function setDetailActions(ready) {
  for (const id of [
    'btnDownload',
    'btnEdit',
    'btnEditLines',
    'btnDelete',
    'btnConfirm',
    'btnExecute',
  ])
    $(id).disabled = !ready || busy;
  for (const id of ['btnEdit', 'btnEditLines', 'btnDelete', 'btnConfirm', 'btnExecute'])
    $(id).hidden = !canWrite;
  $('btnEditLines').hidden =
    !canWrite || !current || !['draft', 'confirmed'].includes(statusOf(current));
  if (current) {
    $('btnConfirm').hidden = !canWrite || statusOf(current) !== 'draft';
    $('btnExecute').hidden =
      !canWrite ||
      !canManage(access.member, 'sales') ||
      !['draft', 'confirmed', 'pending_sale'].includes(statusOf(current));
  }
}
async function openOrder(id) {
  const version = ++detailVersion;
  current = null;
  currentLines = [];
  message('', false, 'detailMsg');
  setDetailActions(false);
  $('dTitle').textContent = 'جارٍ تحميل الطلب…';
  $('details').innerHTML = '<div class="skeleton"></div>';
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('orders-modal-open');
  const url = new URL(location.href);
  url.searchParams.set('id', id);
  history.replaceState(null, '', url);
  try {
    const [order, lines] = await Promise.all([freshOrder(id), fetchLines(id)]);
    const map = await itemsByIds(lines.map((l) => l.item_id));
    if (version !== detailVersion || !dialog.open) return;
    current = order;
    currentLines = sortOrderLines(lines, map);
    currentItems = map;
    renderDetails();
    setDetailActions(true);
    updateOrderCache(order, lines);
  } catch (error) {
    if (version !== detailVersion) return;
    $('dTitle').textContent = 'تعذر فتح الطلب';
    $('details').innerHTML =
      '<p class="subtle">يمكنك إغلاق النافذة وفتح الطلب مجددًا للمحاولة.</p>';
    message(friendly(error), true, 'detailMsg');
  }
}
function renderDetails() {
  $('dTitle').textContent = current.customer_name || 'عميل بدون اسم';
  $('details').innerHTML = orderDetails(current, currentLines, currentItems, getThumbnailImageUrl);
}
function closeDetails() {
  if (busy) return;
  dialog.close();
}
dialog.addEventListener('cancel', (e) => {
  if (busy) e.preventDefault();
});
dialog.addEventListener('close', () => {
  ++detailVersion;
  current = null;
  document.body.classList.remove('orders-modal-open');
  const url = new URL(location.href);
  url.searchParams.delete('id');
  history.replaceState(null, '', url);
});
function ask(type) {
  if (!canWrite || !current || busy || (type === 'execute' && !canManage(access.member, 'sales')))
    return;
  action = { type, order: { ...current }, lines: currentLines.map((l) => ({ ...l })) };
  const titles = {
    edit: 'تعديل بيانات الطلب',
    confirm: 'تأكيد الطلب',
    execute: 'تنفيذ الطلب وفتح المبيعات',
    delete: 'حذف الطلب',
  };
  const texts = {
    edit: 'حدّث بيانات العميل والملاحظات الخاصة بهذا الطلب.',
    confirm: 'سيصبح الطلب مؤكدًا وجاهزًا للتنفيذ.',
    execute:
      'ستُفتح صفحة المبيعات لإدخال الكميات الفعلية. يبقى الطلب محجوزًا حتى حفظ المبيعات، وعندها يُعلّم بأنه منفذ.',
    delete:
      'سيُحذف الطلب وبنوده نهائيًا. هذا الإجراء لا يحذف أي مبيعات مسجلة ولا يعيد كمياتها للمخزون.',
  };
  $('actionTitle').textContent = titles[type];
  $('actionText').textContent = texts[type];
  $('editFields').hidden = type !== 'edit';
  $('editName').required = type === 'edit';
  $('editName').value = current.customer_name || '';
  $('editPhone').value = current.customer_phone || '';
  $('editNote').value = current.note || '';
  $('saveAction').textContent =
    type === 'edit'
      ? 'حفظ التعديلات'
      : type === 'delete'
        ? 'حذف نهائي'
        : type === 'execute'
          ? 'متابعة إلى المبيعات'
          : 'تأكيد الطلب';
  $('saveAction').className = `o-button ${type === 'delete' ? 'o-danger' : 'o-primary'}`;
  message('', false, 'actionMsg');
  $('actionDialog').showModal();
}
async function submitAction(event) {
  event.preventDefault();
  if (busy || !action) return;
  const task = action;
  if (task.type === 'edit' && !$('editName').value.trim()) {
    message('أدخل اسم العميل.', true, 'actionMsg');
    return;
  }
  busy = true;
  $('saveAction').disabled = true;
  $('cancelAction').disabled = true;
  setDetailActions(false);
  message('', false, 'actionMsg');
  try {
    if (task.type === 'execute') {
      const latest = await freshOrder(task.order.id),
        lines = await fetchLines(task.order.id);
      const itemIds = [...new Set(lines.map((l) => String(l.item_id)))];
      for (const id of itemIds) itemCache.delete(id);
      const available = await itemsByIds(itemIds);
      if (itemIds.some((id) => !available.get(id)?.is_active))
        throw new Error('يحتوي الطلب على مادة موقوفة أو غير متاحة. راجع المواد قبل التنفيذ.');
      await transferOrder({
        order: latest,
        lines,
        storage: localStorage,
        updateStatus: () => mutate(latest, { status: 'pending_sale' }),
        navigate: (url) => location.assign(url),
      });
      return;
    }
    if (task.type === 'delete') {
      await mutate(task.order, null, true);
      orders = orders.filter((o) => o.id !== task.order.id);
      $('actionDialog').close();
      dialog.close();
      updateStats();
      render();
      message('تم حذف الطلب.');
    } else {
      const values =
        task.type === 'confirm'
          ? { status: 'confirmed' }
          : {
              customer_name: $('editName').value.trim(),
              customer_phone: $('editPhone').value.trim() || null,
              note: $('editNote').value.trim() || null,
            };
      const result = await mutate(task.order, values);
      current = result;
      updateOrderCache(result);
      renderDetails();
      $('actionDialog').close();
      message(
        task.type === 'confirm' ? 'تم تأكيد الطلب.' : 'تم حفظ التعديلات.',
        false,
        'detailMsg',
      );
    }
  } catch (error) {
    message(friendly(error), true, 'actionMsg');
    try {
      $('pendingSales').hidden = !localStorage.getItem(SALES_PREFILL_KEY);
    } catch {}
  } finally {
    busy = false;
    $('saveAction').disabled = false;
    $('cancelAction').disabled = false;
    setDetailActions(!!current);
  }
}
async function download() {
  if (!current || busy) return;
  const order = { ...current },
    element = $('snapshotArea');
  busy = true;
  setDetailActions(false);
  message('جارٍ تجهيز صورة الطلب…', false, 'detailMsg');
  try {
    const { failedImages: failed } = await exportElementToPng(element, {
      fileName: `ADLATEX_order_${reference(order.id)}.png`,
      canvasOptions: {
        onclone: (doc) => {
          const copy = doc.getElementById('snapshotArea');
          if (copy) copy.style.background = '#fff';
          const drawer = doc.getElementById('orderDialog');
          if (drawer) {
            drawer.style.height = 'auto';
            drawer.style.maxHeight = 'none';
            drawer.style.overflow = 'visible';
          }
          const body = doc.getElementById('details');
          if (body) {
            body.style.overflow = 'visible';
            body.style.flex = 'none';
          }
        },
      },
    });
    message(
      failed
        ? 'تم تنزيل الصورة، لكن بعض صور الخامات لم تتحمل. أعد المحاولة إذا أردت تضمينها.'
        : 'تم تجهيز صورة الطلب للتنزيل.',
      false,
      'detailMsg',
    );
  } catch (error) {
    message(friendly(error), true, 'detailMsg');
  } finally {
    busy = false;
    setDetailActions(!!current);
  }
}
function reset() {
  activeStatus = 'all';
  $('search').value = '';
  $('period').value = 'all';
  $('sort').value = 'newest';
  page = 1;
  syncTabs();
  render();
}
function syncTabs() {
  for (const btn of $('statusTabs').querySelectorAll('button'))
    btn.setAttribute('aria-pressed', String(btn.dataset.status === activeStatus));
}
$('statusTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  activeStatus = b.dataset.status;
  page = 1;
  syncTabs();
  if (loaded) render();
});
$('search').addEventListener('input', () => {
  page = 1;
  if (loaded) render();
});
for (const id of ['period', 'sort'])
  $(id).addEventListener('change', () => {
    page = 1;
    if (loaded) render();
  });
$('resetFilters').addEventListener('click', reset);
$('btnReload').addEventListener('click', load);
$('prevPage').addEventListener('click', () => {
  page--;
  render();
  $('ordersGrid').scrollIntoView({ block: 'start' });
});
$('nextPage').addEventListener('click', () => {
  page++;
  render();
  $('ordersGrid').scrollIntoView({ block: 'start' });
});
$('emptyAction').addEventListener('click', () => {
  const mode = $('emptyAction').dataset.mode;
  if (mode === 'retry') load();
  else if (mode === 'reset') reset();
  else location.assign('./preorders.html');
});
$('ordersGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) openOrder(b.dataset.open);
});
$('closeDetails').addEventListener('click', closeDetails);
for (const [id, type] of [
  ['btnEdit', 'edit'],
  ['btnConfirm', 'confirm'],
  ['btnExecute', 'execute'],
  ['btnDelete', 'delete'],
])
  $(id).addEventListener('click', () => ask(type));
$('btnDownload').addEventListener('click', download);
$('actionForm').addEventListener('submit', submitAction);
$('cancelAction').addEventListener('click', () => $('actionDialog').close());
$('actionDialog').addEventListener('cancel', (e) => {
  if (busy) e.preventDefault();
});
$('details').addEventListener('click', (e) => {
  const b = e.target.closest('[data-photo]');
  if (!b) return;
  openImageViewer(b.dataset.photo);
});
$('closePhoto').addEventListener('click', () => $('photoDialog').close());
$('newOrder').hidden = false;
try {
  const pending = JSON.parse(localStorage.getItem(SALES_PREFILL_KEY) || 'null');
  $('pendingSales').hidden = !canWrite || !pending?.order_id;
} catch {}
const initialStatus = new URL(location.href).searchParams.get('status');
if (['draft', 'confirmed', 'pending_sale', 'executed'].includes(initialStatus)) {
  activeStatus = initialStatus;
  syncTabs();
}
mountOrderLineEditor({
  $,
  service,
  canWrite,
  getCurrent: () => current,
  getCurrentLines: () => currentLines,
  getCurrentItems: () => currentItems,
  getBusy: () => busy,
  setBusy: (value) => {
    busy = value;
  },
  friendly,
  openOrder,
  message,
  setDetailActions,
});
await load();
