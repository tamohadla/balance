import {createReconciliationClient,mountReconciliationRecovery,reconciliationError} from "./reconciliation-service.js?v=workspace-2";
import {canManage} from './permissions.js?v=workspace-2';
import {openImageViewer} from "./image-viewer.js?v=workspace-2";
import {comparePurchases} from "./purchase-sort.js";
import { readStock, readItemMoves } from "./inventory-data.js?v=workspace-2";
import {
  stockMatches,
  stockTotals,
  STOCK_FILTERS,
  csvCell,
} from "./inventory-model.js?v=workspace-2";
import { requireAccess } from "./auth-guard.js?v=workspace-2";
const access = await requireAccess();
const canWrite = canManage(access.member,'inventory')||canManage(access.member,'adjustments');
const isAdmin = !!access.member?.is_active && access.member.role === 'admin';
let itemStatusBusy = false;
const viewKey="inventory-view:"+access.user.id;
let savedView=null;
try{savedView=JSON.parse(sessionStorage.getItem(viewKey)||"null");}catch{}
const initialUrl=new URL(location.href);
if(!initialUrl.search&&savedView?.query)initialUrl.search=savedView.query;
if(initialUrl.search!==location.search)history.replaceState(null,"",initialUrl);
const initialParams=initialUrl.searchParams;
let restoreScroll=savedView?.query===initialUrl.search?Number(savedView.scroll||0):0;
let movesVersion=0;
function saveView(){try{sessionStorage.setItem(viewKey,JSON.stringify({query:location.search,scroll:window.scrollY}));}catch{}}
window.addEventListener("pagehide",saveView);
let snapshot = null,
  visibleRows = [],
  loading = false,
  adjustBusy = false;
import { supabase } from "./supabaseClient.js?v=workspace-2";
import {
  $,
  escapeHtml,
  setMsg,
  materialLabel,
  getPublicImageUrl,
  getThumbnailImageUrl,
  unitLabel,
  todayISO,
  keysLookUnchanged,
  testSupabaseConnection,
  explainSupabaseError,
} from "./shared.js?v=workspace-2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js?v=workspace-2";

let LOW_STOCK_ROLLS_THRESHOLD = Number(initialParams.get("threshold")) || 10;
LOW_STOCK_ROLLS_THRESHOLD = Math.min(
  100000,
  Math.max(1, LOW_STOCK_ROLLS_THRESHOLD),
);

const msg = $("msg");
const reconciliationClient=createReconciliationClient({userId:access.user.id,scope:"single"});
const refreshReconciliationRecovery=mountReconciliationRecovery(reconciliationClient,msg,loadData);
if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
  setMsg(
    msg,
    "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.",
    false,
  );
}

const tbody = $("tbody");
const summaryEl = $("summary");
const lowStockThresholdLabel = $("lowStockThresholdLabel");
if (lowStockThresholdLabel)
  lowStockThresholdLabel.textContent = String(LOW_STOCK_ROLLS_THRESHOLD);

let allRows = [];
let quickFilter = STOCK_FILTERS.includes(initialParams.get("filter"))
  ? initialParams.get("filter")
  : "all";
let preordersByItem = new Map();
let preorderDetailsByItem = new Map();

function applyPreset(rows, preset) {
  if(["purchase_newest","purchase_oldest"].includes(preset)){rows.sort((a,b)=>comparePurchases(a,b,preset));return;}
  const byText = (a, b) => (a || "").localeCompare(b || "", "ar");
  const byNum = (a, b) => (a ?? 0) - (b ?? 0);

  if (preset === "default") {
    rows.sort(
      (x, y) =>
        byText(x.main_category, y.main_category) ||
        byText(x.sub_category, y.sub_category) ||
        byText(x.item_name, y.item_name) ||
        byText(x.color_code, y.color_code),
    );
    return;
  }

  if (preset === "most_qty_in_item") {
    rows.sort(
      (x, y) =>
        byText(x.main_category, y.main_category) ||
        byText(x.sub_category, y.sub_category) ||
        byText(x.item_name, y.item_name) ||
        byNum(y.balance_main, x.balance_main) ||
        byText(x.color_code, y.color_code),
    );
    return;
  }

  if (preset === "most_rolls") {
    rows.sort((x, y) => (y.balance_rolls ?? 0) - (x.balance_rolls ?? 0));
  }
}

