import { stockTotals } from '../inventory-model.js';

// Rendering receives presentation helpers explicitly, keeping this module usable
// in tests without loading sessions, network clients or browser observers.
export function createInventoryView({
  escapeHtml,
  materialLabel,
  unitLabel,
  getPublicImageUrl,
  getThumbnailImageUrl,
}) {
  function unitBucket(unitType) {
    const u = String(unitType || '').toLowerCase();
    if (u === 'kg' || u.includes('kg') || u.includes('kilo')) return 'kg';
    if (u === 'm' || u.includes('meter') || u.includes('metre') || u.includes('mtr')) return 'm';
    return 'other';
  }

  function summaryText(rows) {
    const totalItems = rows.length;
    let totalRolls = 0;
    let totalKg = 0;
    let totalM = 0;

    for (const r of rows) {
      totalRolls += r.balance_rolls || 0;
      const b = r.balance_main || 0;
      const bucket = unitBucket(r.unit_type);
      if (bucket === 'kg') totalKg += b;
      else if (bucket === 'm') totalM += b;
    }

    const parts = [];
    parts.push(`إجمالي المواد: ${totalItems}`);
    parts.push(`إجمالي عدد الأثواب: ${parseInt(totalRolls || 0, 10)}`);

    if (Math.abs(totalKg) > 1e-9)
      parts.push(`إجمالي الكمية: ${Number(totalKg || 0).toFixed(3)} كغ`);
    if (Math.abs(totalM) > 1e-9) parts.push(`إجمالي الكمية: ${Number(totalM || 0).toFixed(3)} متر`);

    if (Math.abs(totalKg) <= 1e-9 && Math.abs(totalM) <= 1e-9) {
      const any = rows.find((r) => (r.balance_main || 0) !== 0);
      if (any) {
        const uLbl = unitLabel(any.unit_type);
        const sumAll = rows.reduce((acc, r) => acc + (r.balance_main || 0), 0);
        parts.push(`إجمالي الكمية: ${Number(sumAll || 0).toFixed(3)} ${uLbl}`);
      }
    }

    return parts.join(' | ');
  }

  function formatDate(ts) {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString('ar-EG');
    } catch {
      return ts;
    }
  }

  function moveTypeLabel(type) {
    if (type === 'purchase') return 'مشتريات';
    if (type === 'sale') return 'مبيعات';
    if (type === 'adjustment') return 'تسويات';
    return type || '-';
  }

  function renderOrdersCell(row, preordersByItem) {
    const info = preordersByItem.get(String(row.id));
    if (!info || info.totalRolls <= 0) return '-';

    return `
    <div class="orders-cell">
      <div>رصيد بعد الطلبات : <strong>${row.balance_after_orders}</strong> توب</div>
      <div>إجمالي الطلبات : <strong>${info.totalRolls}</strong> توب / <strong>${info.count}</strong> طلبات</div>
    </div>
  `;
  }

  function rowsHtml(rows, { preordersByItem, canWrite, isAdmin, itemStatusBusy }) {
    return rows
      .map((r) => {
        const imgUrl = getPublicImageUrl(r.image_path);
        const img = imgUrl
          ? `<img class="thumb zoomable" src="${escapeHtml(getThumbnailImageUrl(r.image_path))}" data-full="${escapeHtml(imgUrl)}" alt="img" loading="lazy" decoding="async" width="150" height="150" />`
          : `<span class="thumb"></span>`;
        const orderInfo = preordersByItem.get(String(r.id));
        const orderRolls = Number(orderInfo?.totalRolls || 0);
        const orderCount = Number(orderInfo?.count || 0);

        return `
      <tr class="inventory-row ${!r.is_active ? 'is-inactive' : ''} ${r.balance_after_orders < 0 ? 'has-shortage' : ''}">
        <td class="cell-image">${img}</td>
        <td class="cell-item">
          <div class="material-main-line">${escapeHtml(materialLabel(r))}${!r.is_active ? '<span class="inactive-badge">موقوف</span>' : ''}</div>
          <div class="material-color-line">${escapeHtml(r.color_code)} / ${escapeHtml(r.color_name)}</div>
          <div class="mobile-details">
            <div class="mobile-detail-row">
              <span class="label">إجمالي الرصيد</span>
              <span class="value">${Number(r.balance_main || 0).toFixed(3)} ${escapeHtml(unitLabel(r.unit_type))} - ${parseInt(r.balance_rolls || 0, 10)} توب</span>
            </div>
            <div class="mobile-detail-row">
              <span class="label">رصيد بعد الطلبات</span>
              <span class="value">${parseInt(r.balance_after_orders || 0, 10)}</span>
            </div>
            <div class="mobile-detail-row">
              <span class="label">الطلبات</span>
              <span class="value">${orderRolls} توب / ${orderCount} طلبات</span>
            </div>
          </div>
        </td>
        <td class="cell-color-code">${escapeHtml(r.color_code)}</td>
        <td class="cell-color-name">${escapeHtml(r.color_name)}</td>
        <td class="cell-main-balance"><span class="stock-number-strong">${Number(r.balance_main || 0).toFixed(3)} ${escapeHtml(unitLabel(r.unit_type))}</span></td>
        <td class="cell-rolls-balance"><span class="stock-number-strong">${parseInt(r.balance_rolls || 0, 10)}</span></td>
        <td>${renderOrdersCell(r, preordersByItem)}</td>
        <td class="cell-actions">
          <div class="inventory-row-actions">
            <button type="button" class="secondary" data-act="view-orders" data-id="${escapeHtml(r.id)}">الطلبات (${orderCount})</button>
            <button type="button" class="secondary" data-act="view-moves" data-id="${escapeHtml(r.id)}">حركة المادة</button>
            ${
              canWrite || isAdmin
                ? `
            <button type="button" class="secondary inventory-menu-toggle" data-action-menu aria-label="إجراءات المادة: ${escapeHtml(materialLabel(r))}" aria-haspopup="menu" aria-expanded="false" aria-controls="inventory-actions-${escapeHtml(r.id)}">⋮</button>
            <div id="inventory-actions-${escapeHtml(r.id)}" class="inventory-actions-menu" role="menu" aria-label="إجراءات المادة" popover="manual" hidden>
              ${isAdmin ? `<button type="button" class="secondary" role="menuitem" tabindex="-1" data-act="edit-item" data-id="${escapeHtml(r.id)}">تعديل المادة</button>` : ''}
              ${canWrite ? `<button type="button" class="secondary" role="menuitem" tabindex="-1" data-act="adjust-item" data-id="${escapeHtml(r.id)}">تسوية المادة</button>` : ''}
              ${isAdmin ? `<button type="button" class="${r.is_active ? 'danger' : 'secondary'}" role="menuitem" tabindex="-1" data-act="toggle-item-status" data-id="${escapeHtml(r.id)}" ${itemStatusBusy ? 'disabled' : ''}>${r.is_active ? 'إيقاف المادة' : 'تفعيل المادة'}</button>` : ''}
              ${canWrite ? `<a href="sales.html?item=${encodeURIComponent(r.id)}" role="menuitem" tabindex="-1">+ بيع</a><a href="purchases.html?item=${encodeURIComponent(r.id)}" role="menuitem" tabindex="-1">+ شراء</a>` : ''}
            </div>`
                : ''
            }
          </div>
        </td>
      </tr>
    `;
      })
      .join('');
  }
  function metricsHtml(rows) {
    const totals = stockTotals(rows);
    return [
      ['المواد المعروضة', totals.items],
      ['رصيد الأثواب', totals.rolls],
      ['طلبات قائمة / أثواب', totals.reserved],
      ['الرصيد بالكيلو', totals.kg],
      ['الرصيد بالمتر', totals.m],
    ]
      .map(
        ([label, value]) =>
          `<div><span>${label}</span><strong>${Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })}</strong></div>`,
      )
      .join('');
  }
  function movesHtml(data, unitType) {
    let runningMain = data.reduce(
      (n, m) => n + Number(m.qty_main_in || 0) - Number(m.qty_main_out || 0),
      0,
    );
    let runningRolls = data.reduce(
      (n, m) => n + Number(m.qty_rolls_in || 0) - Number(m.qty_rolls_out || 0),
      0,
    );

    const movesRows = data.map((m) => {
      const deltaMain = Number(m.qty_main_in || 0) - Number(m.qty_main_out || 0);
      const deltaRolls = Number(m.qty_rolls_in || 0) - Number(m.qty_rolls_out || 0);
      const html = `
        <tr>
          <td>${escapeHtml(formatDate(m.move_date))}</td>
          <td>${m.entry_group_id ? `<a href="${m.type === 'purchase' ? 'purchases' : 'sales'}-review.html?group=${encodeURIComponent(m.entry_group_id)}">${escapeHtml(moveTypeLabel(m.type))} ←</a>` : escapeHtml(moveTypeLabel(m.type))}</td>
          <td>${deltaMain.toFixed(3)} ${escapeHtml(unitLabel(unitType))}</td>
          <td>${deltaRolls}</td>
          <td>${runningMain.toFixed(3)} ${escapeHtml(unitLabel(unitType))} / ${runningRolls} توب</td>
          <td>${escapeHtml(m.note || '-')}</td>
        </tr>
      `;
      runningMain -= deltaMain;
      runningRolls -= deltaRolls;
      return html;
    });

    return movesRows.length
      ? movesRows.join('')
      : `<tr><td colspan="6">لا توجد حركات لهذا الصنف.</td></tr>`;
  }
  function ordersHtml(details) {
    if (!details.length) return `<tr><td colspan="6">لا توجد طلبات قائمة لهذه المادة.</td></tr>`;
    return details
      .map(
        (d) => `
    <tr>
      <td>${escapeHtml(formatDate(d.created_at))}</td>
      <td>${escapeHtml(d.customer_name || '-')}</td>
      <td>${parseInt(d.qty_rolls || 0, 10)}</td>
      <td>${d.status === 'pending_sale' ? 'بانتظار المبيعات' : d.status === 'confirmed' ? 'مؤكد' : 'مسودة'}</td>
      <td><a class="secondary" style="display:inline-block;width:auto;padding:6px 10px;text-decoration:none;" href="./orders.html?id=${encodeURIComponent(d.order_id)}" target="_blank" rel="noopener">عرض الطلب</a></td>
      <td>${escapeHtml(d.note || '-')}</td>
    </tr>
  `,
      )
      .join('');
  }
  return { summaryText, rowsHtml, metricsHtml, movesHtml, ordersHtml };
}
