import { escapeHtml as esc } from '../core/text-utils.js';

export function inventoryPreviewHtml(
  rows,
  { materialLabel, unitLabel, getThumbnailImageUrl, preordersByItem },
) {
  const cards = rows
    .map((row) => {
      const image = row.image_path && getThumbnailImageUrl(row.image_path);
      const orders = preordersByItem.get(String(row.id));
      const orderCount = Number(orders?.count || 0);
      const reserved = Number(orders?.totalRolls || 0);
      const orderText = orderCount ? `${orderCount} طلب · ${reserved} ثوب محجوز` : 'لا توجد طلبات';
      const color = [row.color_code, row.color_name].filter(Boolean).join(' · ') || '—';
      return `<article>
      ${image ? `<img src="${esc(image)}" alt="">` : '<div class="photo-placeholder">بدون صورة</div>'}
      <div class="info">
        <strong>${esc(materialLabel(row))}</strong>${row.is_active ? '' : ' <small>موقوف</small>'}
        <small>اللون <bdi>${esc(color)}</bdi></small>
      </div>
      <div class="metrics">
        <div><span class="metric-label">الكمية</span><bdi>${Number(row.balance_main || 0).toFixed(3)}</bdi><small>${esc(unitLabel(row.unit_type))}</small></div>
        <div><span class="metric-label">الرصيد</span><bdi>${Number(row.balance_rolls || 0)}</bdi><small>ثوب</small></div>
        <div class="orders"><span class="metric-label">الطلبات</span><span>${orderText}</span><small>المتبقي بعد الطلبات <bdi>${Number(row.balance_after_orders ?? row.balance_rolls ?? 0)}</bdi> ثوب</small></div>
      </div>
    </article>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'">
<meta name="referrer" content="no-referrer">
<title>معاينة المخزون | ADLATEX</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f2f5f6;color:#142d3b;font:15px/1.6 system-ui,Arial,sans-serif}
main{max-width:820px;margin:24px auto;padding:28px 32px;background:white;border-radius:16px}
header{margin-bottom:14px}h1{font-size:26px;margin:0}
header p{margin:0;color:#007b78;font-size:12px;font-weight:700;letter-spacing:.16em}
.tag,small{display:block;font-size:12px;color:#526975}
article{display:grid;grid-template-columns:140px minmax(0,1fr);gap:9px 17px;padding:16px 0;border-top:1px solid #e7edef;align-content:center}
article :is(img,.photo-placeholder){grid-row:span 2;width:140px;height:140px;object-fit:cover;border-radius:10px}
.info strong{font-size:16px}
.metrics{display:grid;grid-template-columns:1fr 1fr 1.6fr;align-items:stretch;background:#f5f8f9;border-radius:8px;text-align:center;padding-block:6px}
.metrics>div{padding:2px 6px}.metrics>div+div{border-inline-start:1px solid #dfe8ec}
.metric-label{display:block;color:#526975;font-size:11px}
.metrics>div>bdi{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.orders{font-size:12px}
@media screen and (max-width:550px){
main{margin:0;padding:16px}article{grid-template-columns:100px minmax(0,1fr);gap:9px 12px;align-items:center}
article :is(img,.photo-placeholder){width:100px;height:100px;grid-row:auto}.metrics{grid-column:1/-1}
}
@media print{@page{margin:12mm}body{background:white}main{margin:0;padding:0;max-width:none}article{break-inside:avoid}}

.photo-placeholder{display:grid;place-items:center;background:#f5f8f9;color:#526975;font-size:12px}
</style>
</head>
<body><main><header><h1>معاينة المخزون</h1><p>ADLATEX</p></header>
${cards}
</main></body></html>`;
}
