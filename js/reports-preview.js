import { supabase } from './supabaseRaw.js';
import { checkAccess } from './auth-core.js';
import { canView } from './permissions.js';
import { buildHeader } from './site-header.js';
import { escapeHtml as esc, materialLabel } from './core/text-utils.js';
import { thumbnailPath } from './image-variants.js';
const unitLabel = (unit) => (unit === 'kg' ? 'كغ' : unit === 'm' ? 'متر' : '');
const getThumbnailImageUrl = (path) =>
  path
    ? supabase.storage.from('item-images').getPublicUrl(thumbnailPath(path)).data?.publicUrl || ''
    : '';

const $ = (id) => document.getElementById(id);
const type = document.body.dataset.reportType;
const section = type === 'sale' ? 'sales' : 'purchases';
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const z2 = (n) => String(n).padStart(2, '0');
const localDay = (d) => d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate());
const safe = (s) => esc(String(s ?? ''));
const sources = {
  manual: 'إدخال يدوي',
  excel: 'Excel',
  import: 'استيراد متقدم',
  legacy: 'بيانات قديمة',
};
let groups = [],
  moves = [],
  groupIndex = new Map(),
  orderIndex = new Map(),
  mode = 'groups';
let page = 0,
  filteredGroups = [],
  filteredMoves = [],
  displayRows = [];
const expanded = new Set();
const perPage = 20;
const defaultTitle = type === 'sale' ? 'مجموعة مبيعات' : 'مجموعة مشتريات';

