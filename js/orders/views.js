import { escapeHtml as esc, materialLabel } from '../core/text-utils.js';
import { STATUS, statusOf, totalRolls } from '../orders-model.js';
const dateFormat = new Intl.DateTimeFormat('ar-EG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const number = new Intl.NumberFormat('en-US');
export function orderReference(id) {
  return String(id).slice(0, 8).toUpperCase();
}
function reference(id) {
  return orderReference(id);
}
function date(ts) {
  const value = new Date(ts);
  return Number.isFinite(+value) ? dateFormat.format(value) : 'تاريخ غير متاح';
}
function badge(order) {
  const state = statusOf(order);
  return `<span class="order-status ${STATUS[state] ? state : 'unknown'}">${esc(STATUS[state] || 'حالة أخرى')}</span>`;
}
function phoneLink(value) {
  const phone = String(value || '').replace(/[^+\d]/g, '');
  return phone
    ? `<a href="tel:${esc(phone)}" dir="ltr">${esc(value)}</a>`
    : '<span class="subtle">لا يوجد رقم هاتف</span>';
}
export function orderPreview(lines, itemCache, getThumbnailImageUrl) {
  const unique = [...new Set(lines.map((l) => String(l.item_id)))];
  const thumbs = unique
    .slice(0, 3)
    .map((id) => {
      const it = itemCache.get(id);
      const url = it?.image_path ? getThumbnailImageUrl(it.image_path) : null;
      return url
        ? `<img src="${esc(url)}" alt="${esc(it.item_name || 'خامة')}" width="64" height="64" loading="lazy" decoding="async">`
        : '<span class="preview-placeholder" aria-label="صورة غير متاحة">▧</span>';
    })
    .join('');
  return (
    thumbs + (unique.length > 3 ? `<span class="preview-more">+${unique.length - 3}</span>` : '') ||
    '<span class="subtle">الطلب لا يحتوي على أصناف</span>'
  );
}
export function orderCards(visible, itemCache, getThumbnailImageUrl) {
  return visible
    .map((o) => {
      const lines = o.customer_order_lines || [];
      return `<article class="order-card"><div class="order-card-top"><span class="order-reference">#${esc(reference(o.id))}</span>${badge(o)}</div><div class="order-card-body"><div class="customer-row"><span class="customer-avatar" aria-hidden="true">${esc((o.customer_name || 'ع').trim().slice(0, 1))}</span><div><h2>${esc(o.customer_name || 'عميل بدون اسم')}</h2><p><bdi>${esc(o.customer_phone || 'لا يوجد رقم هاتف')}</bdi></p></div></div><p class="order-card-date">${esc(date(o.created_at))}</p><div class="order-preview" data-preview="${esc(o.id)}" aria-label="صور خامات الطلب">${orderPreview(lines, itemCache, getThumbnailImageUrl)}</div><div class="order-totals"><span><strong>${number.format(lines.length)}</strong> صنف</span><span><strong>${number.format(totalRolls(lines))}</strong> ثوب</span></div>${o.note ? `<p class="order-note" title="${esc(o.note)}">${esc(o.note)}</p>` : ''}</div><footer class="order-card-footer"><button class="o-button" data-open="${esc(o.id)}" aria-label="عرض طلب ${esc(o.customer_name || 'العميل')}">عرض الطلب <span aria-hidden="true">←</span></button></footer></article>`;
    })
    .join('');
}
const orderItemCollator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
export function sortOrderLines(lines, items) {
  return [...lines].sort((a, b) => {
    const left = items.get(String(a.item_id)),
      right = items.get(String(b.item_id));
    if (!left || !right)
      return Number(!left) - Number(!right) || String(a.id).localeCompare(String(b.id));
    for (const field of ['main_category', 'sub_category', 'item_name', 'color_code']) {
      const cmp = orderItemCollator.compare(
        String(left[field] ?? '').trim(),
        String(right[field] ?? '').trim(),
      );
      if (cmp) return cmp;
    }
    return (
      String(a.item_id).localeCompare(String(b.item_id)) || String(a.id).localeCompare(String(b.id))
    );
  });
}
export function orderDetails(
  order,
  currentLines,
  currentItems,
  getThumbnailImageUrl,
  { customerView = false } = {},
) {
  const snapshot = `<div id="snapshotArea"><div class="snapshot-brand">ADLATEX · ORDER #${esc(reference(order.id))}</div><div class="detail-meta">${customerView ? '' : badge(order)}<time>${esc(date(order.created_at))}</time></div><section class="detail-customer"><h3>${esc(order.customer_name || 'عميل بدون اسم')}</h3>${customerView ? `<bdi>${esc(order.customer_phone || '—')}</bdi>` : phoneLink(order.customer_phone)}${order.note ? `<p>${esc(order.note)}</p>` : ''}</section><h3 class="detail-section-title">الخامات المطلوبة <span>${currentLines.length} صنف</span></h3>${
    currentLines
      .map((line) => {
        const it = currentItems.get(String(line.item_id)),
          url = it?.image_path ? getThumbnailImageUrl(it.image_path) : null;
        const image = url
          ? `<img src="${esc(url)}" crossorigin="anonymous" alt="${esc(it.item_name || 'الخامة')}" width="128" height="128" decoding="async">`
          : '';
        let photo = '<div class="product-photo product-photo-placeholder">لا توجد صورة</div>';
        if (image) {
          photo = customerView
            ? `<div class="product-photo">${image}</div>`
            : `<button class="product-photo" data-photo="${esc(url)}" aria-label="تكبير صورة ${esc(it.item_name || 'الخامة')}">${image}</button>`;
        }
        return `<div class="line-product">${photo}<div><h4>${esc(it ? materialLabel(it) : 'مادة غير متاحة')}</h4><p>كود اللون: <bdi>${esc(it?.color_code || '—')}</bdi><br>${esc(it?.color_name || '')}</p></div><div class="line-quantity"><strong>${number.format(Number(line.qty_rolls) || 0)}</strong><span>ثوب</span></div></div>`;
      })
      .join('') || '<p class="subtle">لا توجد أصناف في هذا الطلب.</p>'
  }<div class="detail-total"><span>إجمالي الأثواب المطلوبة</span><strong>${number.format(totalRolls(currentLines))} ثوب</strong></div></div>`;
  if (customerView) return snapshot;
  return `${snapshot}<p class="workflow-note">${order.sales_group_id ? `<a href="./sales-review.html?group=${encodeURIComponent(order.sales_group_id)}" target="_blank" rel="noopener">عرض المبيعات المرتبطة بالطلب ←</a><br>` : ''}${statusOf(order) === 'executed' ? 'الطلبات القديمة قد تكون محوّلة فقط. راجع سجل المبيعات للتحقق من الكميات المسجلة.' : 'يبقى حجز الطلب قائمًا حتى حفظ الكميات الفعلية في المبيعات.'}</p>`;
}
