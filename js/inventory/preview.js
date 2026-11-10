import { escapeHtml } from '../core/text-utils.js';

export function inventoryPreviewHtml(sourceTable) {
  const table = sourceTable.cloneNode(true);
  for (const row of table.rows) row.deleteCell(-1);
  for (const image of table.querySelectorAll('img')) {
    image.src = new URL(image.getAttribute('src'), sourceTable.baseURI).href;
    image.alt = 'صورة المادة';
    image.removeAttribute('loading');
    image.removeAttribute('data-full');
  }

  const stylesheets = [...sourceTable.ownerDocument.querySelectorAll('link[rel="stylesheet"]')]
    .map((link) => `<link rel="stylesheet" href="${escapeHtml(link.href)}">`)
    .join('\n');
  const origin = new URL(sourceTable.baseURI).origin;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline' ${escapeHtml(origin)}; font-src ${escapeHtml(origin)} data:; base-uri 'none'">
  <meta name="referrer" content="no-referrer">
  <title>معاينة الجرد | ADLATEX</title>
  ${stylesheets}
  <style>
    .stock-preview-heading { margin-block: 16px; }
    @media print {
      @page { size: A4 landscape; margin: 10mm; }
      body { margin: 0; print-color-adjust: exact; }
      .container { width: 100%; max-width: none; padding: 0; }
      .inventory-list-card, .inventory-table.tableWrap {
        overflow: visible;
        max-height: none;
        padding: 0;
        border: 0;
        box-shadow: none;
      }
      .inventory-table > table { display: table; width: 100%; min-width: 0; font-size: 10pt; }
      .inventory-table > table > thead { display: table-header-group; }
      .inventory-table > table > tbody { display: table-row-group; }
      .inventory-table .inventory-row {
        display: table-row;
        position: static;
        break-inside: avoid;
      }
      .inventory-table .inventory-row > td, .inventory-table th {
        display: table-cell;
        padding: 5px;
        border-bottom: 1px solid #ddd;
      }
      .inventory-table th { position: static; }
      .inventory-table .cell-image .thumb { width: 44px; height: 44px; }
      .inventory-table .material-main-line { display: block; }
      .inventory-table .mobile-details, .inventory-table .material-color-line { display: none; }
    }
  </style>
</head>
<body class="ui-page">
  <main class="container">
    <h1 class="stock-preview-heading">جرد المخزون · ADLATEX</h1>
    <div class="card inventory-list-card">
      <div class="tableWrap inventory-table">${table.outerHTML}</div>
    </div>
  </main>
</body>
</html>`;
}
