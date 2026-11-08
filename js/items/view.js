import { escapeHtml as esc } from '../core/text-utils.js';

export function datalistOptions(values) {
  return values.map((value) => `<option value="${esc(value)}">`).join('');
}

export function categoryOptions(values, placeholder) {
  return (
    `<option value="">${esc(placeholder)}</option>` +
    values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('')
  );
}

export function itemRowsHtml(rows, { fullImageUrl, thumbnailUrl }) {
  return rows
    .map((row) => {
      const full = fullImageUrl(row);
      const photo = full
        ? `<img class="thumb" src="${esc(thumbnailUrl(row))}" alt="${esc(row.item_name || 'صورة المادة')}" loading="lazy" decoding="async" width="150" height="150" data-full="${esc(full)}" style="cursor: zoom-in;" />`
        : '<div class="thumb-placeholder"></div>';
      const id = esc(row.id);
      const unit =
        row.unit_type === 'kg' ? 'كيلو' : row.unit_type === 'm' ? 'متر' : row.unit_type || '—';
      return `<tr class="item-card ${!row.is_active ? 'row-inactive' : ''}">
      <td class="item-photo">${photo}</td>
      <td class="item-main-group">${esc(row.main_category || '')}</td>
      <td class="item-sub-group">${esc(row.sub_category || '')}</td>
      <td class="item-name">${esc(row.item_name || '')}</td>
      <td class="item-color-code" data-label="كود اللون">${esc(row.color_code || '—')}</td>
      <td class="item-color-name" data-label="اسم اللون">${esc(row.color_name || '—')}</td>
      <td class="item-unit" data-label="الوحدة">${esc(unit)}</td>
      <td class="item-description ${row.description ? '' : 'is-empty'}" data-label="ملاحظات">${esc(row.description || '')}</td>
      <td class="item-status">${row.is_active ? '<span class="badge ok">نشط</span>' : '<span class="badge warn">موقوف</span>'}</td>
      <td class="item-card-actions"><div class="actionsRow">
        <button class="secondary" data-act="edit" data-id="${id}" title="تعديل">تعديل</button>
        <button class="secondary" data-act="copy-color" data-id="${id}">إضافة لون</button>
        <button class="secondary" data-act="change-image" data-id="${id}" title="تغيير الصورة">تغيير الصورة</button>
        <button class="${row.is_active ? 'secondary' : 'primary'}" data-act="toggle" data-id="${id}" data-val="${Boolean(row.is_active)}" title="تغيير الحالة">${row.is_active ? 'إيقاف' : 'تفعيل'}</button>
        <button class="danger" data-act="delete" data-id="${id}" title="حذف">حذف</button>
      </div></td>
    </tr>`;
    })
    .join('');
}
