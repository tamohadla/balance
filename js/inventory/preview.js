export function inventoryPreviewHtml(sourceTable) {
  const table = sourceTable.cloneNode(true);
  for (const row of table.rows) row.deleteCell(-1);
  for (const node of table.querySelectorAll('.material-color-line, .mobile-details')) {
    node.remove();
  }
  for (const image of table.querySelectorAll('img')) {
    image.src = new URL(image.getAttribute('src'), sourceTable.baseURI).href;
    image.alt = 'صورة المادة';
    image.removeAttribute('loading');
    image.removeAttribute('data-full');
  }

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'">
  <meta name="referrer" content="no-referrer">
  <title>معاينة الجرد | ADLATEX</title>
  <style>
    body { font: 14px/1.5 system-ui, sans-serif; color: #182b36; margin: 16px; }
    main { max-width: 1100px; margin-inline: auto; }
    h1 { font-size: 20px; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #b8c5cc; padding: 6px; text-align: start; }
    th { background: #eef3f6; }
    img { display: block; width: 52px; height: 52px; object-fit: cover; }
    .inactive-badge { margin-inline-start: .4em; }
    @media print {
      @page { margin: 10mm; }
      body { margin: 0; font-size: 10pt; }
      .table-wrap { overflow: visible; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main>
    <h1>جرد المخزون · ADLATEX</h1>
    <div class="table-wrap">${table.outerHTML}</div>
  </main>
</body>
</html>`;
}
