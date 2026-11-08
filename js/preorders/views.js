import { escapeHtml as esc, materialLabel } from '../core/text-utils.js';
const num = new Intl.NumberFormat('en-US');
export function catalogImage(item, getThumbnailImageUrl, cls = '', lazy = true) {
  const url = item?.image_path ? getThumbnailImageUrl(item.image_path) : '';
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(item.item_name || 'خامة')}" ${lazy ? 'loading="lazy"' : ''} decoding="async" crossorigin="anonymous">`
    : `<span class="${cls || 'mini-photo'}" aria-label="لا توجد صورة"></span>`;
}
export function quantityStepper(id, qty, locked) {
  return `<div class="qty-stepper"><button type="button" data-step="-1" data-id="${esc(id)}" aria-label="تقليل الأثواب" ${locked ? 'disabled' : ''}>−</button><input inputmode="numeric" type="text" pattern="[0-9٠-٩]+" value="${qty}" data-qty="${esc(id)}" aria-label="عدد الأثواب" ${locked ? 'disabled' : ''}><button type="button" data-step="1" data-id="${esc(id)}" aria-label="زيادة الأثواب" ${locked ? 'disabled' : ''}>+</button></div>`;
}
export function productActions(item, cart, locked) {
  const qty = cart[item.id] || 0;
  return qty
    ? quantityStepper(item.id, qty, locked)
    : `<button type="button" class="shop-button" data-add="${esc(item.id)}" ${locked ? 'disabled' : ''}>+ أضف إلى الطلب</button>`;
}
export function productCards(visible, cart, locked, getThumbnailImageUrl) {
  return visible
    .map((it) => {
      const qty = cart[it.id] || 0;
      return `<article class="product-card ${qty ? 'selected' : ''}" data-product="${esc(it.id)}"><div class="product-visual"><button type="button" class="product-photo" data-photo="${esc(it.id)}" aria-label="تكبير صورة ${esc(it.item_name)}">${it.image_path ? catalogImage(it, getThumbnailImageUrl) : 'صورة غير متاحة'}</button><bdi class="product-code">${esc(it.color_code || '—')}</bdi><span class="selected-tick" ${qty ? '' : 'hidden'}>✓</span></div><div class="product-info"><p class="product-category">${esc(it.sub_category || it.main_category)}</p><h3>${esc(it.item_name || 'خامة بدون اسم')}</h3><p class="product-color">${esc(it.color_name || 'لون بدون تسمية')}</p><div class="stock-info"><span>رصيد المخزون</span><strong class="${it.balance_rolls <= 0 ? 'no-stock' : ''}">${num.format(it.balance_rolls)} ثوب</strong></div><p class="pending-info">${it.pending_rolls ? `عليها طلبات: ${num.format(it.pending_rolls)} ثوب` : 'لا توجد طلبات معلّقة'}</p></div><div class="product-actions">${productActions(it, cart, locked)}</div></article>`;
    })
    .join('');
}
export function miniCartLines(cart, itemMap, loaded, getThumbnailImageUrl) {
  return (
    Object.entries(cart)
      .slice(0, 5)
      .map(([id, qty]) => {
        const it = itemMap.get(id);
        return `<div class="mini-line">${catalogImage(it, getThumbnailImageUrl)}<div><p>${esc(it?.item_name || 'مادة غير متاحة')}</p><small>${esc(it?.color_code || '')} · ${esc(it?.color_name || '')}</small></div><strong>${qty}</strong></div>`;
      })
      .join('') ||
    (loaded
      ? '<div class="mini-empty"><span>▧</span>سلتك تنتظر اختياراتك.<br>أضف أول خامة وابدأ طلبك.</div>'
      : '<p class="mini-empty">جارٍ تحميل الخامات…</p>')
  );
}
export function checkoutLines(entries, itemMap, locked, getThumbnailImageUrl) {
  return (
    entries
      .map(([id, qty]) => {
        const it = itemMap.get(id);
        return `<div class="checkout-line">${catalogImage(it, getThumbnailImageUrl, 'checkout-photo', false)}<div><h4>${esc(it ? materialLabel(it) : 'مادة غير متاحة — احذفها لإكمال الطلب')}</h4><p>${esc(it?.color_code || '')} · ${esc(it?.color_name || '')} ${it ? `<br>بعد الطلبات: ${num.format(it.balance_rolls - it.pending_rolls)} ثوب` : ''}</p><div class="line-controls">${quantityStepper(id, qty, locked)}<button type="button" class="text-action" data-remove="${esc(id)}" ${locked ? 'disabled' : ''}>حذف</button></div></div></div>`;
      })
      .join('') || '<p class="basket-note">السلة فارغة. أغلق المراجعة واختر خاماتك.</p>'
  );
}
export function savedOrderSnapshot(saved, getThumbnailImageUrl) {
  return `<p style="letter-spacing:2px;color:#087f78">ADLATEX · طلب خامات</p><h2>${esc(saved.customer.name)}</h2><p>${esc(saved.customer.phone)}<br>${esc(new Date(saved.createdAt).toLocaleString('ar-EG'))}<br>رقم الطلب: ${esc(saved.id.slice(0, 8).toUpperCase())}</p>${saved.customer.note ? `<p>${esc(saved.customer.note)}</p>` : ''}${saved.lines.map((l) => `<div class="export-line">${catalogImage(l.item, getThumbnailImageUrl, '', false)}<div><h3>${esc(materialLabel(l.item))}</h3><p>كود اللون: ${esc(l.item?.color_code || '—')} · ${esc(l.item?.color_name || '')}</p></div><strong>${l.qty_rolls} ثوب</strong></div>`).join('')}<div class="export-total">الإجمالي: ${saved.lines.length} صنف — ${num.format(saved.lines.reduce((n, l) => n + l.qty_rolls, 0))} ثوب</div>`;
}