function status(message = '', error = false) {
  $('loadStatus').textContent = message;
  $('loadStatus').classList.toggle('error', error);
}
function dateStamp(s) {
  if (!s) return 'غير مسجل';
  const d = new Date(s);
  return Number.isFinite(d.valueOf())
    ? d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
    : 'غير مسجل';
}
function getMain(m) {
  return type === 'sale' ? Number(m.qty_main_out || 0) : Number(m.qty_main_in || 0);
}
function getRolls(m) {
  return type === 'sale' ? Number(m.qty_rolls_out || 0) : Number(m.qty_rolls_in || 0);
}
function itemName(m) {
  return m.items ? materialLabel(m.items) : 'مادة غير متاحة';
}
function title(g) {
  if (!g) return defaultTitle;
  return g.note || g.source_file_name || defaultTitle + ' #' + g.id.slice(0, 8).toUpperCase();
}
function unit(m) {
  return m.items?.unit_type || 'other';
}
function totals(lines) {
  const u = new Map();
  let rolls = 0;
  for (const m of lines) {
    const k = unit(m);
    u.set(k, (u.get(k) || 0) + getMain(m));
    rolls += getRolls(m);
  }
  return { u, rolls };
}
function unitText(t) {
  return [...t.u].map(([u, n]) => fmt(n) + ' ' + (unitLabel(u) || 'وحدة')).join(' / ') || '0';
}
function showThumb(m) {
  const u = m.items?.image_path ? getThumbnailImageUrl(m.items.image_path) : '';
  return u
    ? '<img class="item-thumb" alt="" loading="lazy" src="' + safe(u) + '">'
    : '<div class="item-fallback">▦</div>';
}
function itemCell(m) {
  return (
    '<div class="item-inline">' +
    showThumb(m) +
    '<div class="item-copy"><span class="primary">' +
    safe(itemName(m)) +
    '</span><span class="muted">' +
    safe(m.items?.color_code || '') +
    ' · ' +
    safe(m.items?.color_name || '') +
    '</span></div></div>'
  );
}
function rollDisplay(lines) {
  return fmt(totals(lines).rolls);
}
function quantityDisplay(lines) {
  return safe(unitText(totals(lines)));
}
function setPeriod(value) {
  const now = new Date(),
    a = new Date(now),
    b = new Date(now);
  if (value === 'today') {
    a.setDate(now.getDate());
  } else if (value === 'yesterday') {
    a.setDate(a.getDate() - 1);
    b.setDate(b.getDate() - 1);
  } else if (value === 'month') {
    a.setDate(1);
  } else if (value === 'last-month') {
    a.setDate(1);
    a.setMonth(a.getMonth() - 1);
    b.setDate(0);
  } else if (['7', '10', '30'].includes(value)) {
    a.setDate(a.getDate() - Number(value) + 1);
  } else if (value === 'custom') {
    document
      .querySelectorAll('[data-period]')
      .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === value)));
    $('fromDate').focus();
    return;
  }
  $('fromDate').value = localDay(a);
  $('toDate').value = localDay(b);
  document
    .querySelectorAll('[data-period]')
    .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === value)));
  page = 0;
  render();
}
async function allRows(build) {
  const out = [];
  for (let from = 0; from < 1000000; from += 500) {
    const { data, error } = await build().range(from, from + 499);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 500) return out;
  }
  throw new Error('عدد الحركات تجاوز الحد الآمن للتحميل.');
}
async function load() {
  $('refresh').disabled = true;
  status('تحميل بيانات ' + (type === 'sale' ? 'المبيعات' : 'المشتريات') + '…');
  try {
    const [g, m] = await Promise.all([
      allRows(() =>
        supabase
          .from('stock_entry_groups')
          .select('id,type,source,created_at,created_by_name,note,source_file_name,deleted_at')
          .eq('type', type)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      ),
      allRows(() =>
        supabase
          .from('stock_moves')
          .select(
            'id,entry_group_id,item_id,move_date,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out,items(id,main_category,sub_category,item_name,color_code,color_name,unit_type,image_path)',
          )
          .eq('type', type)
          .order('move_date', { ascending: false }),
      ),
    ]);
    groups = g;
    moves = m;
    groupIndex = new Map(groups.map((x) => [x.id, x]));
    orderIndex = new Map();
    for (const m of moves) {
      if (!m.entry_group_id || !groupIndex.has(m.entry_group_id)) continue;
      if (!orderIndex.has(m.entry_group_id)) orderIndex.set(m.entry_group_id, []);
      orderIndex.get(m.entry_group_id).push(m);
    }
    fillOptions();
    expanded.clear();
    page = 0;
    render();
    status(
      'آخر تحديث: ' +
        new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    );
  } catch (e) {
    status('تعذر قراءة البيانات: ' + (e.message || String(e)), true);
    $('reportResult').innerHTML =
      '<div class="empty-state"><strong>تعذّر تحميل التقرير</strong>تحقق من الاتصال وصلاحية حسابك ثم أعد المحاولة.</div>';
    $('stats').replaceChildren();
  } finally {
    $('refresh').disabled = false;
  }
}
function fillOptions() {
  const main = $('mainCategory').value,
    sub = $('subCategory').value,
    emp = $('employee').value;
  const categories = [...new Set(moves.map((m) => m.items?.main_category).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'ar'),
  );
  $('mainCategory').innerHTML =
    '<option value="">كل المجموعات</option>' +
    categories.map((x) => '<option value="' + safe(x) + '">' + safe(x) + '</option>').join('');
  $('mainCategory').value = categories.includes(main) ? main : '';
  fillSubs(sub);
  const staff = [...new Set(groups.map((g) => g.created_by_name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ar'),
  );
  $('employee').innerHTML =
    '<option value="">جميع الموظفين</option>' +
    staff.map((x) => '<option value="' + safe(x) + '">' + safe(x) + '</option>').join('');
  $('employee').value = staff.includes(emp) ? emp : '';
}
function fillSubs(wanted = '') {
  const cat = $('mainCategory').value;
  const subs = [
    ...new Set(
      moves
        .filter((m) => !cat || m.items?.main_category === cat)
        .map((m) => m.items?.sub_category)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ar'));
  $('subCategory').innerHTML =
    '<option value="">كل الفروع</option>' +
    subs.map((x) => '<option value="' + safe(x) + '">' + safe(x) + '</option>').join('');
  $('subCategory').value = subs.includes(wanted) ? wanted : '';
}
function within(d, from, to) {
  return !!d && (!from || d >= from) && (!to || d <= to);
}
function applyFilters() {
  const from = $('fromDate').value,
    to = $('toDate').value;
  const basis = $('dateBasis').value;
  const query = $('search').value.trim().toLocaleLowerCase();
  const cat = $('mainCategory').value,
    sub = $('subCategory').value,
    employee = $('employee').value,
    source = $('source').value;
  if (from && to && from > to) {
    status('تاريخ البداية بعد تاريخ النهاية؛ عدّل الفترة.', true);
    return false;
  }
  filteredMoves = moves.filter((m) => {
    const g = groupIndex.get(m.entry_group_id);
    if (!g) return false;
    if (source && g.source !== source) return false;
    if (employee && g.created_by_name !== employee) return false;
    if (cat && m.items?.main_category !== cat) return false;
    if (sub && m.items?.sub_category !== sub) return false;
    const date = basis === 'entry' ? localDay(new Date(g.created_at)) : m.move_date;
    if (!within(date, from, to)) return false;
    if (!query) return true;
    const hay = [
      itemName(m),
      m.items?.color_code,
      m.items?.color_name,
      m.items?.main_category,
      m.items?.sub_category,
      m.note,
      g.note,
      g.source_file_name,
      g.created_by_name,
      g.id,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return hay.includes(query);
  });
  filteredGroups = [...new Set(filteredMoves.map((m) => m.entry_group_id))]
    .map((id) => groupIndex.get(id))
    .filter(Boolean);
  return true;
}
function renderStats() {
  const t = totals(filteredMoves);
  const stat = [
    ['المجموعات', fmt(filteredGroups.length), ''],
    ['بنود الحركة', fmt(filteredMoves.length), ''],
    ['إجمالي الوزن', fmt(t.u.get('kg') || 0), 'كغ'],
    ['إجمالي الأطوال', fmt(t.u.get('m') || 0), 'متر'],
    ['إجمالي الأثواب', fmt(t.rolls), 'ثوب'],
  ];
  $('stats').innerHTML = stat
    .map(
      ([name, val, unit]) =>
        '<article class="stat"><small>' +
        name +
        '</small><strong>' +
        val +
        ' <span class="unit">' +
        unit +
        '</span></strong></article>',
    )
    .join('');
}
function buildItems() {
  const map = new Map();
  for (const m of filteredMoves) {
    const k = m.item_id || m.id;
    let r = map.get(k);
    if (!r) {
      r = { key: k, m, lines: [], last: '' };
      map.set(k, r);
    }
    r.lines.push(m);
    if (m.move_date > r.last) r.last = m.move_date;
  }
  return [...map.values()];
}
function sorted(arr, getInfo) {
  const sort = $('sort').value;
  return arr.sort((a, b) => {
    const x = getInfo(a),
      y = getInfo(b);
    if (sort === 'rolls') return y.rolls - x.rolls || y.date.localeCompare(x.date);
    if (sort === 'qty') return y.quantity - x.quantity || y.date.localeCompare(x.date);
    if (sort === 'name') return x.name.localeCompare(y.name, 'ar');
    return y.date.localeCompare(x.date) || x.name.localeCompare(y.name, 'ar');
  });
}
function buildRows() {
  if (mode === 'groups') {
    displayRows = sorted(filteredGroups.slice(), (g) => {
      const lines = filteredMoves.filter((m) => m.entry_group_id === g.id);
      return {
        date:
          $('dateBasis').value === 'entry'
            ? g.created_at || ''
            : lines.reduce((z, m) => (m.move_date > z ? m.move_date : z), ''),
        quantity: lines.reduce((z, m) => z + getMain(m), 0),
        rolls: lines.reduce((z, m) => z + getRolls(m), 0),
        name: title(g),
      };
    });
  } else
    displayRows = sorted(buildItems(), (r) => ({
      date: r.last,
      quantity: r.lines.reduce((z, m) => z + getMain(m), 0),
      rolls: r.lines.reduce((z, m) => z + getRolls(m), 0),
      name: itemName(r.m),
    }));
}
function groupDetail(lines) {
  return (
    '<table class="mini-table"><thead><tr><th>الصنف واللون</th><th>تاريخ الحركة</th><th>الكمية</th><th>الأثواب</th><th>ملاحظة</th></tr></thead><tbody>' +
    lines
      .map(
        (m) =>
          '<tr><td>' +
          itemCell(m) +
          '</td><td>' +
          safe(m.move_date || '—') +
          '</td><td>' +
          fmt(getMain(m)) +
          ' ' +
          safe(unitLabel(unit(m)) || 'وحدة') +
          '</td><td>' +
          fmt(getRolls(m)) +
          '</td><td>' +
          safe(m.note || '—') +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table>'
  );
}
function itemDetail(lines) {
  return (
    '<table class="mini-table"><thead><tr><th>تاريخ الحركة</th><th>المجموعة / المرجع</th><th>الموظف</th><th>الكمية</th><th>الأثواب</th></tr></thead><tbody>' +
    lines
      .slice()
      .sort((a, b) => b.move_date.localeCompare(a.move_date))
      .map((m) => {
        const g = groupIndex.get(m.entry_group_id);
        return (
          '<tr><td>' +
          safe(m.move_date) +
          '</td><td>' +
          safe(title(g)) +
          '</td><td>' +
          safe(g?.created_by_name || 'غير مسجل') +
          '</td><td>' +
          fmt(getMain(m)) +
          ' ' +
          safe(unitLabel(unit(m)) || 'وحدة') +
          '</td><td>' +
          fmt(getRolls(m)) +
          '</td></tr>'
        );
      })
      .join('') +
    '</tbody></table>'
  );
}
function renderGroups(rows) {
  return (
    '<div class="report-table-wrap"><table class="report-table"><thead><tr><th>المجموعة / المرجع</th><th>تاريخ العملية</th><th>الموظف</th><th>المصدر</th><th class="num">الأصناف</th><th class="num">الكميات</th><th class="num">الأثواب</th><th></th></tr></thead><tbody>' +
    rows
      .map((g) => {
        const lines = filteredMoves.filter((m) => m.entry_group_id === g.id);
        const key = 'g' + g.id;
        const dates = [...new Set(lines.map((x) => x.move_date))].sort();
        const date =
          $('dateBasis').value === 'entry'
            ? dateStamp(g.created_at)
            : (dates.length === 1 ? dates[0] : dates[0] + ' ← ' + dates[dates.length - 1]) || '—';
        const open = expanded.has(key);
        return (
          '<tr><td><span class="primary">' +
          safe(title(g)) +
          '</span><span class="muted">#' +
          safe(g.id.slice(0, 8).toUpperCase()) +
          '</span></td><td class="slim">' +
          safe(date) +
          '</td><td>' +
          safe(g.created_by_name || 'غير مسجل') +
          '</td><td><span class="source-pill">' +
          safe(sources[g.source] || g.source || '—') +
          '</span></td><td class="num">' +
          fmt(lines.length) +
          '</td><td class="num">' +
          quantityDisplay(lines) +
          '</td><td class="num">' +
          rollDisplay(lines) +
          '</td><td><button type="button" class="detail-btn" data-expand="' +
          safe(key) +
          '" aria-expanded="' +
          open +
          '">' +
          (open ? 'إخفاء' : 'التفاصيل') +
          '</button></td></tr>' +
          (open
            ? '<tr class="report-detail-row"><td colspan="8">' + groupDetail(lines) + '</td></tr>'
            : '')
        );
      })
      .join('') +
    '</tbody></table></div>'
  );
}
function renderItems(rows) {
  return (
    '<div class="report-table-wrap"><table class="report-table"><thead><tr><th>المادة واللون</th><th>المجموعة</th><th>آخر حركة</th><th class="num">الحركات</th><th class="num">الكمية</th><th class="num">الأثواب</th><th></th></tr></thead><tbody>' +
    rows
      .map((r) => {
        const m = r.m,
          key = 'i' + r.key,
          open = expanded.has(key);
        return (
          '<tr><td>' +
          itemCell(m) +
          '</td><td>' +
          safe(m.items?.main_category || '—') +
          '<span class="muted">' +
          safe(m.items?.sub_category || '') +
          '</span></td><td>' +
          safe(r.last || '—') +
          '</td><td class="num">' +
          fmt(r.lines.length) +
          '</td><td class="num">' +
          quantityDisplay(r.lines) +
          '</td><td class="num">' +
          rollDisplay(r.lines) +
          '</td><td><button type="button" class="detail-btn" data-expand="' +
          safe(key) +
          '" aria-expanded="' +
          open +
          '">' +
          (open ? 'إخفاء' : 'التفاصيل') +
          '</button></td></tr>' +
          (open
            ? '<tr class="report-detail-row"><td colspan="7">' + itemDetail(r.lines) + '</td></tr>'
            : '')
        );
      })
      .join('') +
    '</tbody></table></div>'
  );
}
function render() {
  if (!applyFilters()) return;
  renderStats();
  buildRows();
  const max = Math.max(1, Math.ceil(displayRows.length / perPage));
  page = Math.min(Math.max(0, page), max - 1);
  const rows = displayRows.slice(page * perPage, (page + 1) * perPage);
  $('reportResult').innerHTML = displayRows.length
    ? mode === 'groups'
      ? renderGroups(rows)
      : renderItems(rows)
    : '<div class="empty-state"><strong>لا توجد حركات مطابقة</strong>يمكنك تغيير الفترة أو إزالة بعض الفلاتر.</div>';
  $('pageInfo').textContent = page + 1 + ' / ' + max;
  $('prevPage').disabled = page === 0;
  $('nextPage').disabled = page >= max - 1;
  $('resultCount').textContent =
    fmt(displayRows.length) +
    ' ' +
    (mode === 'groups' ? 'مجموعة' : 'صنف') +
    ' · ' +
    fmt(filteredMoves.length) +
    ' بند';
}
function csvEscape(value) {
  let t = String(value ?? '');
  // Prevent spreadsheet formula injection from notes or material names.
  if (/^[=+@\-\t\r]/.test(t)) t = "'" + t;
  return '"' + t.replaceAll('"', '""') + '"';
}
function downloadCsv() {
  if (!displayRows.length) return;
  let data;
  if (mode === 'groups') {
    data = [
      [
        'رقم المجموعة',
        'المرجع',
        'تاريخ الإدخال',
        'الموظف',
        'المصدر',
        'تاريخ الحركة',
        'الصنف',
        'كود اللون',
        'اسم اللون',
        'الوحدة',
        'الكمية',
        'الأثواب',
        'ملاحظة البند',
      ],
    ];
    for (const g of displayRows)
      for (const m of filteredMoves.filter((x) => x.entry_group_id === g.id)) {
        data.push([
          g.id,
          title(g),
          g.created_at,
          g.created_by_name || '',
          sources[g.source] || g.source,
          m.move_date,
          itemName(m),
          m.items?.color_code,
          m.items?.color_name,
          unitLabel(unit(m)),
          getMain(m),
          getRolls(m),
          m.note || '',
        ]);
      }
  } else {
    data = [
      [
        'الصنف',
        'كود اللون',
        'اسم اللون',
        'المجموعة الرئيسية',
        'المجموعة الفرعية',
        'الوحدة',
        'إجمالي الكمية',
        'إجمالي الأثواب',
        'عدد الحركات',
        'آخر حركة',
      ],
    ];
    for (const r of displayRows)
      data.push([
        itemName(r.m),
        r.m.items?.color_code,
        r.m.items?.color_name,
        r.m.items?.main_category,
        r.m.items?.sub_category,
        unitLabel(unit(r.m)),
        r.lines.reduce((x, m) => x + getMain(m), 0),
        r.lines.reduce((x, m) => x + getRolls(m), 0),
        r.lines.length,
        r.last,
      ]);
  }
  const blob = new Blob(['\uFEFF' + data.map((r) => r.map(csvEscape).join(',')).join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    (type === 'sale' ? 'sales' : 'purchases') + '-report-' + localDay(new Date()) + '.csv';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bind() {
  $('refresh').onclick = load;
  $('print').onclick = () => window.print();
  $('downloadCsv').onclick = downloadCsv;
  $('prevPage').onclick = () => {
    page--;
    render();
    window.scrollTo({ top: $('stats').offsetTop - 90, behavior: 'smooth' });
  };
  $('nextPage').onclick = () => {
    page++;
    render();
    window.scrollTo({ top: $('stats').offsetTop - 90, behavior: 'smooth' });
  };
  $('periods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]');
    if (b) setPeriod(b.dataset.period);
  });
  $('applyDate').onclick = () => {
    document
      .querySelectorAll('[data-period]')
      .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === 'custom')));
    page = 0;
    render();
  };
  $('reportResult').addEventListener('click', (e) => {
    const b = e.target.closest('[data-expand]');
    if (!b) return;
    const k = b.dataset.expand;
    expanded.has(k) ? expanded.delete(k) : expanded.add(k);
    render();
  });
  document.querySelectorAll('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        mode = b.dataset.mode;
        page = 0;
        expanded.clear();
        document
          .querySelectorAll('[data-mode]')
          .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        render();
      }),
  );
  for (const id of ['search', 'subCategory', 'employee', 'source', 'dateBasis', 'sort'])
    $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
      page = 0;
      render();
    });
  $('mainCategory').addEventListener('change', () => {
    fillSubs();
    page = 0;
    render();
  });
  for (const id of ['fromDate', 'toDate'])
    $(id).addEventListener('change', () => {
      document
        .querySelectorAll('[data-period]')
        .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === 'custom')));
      page = 0;
      render();
    });
}

