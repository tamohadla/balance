import { exportElementToPng } from './ui/image-export.js';
import {
  productActions,
  productCards,
  miniCartLines,
  checkoutLines,
  savedOrderSnapshot,
} from './preorders/views.js';
import { createCatalogService } from './preorders/service.js';
import { openImageViewer } from './image-viewer.js';

import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
import {
  $,
  escapeHtml as esc,
  getPublicImageUrl,
  getThumbnailImageUrl,
  materialLabel,
} from './shared.js';
import { quantity, cleanCart, cartTotals, filterCatalog, stockIssues } from './preorders-model.js';
const access = await requireAccess();
const KEY = `adlatex_order_cart_v2:${access.user.id}`;
const num = new Intl.NumberFormat('en-US');
let state = {
  cart: {},
  customer: { name: '', phone: '', note: '' },
  pending: null,
  lastSaved: null,
};
let items = [],
  itemMap = new Map(),
  loaded = false,
  busy = false,
  limit = 24,
  loadVersion = 0;
const catalogService = createCatalogService(supabase);
const filters = {
  search: '',
  main: '',
  sub: '',
  sort: 'purchase_newest',
  available: false,
  selected: false,
  pending: false,
};
const checkout = $('checkoutDialog');
function msg(text = '', error = false, target = 'shopMsg') {
  const el = $(target);
  el.textContent = text;
  el.hidden = !text;
  el.dataset.error = String(error);
}
function errorText(error) {
  const messages = {
    ORDER_ACCESS_DENIED: 'حسابك لا يملك صلاحية إنشاء طلب. تواصل مع المدير.',
    INVALID_CUSTOMER: 'راجع اسم العميل ورقم الهاتف.',
    INVALID_LINES: 'راجع الكميات: من 1 إلى 100,000 ثوب لكل صنف، وبحد أقصى 500 صنف.',
    ITEM_UNAVAILABLE: 'إحدى الخامات أصبحت موقوفة أو غير متاحة. حدّث الخامات وراجع السلة.',
    ORDER_REQUEST_CONFLICT: 'تعارض في محاولة الحفظ. لا تكرر الطلب؛ تواصل مع المدير برقم المحاولة.',
  };
  return messages[error?.message] || 'تعذر إكمال العملية. تحقق من الاتصال وحاول مرة أخرى.';
}
function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      state = {
        ...state,
        ...raw,
        cart: cleanCart(raw.cart),
        customer: { ...state.customer, ...raw.customer },
      };
    }
  } catch {
    msg('تعذر استعادة السلة المحفوظة. يمكنك اختيار الخامات من جديد.', true);
  }
}
function persist(next) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    state = next;
    return true;
  } catch {
    msg('تعذر حفظ السلة على هذا الجهاز. وفّر مساحة أو اسمح بالتخزين ثم أعد المحاولة.', true);
    return false;
  }
}
function locked() {
  return busy || !!state.pending;
}
function categories() {
  const counts = new Map();
  for (const it of items)
    if (it.is_active) {
      const main = it.main_category || 'غير مصنف';
      counts.set(main, (counts.get(main) || 0) + 1);
    }
  $('mainCategories').innerHTML =
    `<button data-main="" aria-pressed="${!filters.main}">كل المجموعات <small>${items.filter((i) => i.is_active).length}</small></button>` +
    [...counts]
      .sort(([a], [b]) => a.localeCompare(b, 'ar'))
      .map(
        ([name, count]) =>
          `<button data-main="${esc(name)}" aria-pressed="${filters.main === name}">${esc(name)} <small>${count}</small></button>`,
      )
      .join('');
  const subs = [
    ...new Set(
      items
        .filter((i) => i.is_active && (!filters.main || i.main_category === filters.main))
        .map((i) => i.sub_category)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ar'));
  if (!subs.includes(filters.sub)) filters.sub = '';
  $('filterSub').innerHTML =
    '<option value="">كل الخامات</option>' +
    subs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  $('filterSub').value = filters.sub;
  $('catalogTotal').textContent =
    `${num.format(items.filter((i) => i.is_active).length)} خامة ولون`;
}
function renderCatalog() {
  if (!loaded) return;
  const rows = filterCatalog(items, filters, state.cart),
    visible = rows.slice(0, limit);
  $('productGrid').innerHTML = productCards(visible, state.cart, locked(), getThumbnailImageUrl);
  $('productGrid').setAttribute('aria-busy', 'false');
  $('resultCount').textContent = `عرض ${visible.length} من ${num.format(rows.length)} خامة ولون`;
  $('loadMore').hidden = visible.length >= rows.length;
  $('emptyCatalog').hidden = !!rows.length;
  const active =
    filters.search ||
    filters.main ||
    filters.sub ||
    filters.available ||
    filters.selected ||
    filters.pending;
  $('resetFilters').hidden = !active;
  for (const b of $('quickFilters').querySelectorAll('[data-filter]'))
    b.setAttribute('aria-pressed', String(filters[b.dataset.filter]));
}
function refreshCart() {
  const total = cartTotals(state.cart);
  $('basketCount').textContent = total.items;
  $('selectedCount').textContent = total.items;
  $('basketRolls').textContent = num.format(total.rolls);
  $('mobileTotal').textContent = `${num.format(total.rolls)} ثوب`;
  $('mobileCount').textContent = total.items ? `${total.items} صنف في سلتك` : 'السلة فارغة';
  $('reviewOrder').disabled = !loaded || !total.items || locked();
  $('mobileReview').disabled = !loaded || !total.items || locked();
  $('clearCart').disabled = !total.items || locked();
  $('miniCart').innerHTML = miniCartLines(state.cart, itemMap, loaded, getThumbnailImageUrl);
  if (total.items > 5)
    $('miniCart').insertAdjacentHTML(
      'beforeend',
      `<p class="basket-note">و${total.items - 5} أصناف أخرى — راجعها قبل الحفظ.</p>`,
    );
  $('recoveryBar').hidden = !state.pending;
  $('recoverSave').disabled = busy;
  $('lastOrderBar').hidden = !state.lastSaved;
  if (state.lastSaved) {
    $('lastOrderName').textContent = state.lastSaved.customer.name;
    $('lastOrderLink').href = `./orders.html?id=${encodeURIComponent(state.lastSaved.id)}`;
  }
}
function setQuantity(id, value) {
  if (locked()) return;
  const qty = quantity(value);
  if (qty === null) {
    msg('أدخل عدد أثواب صحيحًا من 0 إلى 100,000.', true);
    renderCatalog();
    return;
  }
  const cart = { ...state.cart };
  if (qty) cart[id] = qty;
  else delete cart[id];
  if (Object.keys(cart).length > 500) {
    msg('الحد الأقصى 500 صنف في الطلب الواحد.', true);
    return;
  }
  if (!persist({ ...state, cart })) return;
  $('acceptOverstock').checked = false;
  // Update just this card so adding quantities never jumps the catalog or reloads images.
  const card = [...$('productGrid').querySelectorAll('[data-product]')].find(
    (el) => el.dataset.product === id,
  );
  if (card) {
    card.classList.toggle('selected', qty > 0);
    card.querySelector('.selected-tick').hidden = !qty;
    card.querySelector('.product-actions').innerHTML = productActions(
      itemMap.get(id),
      state.cart,
      locked(),
    );
  }
  if (filters.selected) renderCatalog();
  refreshCart();
  if (checkout.open) renderCheckoutLines();
}
async function load() {
  const version = ++loadVersion;
  $('reloadCatalog').disabled = true;
  if (!loaded) {
    $('productGrid').innerHTML = '<div class="product-skeleton"></div>'.repeat(6);
    $('productGrid').setAttribute('aria-busy', 'true');
  }
  try {
    const map = await catalogService.loadCatalog();
    if (version !== loadVersion) return;
    items = [...map.values()];
    itemMap = map;
    loaded = true;
    categories();
    renderCatalog();
    refreshCart();
    if (checkout.open) renderCheckoutLines();
  } catch {
    msg('تعذر تحديث الخامات والأرصدة. تحقق من الاتصال واضغط تحديث.', true);
    if (!loaded) {
      $('productGrid').innerHTML = '';
      $('productGrid').setAttribute('aria-busy', 'false');
      $('resultCount').textContent = 'لم يتم تحميل الخامات';
    }
  } finally {
    if (version === loadVersion) $('reloadCatalog').disabled = false;
  }
}
function renderCheckoutLines() {
  const entries = Object.entries(state.cart),
    totals = cartTotals(state.cart);
  $('checkoutLines').innerHTML = checkoutLines(entries, itemMap, locked(), getThumbnailImageUrl);
  $('checkoutCount').textContent = `${totals.items} صنف`;
  $('checkoutRolls').textContent = `${num.format(totals.rolls)} ثوب`;
  const issues = stockIssues(state.cart, itemMap),
    unavailable = issues.some((l) => !l.item?.is_active);
  $('stockWarning').hidden = !issues.length;
  $('stockWarning').textContent = unavailable
    ? 'توجد خامات موقوفة أو غير متاحة في السلة. احذفها لإكمال الطلب.'
    : `${issues.length} صنف بكميات أعلى من الرصيد بعد الطلبات. راجع الكميات أو أكّد رغبتك في طلبها.`;
  $('overstockConfirm').hidden = !issues.length || unavailable;
  $('acceptOverstock').required = issues.length > 0 && !unavailable;
  $('saveOrder').disabled = !totals.items || unavailable || locked();
}
function openCheckout() {
  if (!loaded || !Object.keys(state.cart).length || locked()) return;
  msg('', false, 'checkoutMsg');
  renderCheckoutLines();
  $('customerName').value = state.customer.name || '';
  $('customerPhone').value = state.customer.phone || '';
  $('customerNote').value = state.customer.note || '';
  checkout.showModal();
  document.body.classList.add('modal-open');
}
function closeCheckout() {
  if (!busy) checkout.close();
}
function snapshot(request, result) {
  return {
    id: result.id,
    createdAt: result.created_at,
    customer: request.customer,
    lines: request.lines.map((l) => ({ ...l, item: request.items[l.item_id] })),
  };
}
function saveUI() {
  for (const el of checkout.querySelectorAll('button,input,textarea')) el.disabled = locked();
  $('recoverSave').disabled = busy;
  $('retryCheckout').hidden = !state.pending;
  $('retryCheckout').disabled = busy;
  $('saveOrder').hidden = !!state.pending;
  $('closeCheckout').disabled = busy;
  $('continueShopping').disabled = busy;
  $('saveOrder').textContent = busy ? 'جارٍ حفظ الطلب…' : 'حفظ الطلب';
  renderCatalog();
  refreshCart();
}
async function saveRequest() {
  if (busy || !state.pending) return;
  const request = state.pending;
  busy = true;
  saveUI();
  msg('جارٍ حفظ الطلب…', false, 'checkoutMsg');
  try {
    const { data, error } = await supabase.rpc('create_employee_order', {
      p_order_id: request.id,
      p_customer_name: request.customer.name,
      p_customer_phone: request.customer.phone,
      p_note: request.customer.note || null,
      p_lines: request.lines,
    });
    if (error) throw error;
    if (!data?.id) throw new Error('EMPTY_RESULT');
    const saved = snapshot(request, data);
    // Persist the receipt and empty cart together. A failed local write keeps the
    // same request id available for safe retry, rather than creating another order.
    if (
      !persist({
        cart: {},
        customer: { name: '', phone: '', note: '' },
        pending: null,
        lastSaved: saved,
      })
    )
      throw new Error('LOCAL_STORAGE');
    checkout.close();
    $('successText').textContent =
      `${saved.customer.name} · ${saved.lines.length} صنف · ${num.format(saved.lines.reduce((n, l) => n + l.qty_rolls, 0))} ثوب`;
    $('viewSavedOrder').href = `./orders.html?id=${encodeURIComponent(saved.id)}`;
    msg('', false, 'exportMsg');
    $('successDialog').showModal();
    document.body.classList.add('modal-open');
    msg('تم حفظ الطلب وإرساله للمراجعة.');
    void load();
  } catch (error) {
    const definite =
      ['INVALID_CUSTOMER', 'INVALID_LINES', 'ITEM_UNAVAILABLE', 'ORDER_ACCESS_DENIED'].includes(
        error?.message,
      ) || ['22P02', '22003', '23503', '23514', '42501'].includes(error?.code);
    if (definite) persist({ ...state, pending: null });
    const text = definite
      ? errorText(error)
      : 'لم نتأكد من اكتمال الحفظ. اضغط «استكمال الحفظ» للتحقق بنفس رقم الطلب دون إنشاء نسخة أخرى.';
    msg(text, true, 'checkoutMsg');
    msg(text, true);
  } finally {
    busy = false;
    saveUI();
    if (checkout.open && !state.pending) renderCheckoutLines();
  }
}
async function submit(event) {
  event.preventDefault();
  if (locked()) return;
  const customer = {
    name: $('customerName').value.trim(),
    phone: $('customerPhone').value.trim(),
    note: $('customerNote').value.trim(),
  };
  if (!customer.name || !customer.phone) {
    msg('أدخل اسم العميل ورقم الهاتف.', true, 'checkoutMsg');
    return;
  }
  const lines = Object.entries(state.cart).map(([item_id, qty_rolls]) => ({ item_id, qty_rolls }));
  if (!lines.length || lines.some((l) => !itemMap.get(l.item_id)?.is_active)) {
    msg('راجع الخامات المختارة قبل الحفظ.', true, 'checkoutMsg');
    return;
  }
  const issues = stockIssues(state.cart, itemMap);
  if (issues.length && !$('acceptOverstock').checked) {
    msg('راجع تنبيه الكميات وأكّد رغبتك قبل الحفظ.', true, 'checkoutMsg');
    return;
  }
  const request = {
    id: crypto.randomUUID(),
    customer,
    lines,
    items: Object.fromEntries(lines.map((l) => [l.item_id, itemMap.get(l.item_id)])),
  };
  if (!persist({ ...state, customer, pending: request })) return;
  await saveRequest();
}
async function downloadSaved() {
  const saved = state.lastSaved;
  if (!saved || busy) return;
  busy = true;
  $('downloadOrder').disabled = true;
  $('lastOrderImage').disabled = true;
  msg('جارٍ تجهيز الصورة…', false, 'exportMsg');
  let element;
  try {
    element = document.createElement('div');
    element.className = 'export-snapshot';
    element.innerHTML = savedOrderSnapshot(saved, getThumbnailImageUrl);
    document.body.append(element);
    await exportElementToPng(element, { fileName: `ADLATEX_${saved.id.slice(0, 8)}.png` });
    msg('تم تجهيز صورة الطلب.', false, 'exportMsg');
    msg('تم تجهيز صورة آخر طلب للتنزيل.');
  } catch {
    msg(
      'الطلب محفوظ. تعذر تنزيل الصورة الآن؛ يمكنك المحاولة مجددًا أو فتح الطلب من المتابعة.',
      true,
      'exportMsg',
    );
    msg('الطلب محفوظ، لكن تعذر تنزيل صورته الآن. يمكنك المحاولة مجددًا.', true);
  } finally {
    element?.remove();
    busy = false;
    $('downloadOrder').disabled = false;
    $('lastOrderImage').disabled = false;
  }
}
function resetFilters() {
  Object.assign(filters, {
    search: '',
    main: '',
    sub: '',
    sort: 'purchase_newest',
    available: false,
    selected: false,
    pending: false,
  });
  $('search').value = '';
  $('sort').value = 'purchase_newest';
  limit = 24;
  categories();
  renderCatalog();
}
// Bind immediately after authenticated imports; DOMContentLoaded may have already fired.
$('search').addEventListener('input', () => {
  filters.search = $('search').value;
  limit = 24;
  renderCatalog();
});
$('mainCategories').addEventListener('click', (e) => {
  const b = e.target.closest('[data-main]');
  if (!b) return;
  filters.main = b.dataset.main;
  filters.sub = '';
  limit = 24;
  categories();
  renderCatalog();
});
$('filterSub').addEventListener('change', () => {
  filters.sub = $('filterSub').value;
  limit = 24;
  renderCatalog();
});
$('sort').addEventListener('change', () => {
  filters.sort = $('sort').value;
  renderCatalog();
});
$('quickFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  filters[b.dataset.filter] = !filters[b.dataset.filter];
  limit = 24;
  renderCatalog();
});
$('resetFilters').addEventListener('click', resetFilters);
$('emptyReset').addEventListener('click', resetFilters);
$('reloadCatalog').addEventListener('click', () => {
  msg();
  load();
});
$('loadMore').addEventListener('click', () => {
  limit += 24;
  renderCatalog();
});
for (const root of [$('productGrid'), $('checkoutLines')]) {
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'),
      step = e.target.closest('[data-step]'),
      remove = e.target.closest('[data-remove]'),
      photo = e.target.closest('[data-photo]');
    if (add) setQuantity(add.dataset.add, 1);
    if (step)
      setQuantity(
        step.dataset.id,
        Math.max(0, (state.cart[step.dataset.id] || 0) + Number(step.dataset.step)),
      );
    if (remove) setQuantity(remove.dataset.remove, 0);
    if (photo) {
      const it = itemMap.get(photo.dataset.photo);
      if (!it?.image_path) return;
      openImageViewer(
        getPublicImageUrl(it.image_path),
        materialLabel(it) + ` · ${it.color_code || ''}`,
      );
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-qty]')) {
      e.preventDefault();
      setQuantity(e.target.dataset.qty, e.target.value);
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-qty]')) setQuantity(e.target.dataset.qty, e.target.value);
  });
}
$('clearCart').addEventListener('click', () => {
  if (locked() || !confirm('تفريغ جميع الخامات من السلة؟')) return;
  if (persist({ ...state, cart: {} })) {
    renderCatalog();
    refreshCart();
  }
});
$('reviewOrder').addEventListener('click', openCheckout);
$('mobileReview').addEventListener('click', openCheckout);
$('closeCheckout').addEventListener('click', closeCheckout);
$('continueShopping').addEventListener('click', closeCheckout);
$('checkoutForm').addEventListener('submit', submit);
$('recoverSave').addEventListener('click', saveRequest);
$('retryCheckout').addEventListener('click', saveRequest);
for (const [id, key] of [
  ['customerName', 'name'],
  ['customerPhone', 'phone'],
  ['customerNote', 'note'],
])
  $(id).addEventListener('input', () => {
    if (!locked()) persist({ ...state, customer: { ...state.customer, [key]: $(id).value } });
  });