function buildFilterOptions() {
  const mainSel = $("filterMain");
  const subSel = $("filterSub");

  const mains = Array.from(
    new Set(allRows.map((r) => (r.main_category || "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "ar"));

  const selectedMain = (mainSel.value || "").trim();
  mainSel.innerHTML =
    `<option value="">الكل</option>` +
    mains
      .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      .join("");
  if (selectedMain && mains.includes(selectedMain))
    mainSel.value = selectedMain;

  const subs = Array.from(
    new Set(
      allRows
        .filter(
          (r) =>
            !mainSel.value || (r.main_category || "").trim() === mainSel.value,
        )
        .map((r) => (r.sub_category || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "ar"));

  const selectedSub = (subSel.value || "").trim();
  subSel.innerHTML =
    `<option value="">الكل</option>` +
    subs
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
  if (selectedSub && subs.includes(selectedSub)) subSel.value = selectedSub;
  else subSel.value = "";
}

function unitBucket(unitType) {
  const u = String(unitType || "").toLowerCase();
  if (u === "kg" || u.includes("kg") || u.includes("kilo")) return "kg";
  if (
    u === "m" ||
    u.includes("meter") ||
    u.includes("metre") ||
    u.includes("mtr")
  )
    return "m";
  return "other";
}

function updateSummary(rows) {
  const totalItems = rows.length;
  let totalRolls = 0;
  let totalKg = 0;
  let totalM = 0;

  for (const r of rows) {
    totalRolls += r.balance_rolls || 0;
    const b = r.balance_main || 0;
    const bucket = unitBucket(r.unit_type);
    if (bucket === "kg") totalKg += b;
    else if (bucket === "m") totalM += b;
  }

  const parts = [];
  parts.push(`إجمالي المواد: ${totalItems}`);
  parts.push(`إجمالي عدد الأثواب: ${parseInt(totalRolls || 0, 10)}`);

  if (Math.abs(totalKg) > 1e-9)
    parts.push(`إجمالي الكمية: ${Number(totalKg || 0).toFixed(3)} كغ`);
  if (Math.abs(totalM) > 1e-9)
    parts.push(`إجمالي الكمية: ${Number(totalM || 0).toFixed(3)} متر`);

  if (Math.abs(totalKg) <= 1e-9 && Math.abs(totalM) <= 1e-9) {
    const any = rows.find((r) => (r.balance_main || 0) !== 0);
    if (any) {
      const uLbl = unitLabel(any.unit_type);
      const sumAll = rows.reduce((acc, r) => acc + (r.balance_main || 0), 0);
      parts.push(
        `إجمالي الكمية: ${Number(sumAll || 0).toFixed(3)} ${escapeHtml(uLbl)}`,
      );
    }
  }

  summaryEl.textContent = parts.join(" | ");
}

function formatDate(ts) {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString("ar-EG");
  } catch {
    return ts;
  }
}

function moveTypeLabel(type) {
  if (type === "purchase") return "مشتريات";
  if (type === "sale") return "مبيعات";
  if (type === "adjustment") return "تسويات";
  return type || "-";
}

function renderOrdersCell(row) {
  const info = preordersByItem.get(String(row.id));
  if (!info || info.totalRolls <= 0) return "-";

  return `
    <div class="orders-cell">
      <div>رصيد بعد الطلبات : <strong>${row.balance_after_orders}</strong> توب</div>
      <div>إجمالي الطلبات : <strong>${info.totalRolls}</strong> توب / <strong>${info.count}</strong> طلبات</div>
      <button type="button" class="secondary orders-view-btn" data-act="view-orders" data-id="${row.id}">عرض</button>
    </div>
  `;
}

function applyFiltersAndRender() {
  const qRaw = $("search").value.trim().toLowerCase();
  const preset = $("preset").value;
  const fMain = ($("filterMain").value || "").trim();
  const fSub = ($("filterSub").value || "").trim();

  let rows = allRows.filter(
    (r) => $("scope").value === "active" ? !!r.is_active : $("scope").value === "inactive" ? !r.is_active : true,
  );
  if ($("stockUnit").value)
    rows = rows.filter((r) => r.unit_type === $("stockUnit").value);
  const itemParam = new URL(location.href).searchParams.get("item");
  if (itemParam) rows = rows.filter((r) => r.id === itemParam);

  if (fMain)
    rows = rows.filter((r) => (r.main_category || "").trim() === fMain);
  if (fSub) rows = rows.filter((r) => (r.sub_category || "").trim() === fSub);

  rows = rows.filter((r) =>
    stockMatches(r, quickFilter, LOW_STOCK_ROLLS_THRESHOLD),
  );

  if (qRaw) {
    rows = rows.filter((r) => {
      const imgPath = r.image_path || "";
      const hay = [
        r.main_category,
        r.sub_category,
        r.item_name,
        r.color_code,
        r.color_name,
        r.description,
        r.unit_type,
        materialLabel(r),
        String(r.balance_main ?? ""),
        String(r.balance_rolls ?? ""),
        String(r.preorder_total_rolls ?? ""),
        imgPath,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(qRaw);
    });
  }

  applyPreset(rows, preset);

  visibleRows = rows;
  tbody.innerHTML = rows
    .map((r) => {
      const imgUrl = getPublicImageUrl(r.image_path);
      const img = imgUrl
        ? `<img class="thumb zoomable" src="${getThumbnailImageUrl(r.image_path)}" data-full="${imgUrl}" alt="img" loading="lazy" decoding="async" width="150" height="150" />`
        : `<span class="thumb"></span>`;
      const orderInfo = preordersByItem.get(String(r.id));
      const orderRolls = Number(orderInfo?.totalRolls || 0);
      const orderCount = Number(orderInfo?.count || 0);

      return `
      <tr class="inventory-row ${!r.is_active ? "is-inactive" : ""} ${r.balance_after_orders < 0 ? "has-shortage" : ""}">
        <td class="cell-image">${img}</td>
        <td class="cell-item">
          <div class="material-main-line">${escapeHtml(materialLabel(r))}${!r.is_active ? '<span class="inactive-badge">موقوف</span>' : ""}</div>
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
        <td>${renderOrdersCell(r)}</td>
        <td class="cell-actions">
          <div class="inventory-row-links"><button type="button" class="secondary" data-act="view-moves" data-id="${r.id}">حركة المادة</button><button type="button" class="secondary" data-act="view-orders" data-id="${r.id}">الطلبات (${orderCount})</button>${canWrite ? `<a href="sales.html?item=${r.id}">+ بيع</a><a href="purchases.html?item=${r.id}">+ شراء</a>` : ""}</div><div class="mobile-actions">
            <button type="button" class="secondary icon-btn mobile-menu-toggle" data-act="toggle-mobile-menu" data-id="${r.id}" title="إجراءات" aria-label="إجراءات">⋮</button>
            <div class="mobile-actions-menu" hidden>
              <button type="button" class="secondary mobile-menu-item" data-act="view-moves" data-id="${r.id}">حركة المادة</button>
              ${canWrite ? `<button type="button" class="secondary mobile-menu-item" data-act="adjust-item" data-id="${r.id}">تسوية المادة</button>` : ""}
              ${isAdmin ? `<button type="button" class="secondary mobile-menu-item" data-act="edit-item" data-id="${r.id}">تعديل المادة</button>` : ""}
              ${isAdmin ? `<button type="button" class="${r.is_active ? "danger" : "secondary"} mobile-menu-item" data-act="toggle-item-status" data-id="${r.id}" ${itemStatusBusy ? "disabled" : ""}>${r.is_active ? "إيقاف المادة" : "تفعيل المادة"}</button>` : ""}
            </div>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  updateSummary(rows);
  const totals = stockTotals(rows);
  $("inventoryMetrics").innerHTML = [
    ["المواد المعروضة", totals.items],
    ["رصيد الأثواب", totals.rolls],
    ["طلبات قائمة / أثواب", totals.reserved],
    ["الرصيد بالكيلو", totals.kg],
    ["الرصيد بالمتر", totals.m],
  ]
    .map(
      ([label, value]) =>
        `<div><span>${label}</span><strong>${Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 })}</strong></div>`,
    )
    .join("");
  $("inventoryEmpty").hidden = rows.length > 0;
  const url = new URL(location.href);
  url.searchParams.set("unit", $("stockUnit").value);
  url.searchParams.set("scope", $("scope").value);
  url.searchParams.set("filter", quickFilter);
  url.searchParams.set("threshold", LOW_STOCK_ROLLS_THRESHOLD);
  url.searchParams.set("search",$("search").value);
  url.searchParams.set("main",$("filterMain").value);
  url.searchParams.set("sub",$("filterSub").value);
  url.searchParams.set("sort",$("preset").value);
  history.replaceState(null, "", url);
  saveView();
  setMsg(msg, `تم العرض: ${rows.length} مادة`, true);
}

function syncQuickFilters() {
  const root = $("quickFilters");
  if (!root) return;
  root.querySelectorAll("button[data-qf]").forEach((btn) => {
    const isActive = btn.dataset.qf === quickFilter;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

async function openMovesModal(itemId) {
  let version;
  try {
    const row = allRows.find((r) => String(r.id) === String(itemId));
    if (!row) return;

    version=++movesVersion;
    $("movesTitle").textContent="حركة المادة: "+materialLabel(row);
    $("movesTbody").innerHTML='<tr><td colspan="6">جارٍ تحميل الحركة…</td></tr>';
    $("movesModal").style.display="flex";
    const data=(await readItemMoves(itemId)).sort((a,b)=>String(b.move_date).localeCompare(String(a.move_date))||String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
    if(version!==movesVersion)return;
    let runningMain=data.reduce((n,m)=>n+Number(m.qty_main_in||0)-Number(m.qty_main_out||0),0);
    let runningRolls=data.reduce((n,m)=>n+Number(m.qty_rolls_in||0)-Number(m.qty_rolls_out||0),0);

    const movesRows = (data || []).map((m) => {
      const deltaMain =
        Number(m.qty_main_in || 0) - Number(m.qty_main_out || 0);
      const deltaRolls =
        Number(m.qty_rolls_in || 0) - Number(m.qty_rolls_out || 0);
      const html = `
        <tr>
          <td>${escapeHtml(formatDate(m.move_date))}</td>
          <td>${m.entry_group_id ? `<a href="${m.type === "purchase" ? "purchases" : "sales"}-review.html?group=${m.entry_group_id}">${escapeHtml(moveTypeLabel(m.type))} ←</a>` : escapeHtml(moveTypeLabel(m.type))}</td>
          <td>${deltaMain.toFixed(3)} ${escapeHtml(unitLabel(row.unit_type))}</td>
          <td>${deltaRolls}</td>
          <td>${runningMain.toFixed(3)} ${escapeHtml(unitLabel(row.unit_type))} / ${runningRolls} توب</td>
          <td>${escapeHtml(m.note || "-")}</td>
        </tr>
      `;
      runningMain -= deltaMain;
      runningRolls -= deltaRolls;
      return html;
    });

    $("movesTitle").textContent = `حركة المادة: ${materialLabel(row)}`;
    $("movesTbody").innerHTML = movesRows.length
      ? movesRows.join("")
      : `<tr><td colspan="6">لا توجد حركات لهذا الصنف.</td></tr>`;
    $("movesModal").style.display = "flex";
  } catch (ex) {
    if(version===movesVersion)$("movesTbody").innerHTML='<tr><td colspan="6">تعذر تحميل الحركة. أغلق النافذة وأعد المحاولة.</td></tr>';
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

function closeModal(id) {
  if(id==="movesModal")movesVersion++;
  if (id === "adjustModal" && adjustBusy) return;
  const el = $(id);
  if (el) el.style.display = "none";
}

async function openOrdersModal(itemId) {
  const row = allRows.find((r) => String(r.id) === String(itemId));
  if (!row) return;

  const details = preorderDetailsByItem.get(String(itemId)) || [];
  $("ordersTitle").textContent = `طلبات المادة: ${materialLabel(row)}`;

  if (details.length === 0) {
    $("ordersTbody").innerHTML =
      `<tr><td colspan="6">لا توجد طلبات قائمة لهذه المادة.</td></tr>`;
    $("ordersModal").style.display = "flex";
    return;
  }

  $("ordersTbody").innerHTML = details
    .map(
      (d) => `
    <tr>
      <td>${escapeHtml(formatDate(d.created_at))}</td>
      <td>${escapeHtml(d.customer_name || "-")}</td>
      <td>${parseInt(d.qty_rolls || 0, 10)}</td>
      <td>${d.status === "pending_sale" ? "بانتظار المبيعات" : d.status === "confirmed" ? "مؤكد" : "مسودة"}</td>
      <td><a class="secondary" style="display:inline-block;width:auto;padding:6px 10px;text-decoration:none;" href="./orders.html?id=${encodeURIComponent(d.order_id)}" target="_blank" rel="noopener">عرض الطلب</a></td>
      <td>${escapeHtml(d.note || "-")}</td>
    </tr>
  `,
    )
    .join("");

  $("ordersModal").style.display = "flex";
}

function buildPreordersState(lines) {
  const summary = new Map();
  const detailsMap = new Map();

  for (const l of lines) {
    const itemId = String(l.item_id);
    const order = Array.isArray(l.customer_orders)
      ? l.customer_orders[0]
      : l.customer_orders;
    const entry = summary.get(itemId) || {
      totalRolls: 0,
      count: 0,
      orderIds: new Set(),
    };

    entry.totalRolls += Number(l.qty_rolls || 0);
    if (order?.id && !entry.orderIds.has(order.id)) {
      entry.orderIds.add(order.id);
      entry.count += 1;
    }
    summary.set(itemId, entry);

    const rows = detailsMap.get(itemId) || [];
    rows.push({
      order_id: order?.id,
      created_at: order?.created_at,
      customer_name: order?.customer_name,
      status: order?.status,
      note: order?.note,
      qty_rolls: Number(l.qty_rolls || 0),
    });
    detailsMap.set(itemId, rows);
  }

  preordersByItem = new Map(
    Array.from(summary.entries()).map(([id, val]) => [
      id,
      { totalRolls: val.totalRolls, count: val.count },
    ]),
  );
  preorderDetailsByItem = new Map(
    Array.from(detailsMap.entries()).map(([id, rows]) => [
      id,
      rows.sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")),
      ),
    ]),
  );
}

let adjustCurrentItem = null;

function openAdjustModal(itemId) {
  const row = allRows.find((r) => String(r.id) === String(itemId));
  if (!row || !canWrite || adjustBusy) return;
  adjustCurrentItem = row;

  $("adjustTitle").textContent = `تسوية المادة: ${materialLabel(row)}`;
  $("adjustDate").value = todayISO();
  $("adjustBookMain").value =
    `${Number(row.balance_main || 0).toFixed(3)} ${unitLabel(row.unit_type)}`;
  $("adjustBookRolls").value = String(parseInt(row.balance_rolls || 0, 10));
  $("adjustActualMain").value = "";
  $("adjustActualRolls").value = "";
  setMsg($("adjustMsg"), "", true);
  $("adjustModal").style.display = "flex";
}

async function saveSingleItemAdjustment() {
  if (!adjustCurrentItem || !canWrite || adjustBusy) return;

  const currentItem = adjustCurrentItem;
  const reconDate = $("adjustDate").value;
  if (!reconDate) return setMsg($("adjustMsg"), "اختر تاريخ التسوية", false);

  const actualMainRaw = $("adjustActualMain").value;
  const actualRollsRaw = $("adjustActualRolls").value;

  if (actualMainRaw === "" || actualRollsRaw === "") {
    return setMsg(
      $("adjustMsg"),
      "يجب إدخال الفعلي (رئيسية + أثواب) معاً لأي مادة",
      false,
    );
  }

  const actualMain = Number(actualMainRaw);
  const actualRolls = Number(actualRollsRaw);
  if (!Number.isFinite(actualMain) || actualMain < 0 || actualRolls < 0)
    return setMsg($("adjustMsg"), "أدخل كميات فعلية صحيحة وغير سالبة", false);
  if (!Number.isInteger(actualRolls))
    return setMsg(
      $("adjustMsg"),
      "الأثواب الفعلية يجب أن تكون عدد صحيح",
      false,
    );

  const balMain = Number(adjustCurrentItem.balance_main || 0);
  const balRolls = Number(adjustCurrentItem.balance_rolls || 0);
  const diffMain = actualMain - balMain;
  const diffRolls = actualRolls - balRolls;

  if (diffMain === 0 && diffRolls === 0) {
    return setMsg($("adjustMsg"), "لا يوجد فرق بين الرصيد والفعلي.", false);
  }

  adjustBusy = true;
  $("adjustSave").disabled = true;
  setMsg($("adjustMsg"), "جارٍ اعتماد التسوية...", true);

  try {
    await reconciliationClient.save(reconDate,[{
      item_id:currentItem.id,book_main:balMain,book_rolls:balRolls,
      actual_main:actualMain,actual_rolls:actualRolls
    }]);
    setMsg($("adjustMsg"), "تم اعتماد تسوية هذه المادة بنجاح.", true);
    await loadData();
    adjustBusy = false;
    closeModal("adjustModal");
  } catch (ex) {
    setMsg($("adjustMsg"), reconciliationError(ex), false);
  } finally {
    adjustBusy = false;
    $("adjustSave").disabled = false;
    refreshReconciliationRecovery();
  }
}

async function toggleItemStatus(itemId) {
  if (!isAdmin || loading || itemStatusBusy) return;
  const row = allRows.find((r) => String(r.id) === String(itemId));
  if (!row) return;
  const nextActive = !row.is_active;
  const actionLabel = nextActive ? "تفعيل" : "إيقاف";
  if (!confirm(`هل أنت متأكد من ${actionLabel} هذه المادة؟\n${materialLabel(row)}\nرقم اللون: ${row.color_code || "—"} — اسم اللون: ${row.color_name || "—"}`)) return;
  itemStatusBusy = true;
  $("btnReload").disabled = true;
  tbody.querySelectorAll('[data-act="toggle-item-status"]').forEach((button) => { button.disabled = true; });
  setMsg(msg, `جارٍ ${actionLabel} المادة…`, true);
  try {
    const { data, error } = await supabase.from("items")
      .update({ is_active: nextActive }).eq("id", row.id)
      .select("id, is_active").single();
    if (error) throw error;
    if (!data || data.is_active !== nextActive) throw new Error(`تعذر تأكيد ${actionLabel} المادة. حدّث الصفحة وحاول مجددًا.`);
    row.is_active = nextActive;
    for (const item of snapshot?.rows || []) {
      if (String(item.id) === String(row.id)) item.is_active = nextActive;
    }
    applyFiltersAndRender();
    setMsg(msg, `تم ${actionLabel} المادة بنجاح.`, true);
  } catch (ex) {
    setMsg(msg, explainSupabaseError(ex), false);
  } finally {
    itemStatusBusy = false;
    $("btnReload").disabled = false;
    tbody.querySelectorAll('[data-act="toggle-item-status"]').forEach((button) => { button.disabled = false; });
  }
}

async function loadData() {
  if (loading || itemStatusBusy) return;
  loading = true;
  $("btnReload").disabled = true;
  setMsg(msg, "جارٍ تحديث الأرصدة والطلبات…");
  try {
    const next = await readStock();
    snapshot = next;
    buildPreordersState(next.lines);
    allRows = next.rows.map((r) => ({
      ...r,
      preorder_count: preordersByItem.get(r.id)?.count || 0,
    }));
    buildFilterOptions();
    if(initialViewPending){$("filterMain").value=initialParams.get("main")||"";buildFilterOptions();$("filterSub").value=initialParams.get("sub")||"";initialViewPending=false;}
    syncQuickFilters();
    applyFiltersAndRender();
    $("lastStockUpdate").textContent =
      "آخر تحديث: " + new Date().toLocaleTimeString("ar-EG");
  } catch (ex) {
    setMsg(msg, "تعذر تحديث البيانات. " + explainSupabaseError(ex), false);
  } finally {
    loading = false;
    $("btnReload").disabled = false;
  }
}
$("btnReload").addEventListener("click", loadData);
$("search").addEventListener("input", () => {
  clearTimeout(window.__ti);
  window.__ti = setTimeout(applyFiltersAndRender, 200);
});
$("preset").addEventListener("change", applyFiltersAndRender);
$("scope").addEventListener("change", applyFiltersAndRender);

$("filterMain").addEventListener("change", () => {
  buildFilterOptions();
  applyFiltersAndRender();
});
$("filterSub").addEventListener("change", applyFiltersAndRender);

$("quickFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-qf]");
  if (!btn) return;
  quickFilter = btn.dataset.qf || "all";
  if(quickFilter==="inactive_stock")$("scope").value="inactive";
  syncQuickFilters();
  applyFiltersAndRender();
});

$("btnClearFilters").addEventListener("click", () => {
  const u = new URL(location.href);
  u.searchParams.delete("item");
  history.replaceState(null, "", u);
  $("stockUnit").value = "";
  $("scope").value="active";
  $("preset").value="default";
  $("search").value = "";
  $("filterMain").value = "";
  buildFilterOptions();
  $("filterSub").value = "";
  quickFilter = "all";
  syncQuickFilters();
  applyFiltersAndRender();
});

tbody.addEventListener("click", (e) => {
  const toggleBtn = e.target.closest(".mobile-menu-toggle");
  if (toggleBtn) {
    const wrap = toggleBtn.closest(".mobile-actions");
    if (!wrap) return;
    const menu = wrap.querySelector(".mobile-actions-menu");
    if (!menu) return;

    const isOpen = !menu.hasAttribute("hidden");
    tbody
      .querySelectorAll(".mobile-actions-menu")
      .forEach((m) => m.setAttribute("hidden", ""));
    if (!isOpen) menu.removeAttribute("hidden");
    return;
  }

  const img = e.target.closest("img.thumb.zoomable");
  if (img) {
    openImageViewer(img.dataset.full || img.src, img.alt);
    return;
  }

  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const itemId = btn.getAttribute("data-id");
  if (!itemId) return;

  const act = btn.getAttribute("data-act");
  if (act === "view-moves") openMovesModal(itemId);
  else if (act === "adjust-item") openAdjustModal(itemId);
  else if (act === "toggle-item-status") void toggleItemStatus(itemId);
  else if (act === "edit-item" && isAdmin) window.open(`./items.html?item=${encodeURIComponent(itemId)}&status=all`, "_blank", "noopener");
  else if (act === "view-orders") openOrdersModal(itemId);

  tbody
    .querySelectorAll(".mobile-actions-menu")
    .forEach((m) => m.setAttribute("hidden", ""));
});

document.addEventListener("click", (e) => {
  if (e.target.closest(".mobile-actions")) return;
  tbody
    .querySelectorAll(".mobile-actions-menu")
    .forEach((m) => m.setAttribute("hidden", ""));
});

$("imageModal").addEventListener("click", () => {
  $("imageModal").style.display = "none";
  $("imageModalImg").src = "";
});

$("movesClose").addEventListener("click", () => closeModal("movesModal"));
$("ordersClose").addEventListener("click", () => closeModal("ordersModal"));
$("adjustClose").addEventListener("click", () => closeModal("adjustModal"));

$("movesModal").addEventListener("click", (e) => {
  if (e.target.id === "movesModal") closeModal("movesModal");
});
$("ordersModal").addEventListener("click", (e) => {
  if (e.target.id === "ordersModal") closeModal("ordersModal");
});
$("adjustModal").addEventListener("click", (e) => {
  if (e.target.id === "adjustModal") closeModal("adjustModal");
});

$("adjustReset").addEventListener("click", () => {
  $("adjustActualMain").value = "";
  $("adjustActualRolls").value = "";
  setMsg($("adjustMsg"), "", true);
});

$("adjustSave").addEventListener("click", saveSingleItemAdjustment);

$("stockThreshold").value = LOW_STOCK_ROLLS_THRESHOLD;
$("stockThreshold").addEventListener("change", () => {
  LOW_STOCK_ROLLS_THRESHOLD = Math.min(
    100000,
    Math.max(1, Number($("stockThreshold").value) || 10),
  );
  $("stockThreshold").value = LOW_STOCK_ROLLS_THRESHOLD;
  lowStockThresholdLabel.textContent = LOW_STOCK_ROLLS_THRESHOLD;
  applyFiltersAndRender();
});
$("exportStock").onclick = () => {
  if (!snapshot) return;
  const headers = [
    "المجموعة الرئيسية",
    "المجموعة الفرعية",
    "المادة",
    "كود اللون",
    "اسم اللون",
    "الوحدة",
    "الرصيد الرئيسي",
    "الأثواب",
    "طلبات قائمة بالأثواب",
    "الرصيد بعد الطلبات",
  ];
  const rows = visibleRows.map((r) => [
    r.main_category,
    r.sub_category,
    r.item_name,
    r.color_code,
    r.color_name,
    unitLabel(r.unit_type),
    r.balance_main,
    r.balance_rolls,
    r.preorder_total_rolls,
    r.balance_after_orders,
  ]);
  const blob = new Blob(
    [
      "\ufeff" +
        [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `ADLATEX_stock_${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !adjustBusy)
    ["movesModal", "ordersModal", "adjustModal", "imageModal"].forEach(
      closeModal,
    );
});
if (!canWrite)
  document
    .querySelectorAll("[data-stock-admin]")
    .forEach((n) => (n.hidden = true));
if (["kg", "m"].includes(initialParams.get("unit")))
  $("stockUnit").value = initialParams.get("unit");
$("stockUnit").onchange = applyFiltersAndRender;
if (["all", "inactive"].includes(initialParams.get("scope"))) $("scope").value = initialParams.get("scope");
let initialViewPending=true;
$("search").value=initialParams.get("search")||"";
if([...$("preset").options].some(o=>o.value===initialParams.get("sort")))$("preset").value=initialParams.get("sort");
await loadData();
if(restoreScroll)requestAnimationFrame(()=>{window.scrollTo(0,restoreScroll);restoreScroll=0;});

