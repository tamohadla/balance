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
      @page { margin: 10mm; }
      body { margin: 0; }
      .inventory-table.tableWrap { overflow: visible; max-height: none; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
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