checkout.addEventListener('cancel', (e) => {
  if (busy) e.preventDefault();
});
checkout.addEventListener('close', () =>
  document.body.classList.toggle('modal-open', !!document.querySelector('dialog[open]')),
);
$('downloadOrder').addEventListener('click', downloadSaved);
$('lastOrderImage').addEventListener('click', downloadSaved);
$('startNewOrder').addEventListener('click', () => $('successDialog').close());
$('successDialog').addEventListener('close', () =>
  document.body.classList.toggle('modal-open', !!document.querySelector('dialog[open]')),
);
$('closeFabric').addEventListener('click', () => $('fabricDialog').close());
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || busy) return;
  restore();
  if (loaded) {
    renderCatalog();
    refreshCart();
    if (checkout.open) {
      closeCheckout();
      msg('تم تحديث السلة من نافذة أخرى. راجع الاختيارات قبل الحفظ.');
    }
  }
});
$('restoreLegacy').addEventListener('click', () => {
  if (locked()) return;
  try {
    const legacy = cleanCart(JSON.parse(localStorage.getItem('preorder_cart_v1') || '{}'));
    if (persist({ ...state, cart: { ...legacy, ...state.cart } })) {
      localStorage.removeItem('preorder_cart_v1');
      $('legacyCartBar').hidden = true;
      renderCatalog();
      refreshCart();
    }
  } catch {
    msg('تعذر استعادة الاختيارات القديمة.', true);
  }
});
restore();
refreshCart();
try {
  $('legacyCartBar').hidden = !Object.keys(
    cleanCart(JSON.parse(localStorage.getItem('preorder_cart_v1') || '{}')),
  ).length;
} catch {}
await load();