function gate(message, retry = false) {
  const target = $('authGate');
  target.replaceChildren();
  const text = document.createElement('p');
  text.textContent = message;
  target.append(text);
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'إعادة المحاولة';
    btn.onclick = () => start();
    target.append(btn);
  }
}
function inlineSignIn() {
  const target = $('authGate');
  target.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'تسجيل الدخول لعرض التقرير';
  const intro = document.createElement('p');
  intro.textContent = 'سجّل الدخول بحساب BALANCE المعتاد، دون مغادرة هذه الصفحة.';
  const form = document.createElement('form');
  form.style.cssText = 'display:grid;gap:10px;max-width:340px;margin:auto;';
  const labelEmail = document.createElement('label');
  labelEmail.textContent = 'البريد الإلكتروني';
  const email = document.createElement('input');
  email.type = 'email';
  email.required = true;
  email.autocomplete = 'username';
  email.dir = 'ltr';
  labelEmail.append(email);
  const labelPassword = document.createElement('label');
  labelPassword.textContent = 'كلمة المرور';
  const password = document.createElement('input');
  password.type = 'password';
  password.required = true;
  password.autocomplete = 'current-password';
  password.dir = 'ltr';
  labelPassword.append(password);
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'الدخول إلى التقرير';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  form.append(labelEmail, labelPassword, button, message);
  form.onsubmit = async (e) => {
    e.preventDefault();
    button.disabled = true;
    message.textContent = 'جارٍ التحقق من الحساب…';
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value,
      });
      if (error) {
        message.textContent = 'تعذر الدخول. تحقق من بيانات الحساب ثم أعد المحاولة.';
        return;
      }
      password.value = '';
      await start();
    } catch (err) {
      message.textContent = 'تعذر الاتصال: ' + (err.message || String(err));
    } finally {
      button.disabled = false;
    }
  };
  target.append(heading, intro, form);
}
let initialized = false;
async function start() {
  try {
    const access = await checkAccess(supabase, { localSession: true });
    if (!access.ok) {
      if (access.reason === 'signin') inlineSignIn();
      else if (access.reason === 'access') gate('هذا الحساب ليس مفعلًا لاستخدام BALANCE.');
      else gate('تعذر التحقق من الحساب. تحقق من الاتصال وأعد المحاولة.', true);
      return;
    }
    if (!canView(access.member, section)) {
      gate('حسابك ليس مخولًا بعرض تقرير ' + (type === 'sale' ? 'المبيعات' : 'المشتريات') + '.');
      return;
    }
    document.documentElement.removeAttribute('data-auth-pending');
    if (!initialized) {
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.textContent = 'تسجيل الخروج';
      logout.onclick = async () => {
        await supabase.auth.signOut({ scope: 'local' });
        location.replace('login.html');
      };
      buildHeader(access, logout);
      bind();
      initialized = true;
    }
    setPeriod('30');
    await load();
  } catch (err) {
    gate('تعذر عرض التقرير: ' + (err.message || String(err)), true);
  }
}
start();
