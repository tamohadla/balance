import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, unitLabel, todayISO, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const LOW_STOCK_ROLLS_THRESHOLD = 10;

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const summaryEl = $("summary");
const lowStockThresholdLabel = $("lowStockThresholdLabel");
if(lowStockThresholdLabel) lowStockThresholdLabel.textContent = String(LOW_STOCK_ROLLS_THRESHOLD);

let allRows = [];
let quickFilter = "all";
let preordersByItem = new Map();
let preorderDetailsByItem = new Map();

async function fetchItems(){
  const scope = $("scope").value;
  let q = supabase.from("items").select("*")
    .order("main_category").order("sub_category").order("item_name").order("color_code");
  if(scope === "active") q = q.eq("is_active", true);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

async function fetchMovesForItems(itemIds){
  if(itemIds.length === 0) return [];
  const all = [];
  const chunkSize = 200;
  for(let i = 0; i < itemIds.length; i += chunkSize){
    const chunk = itemIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("stock_moves")
      .select("id, item_id, type, move_date, note, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out")
      .in("item_id", chunk);
    if(error) throw error;
    all.push(...(data || []));
  }
  return all;
}

async function fetchDraftOrders(){
  const { data, error } = await supabase
    .from("customer_order_lines")
    .select("order_id, item_id, qty_rolls, customer_orders!inner(id, created_at, customer_name, status, note)")
    .eq("customer_orders.status", "draft");
  if(error) throw error;
  return data || [];
}

function applyPreset(rows, preset){
  const byText = (a, b) => (a || "").localeCompare(b || "", "ar");
  const byNum = (a, b) => (a ?? 0) - (b ?? 0);

  if(preset === "default"){
    rows.sort((x, y) =>
      byText(x.main_category, y.main_category) ||
      byText(x.sub_category, y.sub_category) ||
      byText(x.item_name, y.item_name) ||
      byText(x.color_code, y.color_code)
    );
    return;
  }

  if(preset === "most_qty_in_item"){
    rows.sort((x, y) =>
      byText(x.main_category, y.main_category) ||
      byText(x.sub_category, y.sub_category) ||
      byText(x.item_name, y.item_name) ||
      (byNum(y.balance_main, x.balance_main)) ||
      byText(x.color_code, y.color_code)
    );
    return;
  }

  if(preset === "most_rolls"){
    rows.sort((x, y) => (y.balance_rolls ?? 0) - (x.balance_rolls ?? 0));
  }
}

function buildFilterOptions(){
  const mainSel = $("filterMain");
  const subSel = $("filterSub");

  const mains = Array.from(new Set(allRows.map(r => (r.main_category || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ar"));

  const selectedMain = (mainSel.value || "").trim();
  mainSel.innerHTML = `<option value="">الكل</option>` + mains.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if(selectedMain && mains.includes(selectedMain)) mainSel.value = selectedMain;

  const subs = Array.from(new Set(
    allRows
      .filter(r => !mainSel.value || (r.main_category || "").trim() === mainSel.value)
      .map(r => (r.sub_category || "").trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "ar"));

  const selectedSub = (subSel.value || "").trim();
  subSel.innerHTML = `<option value="">الكل</option>` + subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if(selectedSub && subs.includes(selectedSub)) subSel.value = selectedSub;
  else subSel.value = "";
}

function unitBucket(unitType){
  const u = String(unitType || "").toLowerCase();
  if(u === "kg" || u.includes("kg") || u.includes("kilo")) return "kg";
  if(u === "m" || u.includes("meter") || u.includes("metre") || u.includes("mtr")) return "m";
  return "other";
}

function updateSummary(rows){
  const totalItems = rows.length;
  let totalRolls = 0;
  let totalKg = 0;
  let totalM = 0;

  for(const r of rows){
    totalRolls += (r.balance_rolls || 0);
    const b = (r.balance_main || 0);
    const bucket = unitBucket(r.unit_type);
    if(bucket === "kg") totalKg += b;
    else if(bucket === "m") totalM += b;
  }

  const parts = [];
  parts.push(`إجمالي المواد: ${totalItems}`);
  parts.push(`إجمالي عدد الأثواب: ${parseInt(totalRolls || 0, 10)}`);

  if(Math.abs(totalKg) > 1e-9) parts.push(`إجمالي الكمية: ${Number(totalKg || 0).toFixed(3)} كغ`);
  if(Math.abs(totalM) > 1e-9) parts.push(`إجمالي الكمية: ${Number(totalM || 0).toFixed(3)} متر`);

  if(Math.abs(totalKg) <= 1e-9 && Math.abs(totalM) <= 1e-9){
    const any = rows.find(r => (r.balance_main || 0) !== 0);
    if(any){
      const uLbl = unitLabel(any.unit_type);
      const sumAll = rows.reduce((acc, r) => acc + (r.balance_main || 0), 0);
      parts.push(`إجمالي الكمية: ${Number(sumAll || 0).toFixed(3)} ${escapeHtml(uLbl)}`);
    }
  }

  summaryEl.textContent = parts.join(" | ");
}

function formatDate(ts){
  if(!ts) return "-";
  try{ return new Date(ts).toLocaleString("ar-EG"); }
  catch{ return ts; }
}

function moveTypeLabel(type){
  if(type === "purchase") return "مشتريات";
  if(type === "sale") return "مبيعات";
  if(type === "adjustment") return "تسويات";
  return type || "-";
}

function renderOrdersCell(row){
  const info = preordersByItem.get(String(row.id));
  if(!info || info.totalRolls <= 0) return "-";

  return `
    <div class="orders-cell">
      <div>رصيد بعد الطلبات : <strong>${row.balance_after_orders}</strong> توب</div>
      <div>إجمالي الطلبات : <strong>${info.totalRolls}</strong> توب / <strong>${info.count}</strong> طلبات</div>
      <button type="button" class="secondary orders-view-btn" data-act="view-orders" data-id="${row.id}">عرض</button>
    </div>
  `;
}

function applyFiltersAndRender(){
  const qRaw = $("search").value.trim().toLowerCase();
  const preset = $("preset").value;
  const fMain = ($("filterMain").value || "").trim();
  const fSub = ($("filterSub").value || "").trim();

  let rows = allRows.slice();

  if(fMain) rows = rows.filter(r => (r.main_category || "").trim() === fMain);
  if(fSub) rows = rows.filter(r => (r.sub_category || "").trim() === fSub);

  if(quickFilter === "has_orders") rows = rows.filter(r => (r.preorder_total_rolls || 0) > 0);
  if(quickFilter === "zero_rolls") rows = rows.filter(r => Number(r.balance_rolls || 0) === 0);
  if(quickFilter === "low_stock") rows = rows.filter(r => Number(r.balance_rolls || 0) < LOW_STOCK_ROLLS_THRESHOLD);

  if(qRaw){
    rows = rows.filter(r => {
      const imgPath = r.image_path || "";
      const hay = [
        r.main_category, r.sub_category, r.item_name,
        r.color_code, r.color_name,
        r.description, r.unit_type,
        materialLabel(r),
        String(r.balance_main ?? ""),
        String(r.balance_rolls ?? ""),
        String(r.preorder_total_rolls ?? ""),
        imgPath
      ].join(" ").toLowerCase();
      return hay.includes(qRaw);
    });
  }

  applyPreset(rows, preset);

  tbody.innerHTML = rows.map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const img = imgUrl
      ? `<img class="thumb zoomable" src="${imgUrl}" alt="img" />`
      : `<span class="thumb"></span>`;

    return `
      <tr>
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td>${Number(r.balance_main || 0).toFixed(3)} ${escapeHtml(unitLabel(r.unit_type))}</td>
        <td>${parseInt(r.balance_rolls || 0, 10)}</td>
        <td>${renderOrdersCell(r)}</td>
        <td>
          <div class="icon-actions">
            <button type="button" class="secondary icon-btn" data-act="view-moves" data-id="${r.id}" title="عرض حركة المادة" aria-label="عرض حركة المادة">📋</button>
            <button type="button" class="secondary icon-btn" data-act="adjust-item" data-id="${r.id}" title="تسوية هذه المادة" aria-label="تسوية هذه المادة">⚖️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  updateSummary(rows);
  setMsg(msg, `تم العرض: ${rows.length} مادة`, true);
}

function syncQuickFilters(){
  const root = $("quickFilters");
  if(!root) return;
  root.querySelectorAll("button[data-qf]").forEach(btn => {
    const isActive = btn.dataset.qf === quickFilter;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

async function openMovesModal(itemId){
  try{
    const row = allRows.find(r => String(r.id) === String(itemId));
    if(!row) return;

    const { data, error } = await supabase
      .from("stock_moves")
      .select("type, move_date, note, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out")
      .eq("item_id", itemId)
      .in("type", ["purchase", "sale", "adjustment"])
      .order("move_date", { ascending: false });
    if(error) throw error;

    let runningMain = Number(row.balance_main || 0);
    let runningRolls = Number(row.balance_rolls || 0);

    const movesRows = (data || []).map(m => {
      const deltaMain = Number(m.qty_main_in || 0) - Number(m.qty_main_out || 0);
      const deltaRolls = Number(m.qty_rolls_in || 0) - Number(m.qty_rolls_out || 0);
      const html = `
        <tr>
          <td>${escapeHtml(formatDate(m.move_date))}</td>
          <td>${escapeHtml(moveTypeLabel(m.type))}</td>
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
    $("movesTbody").innerHTML = movesRows.length ? movesRows.join("") : `<tr><td colspan="6">لا توجد حركات لهذا الصنف.</td></tr>`;
    $("movesModal").style.display = "flex";
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

function closeModal(id){
  const el = $(id);
  if(el) el.style.display = "none";
}

async function openOrdersModal(itemId){
  const row = allRows.find(r => String(r.id) === String(itemId));
  if(!row) return;

  const details = preorderDetailsByItem.get(String(itemId)) || [];
  $("ordersTitle").textContent = `طلبات المادة: ${materialLabel(row)}`;

  if(details.length === 0){
    $("ordersTbody").innerHTML = `<tr><td colspan="6">لا توجد طلبات مبدئية محفوظة لهذه المادة.</td></tr>`;
    $("ordersModal").style.display = "flex";
    return;
  }

  $("ordersTbody").innerHTML = details.map(d => `
    <tr>
      <td>${escapeHtml(formatDate(d.created_at))}</td>
      <td>${escapeHtml(d.customer_name || "-")}</td>
      <td>${parseInt(d.qty_rolls || 0, 10)}</td>
      <td>${escapeHtml(d.status || "-")}</td>
      <td><a class="secondary" style="display:inline-block;width:auto;padding:6px 10px;text-decoration:none;" href="./orders.html?id=${encodeURIComponent(d.order_id)}" target="_blank" rel="noopener">عرض الطلب</a></td>
      <td>${escapeHtml(d.note || "-")}</td>
    </tr>
  `).join("");

  $("ordersModal").style.display = "flex";
}

function buildPreordersState(lines){
  const summary = new Map();
  const detailsMap = new Map();

  for(const l of lines){
    const itemId = String(l.item_id);
    const order = Array.isArray(l.customer_orders) ? l.customer_orders[0] : l.customer_orders;
    const entry = summary.get(itemId) || { totalRolls: 0, count: 0, orderIds: new Set() };

    entry.totalRolls += Number(l.qty_rolls || 0);
    if(order?.id && !entry.orderIds.has(order.id)){
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
      qty_rolls: Number(l.qty_rolls || 0)
    });
    detailsMap.set(itemId, rows);
  }

  preordersByItem = new Map(Array.from(summary.entries()).map(([id, val]) => [id, { totalRolls: val.totalRolls, count: val.count }]));
  preorderDetailsByItem = new Map(Array.from(detailsMap.entries()).map(([id, rows]) => [id, rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))]));
}

let adjustCurrentItem = null;

function openAdjustModal(itemId){
  const row = allRows.find(r => String(r.id) === String(itemId));
  if(!row) return;
  adjustCurrentItem = row;

  $("adjustTitle").textContent = `تسوية المادة: ${materialLabel(row)}`;
  $("adjustDate").value = todayISO();
  $("adjustBookMain").value = `${Number(row.balance_main || 0).toFixed(3)} ${unitLabel(row.unit_type)}`;
  $("adjustBookRolls").value = String(parseInt(row.balance_rolls || 0, 10));
  $("adjustActualMain").value = "";
  $("adjustActualRolls").value = "";
  setMsg($("adjustMsg"), "", true);
  $("adjustModal").style.display = "flex";
}

async function saveSingleItemAdjustment(){
  if(!adjustCurrentItem) return;

  const reconDate = $("adjustDate").value;
  if(!reconDate) return setMsg($("adjustMsg"), "اختر تاريخ التسوية", false);

  const actualMainRaw = $("adjustActualMain").value;
  const actualRollsRaw = $("adjustActualRolls").value;

  if(actualMainRaw === "" || actualRollsRaw === ""){
    return setMsg($("adjustMsg"), "يجب إدخال الفعلي (رئيسية + أثواب) معاً لأي مادة", false);
  }

  const actualMain = Number(actualMainRaw);
  const actualRolls = Number(actualRollsRaw);
  if(!Number.isInteger(actualRolls)) return setMsg($("adjustMsg"), "الأثواب الفعلية يجب أن تكون عدد صحيح", false);

  const balMain = Number(adjustCurrentItem.balance_main || 0);
  const balRolls = Number(adjustCurrentItem.balance_rolls || 0);
  const diffMain = actualMain - balMain;
  const diffRolls = actualRolls - balRolls;

  if(diffMain === 0 && diffRolls === 0){
    return setMsg($("adjustMsg"), "لا يوجد فرق بين الرصيد والفعلي.", false);
  }

  setMsg($("adjustMsg"), "جارٍ اعتماد التسوية...", true);

  try{
    const { data: session, error: sErr } = await supabase
      .from("recon_sessions")
      .insert([{ recon_date: reconDate, note: null }])
      .select("id")
      .single();
    if(sErr) throw sErr;

    const sessionId = session.id;

    const { error: lErr } = await supabase.from("recon_lines").insert([{
      session_id: sessionId,
      recon_date: reconDate,
      item_id: adjustCurrentItem.id,
      book_qty_main: balMain,
      book_qty_rolls: balRolls,
      actual_qty_main: actualMain,
      actual_qty_rolls: actualRolls,
      diff_qty_main: diffMain,
      diff_qty_rolls: diffRolls
    }]);
    if(lErr) throw lErr;

    const mv = {
      type: "adjustment",
      move_date: reconDate,
      item_id: adjustCurrentItem.id,
      note: "تسوية جرد شهرية",
      qty_main_in: 0,
      qty_main_out: 0,
      qty_rolls_in: 0,
      qty_rolls_out: 0,
      session_id: sessionId
    };
    if(diffMain > 0) mv.qty_main_in = diffMain;
    if(diffMain < 0) mv.qty_main_out = Math.abs(diffMain);
    if(diffRolls > 0) mv.qty_rolls_in = diffRolls;
    if(diffRolls < 0) mv.qty_rolls_out = Math.abs(diffRolls);

    const { error: mErr } = await supabase.from("stock_moves").insert([mv]);
    if(mErr) throw mErr;

    setMsg($("adjustMsg"), "تم اعتماد تسوية هذه المادة بنجاح.", true);
    await loadData();
    closeModal("adjustModal");
  }catch(ex){
    setMsg($("adjustMsg"), explainSupabaseError(ex), false);
  }
}

async function loadData(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";
  summaryEl.textContent = "";

  try{
    const items = await fetchItems();
    const [moves, draftOrders] = await Promise.all([
      fetchMovesForItems(items.map(i => i.id)),
      fetchDraftOrders()
    ]);

    buildPreordersState(draftOrders);

    const agg = new Map();
    for(const it of items){
      agg.set(it.id, { ...it, balance_main: 0, balance_rolls: 0 });
    }

    for(const m of moves){
      const r = agg.get(m.item_id);
      if(!r) continue;
      r.balance_main += (m.qty_main_in || 0) - (m.qty_main_out || 0);
      r.balance_rolls += (m.qty_rolls_in || 0) - (m.qty_rolls_out || 0);
    }

    allRows = [...agg.values()].map(r => {
      const pre = preordersByItem.get(String(r.id));
      const totalPreorderRolls = pre ? pre.totalRolls : 0;
      return {
        ...r,
        preorder_total_rolls: totalPreorderRolls,
        preorder_count: pre ? pre.count : 0,
        balance_after_orders: Number(r.balance_rolls || 0) - Number(totalPreorderRolls || 0)
      };
    });

    buildFilterOptions();
    syncQuickFilters();
    applyFiltersAndRender();
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

$("btnReload").addEventListener("click", loadData);
$("search").addEventListener("input", () => {
  clearTimeout(window.__ti);
  window.__ti = setTimeout(applyFiltersAndRender, 200);
});
$("preset").addEventListener("change", applyFiltersAndRender);
$("scope").addEventListener("change", loadData);

$("filterMain").addEventListener("change", () => {
  buildFilterOptions();
  applyFiltersAndRender();
});
$("filterSub").addEventListener("change", applyFiltersAndRender);

$("quickFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-qf]");
  if(!btn) return;
  quickFilter = btn.dataset.qf || "all";
  syncQuickFilters();
  applyFiltersAndRender();
});

$("btnClearFilters").addEventListener("click", () => {
  $("search").value = "";
  $("filterMain").value = "";
  buildFilterOptions();
  $("filterSub").value = "";
  quickFilter = "all";
  syncQuickFilters();
  applyFiltersAndRender();
});

tbody.addEventListener("click", (e) => {
  const img = e.target.closest("img.thumb.zoomable");
  if(img){
    $("imageModalImg").src = img.src;
    $("imageModal").style.display = "flex";
    return;
  }

  const btn = e.target.closest("[data-act]");
  if(!btn) return;
  const itemId = btn.getAttribute("data-id");
  if(!itemId) return;

  const act = btn.getAttribute("data-act");
  if(act === "view-moves") openMovesModal(itemId);
  else if(act === "adjust-item") openAdjustModal(itemId);
  else if(act === "view-orders") openOrdersModal(itemId);
});

$("imageModal").addEventListener("click", () => {
  $("imageModal").style.display = "none";
  $("imageModalImg").src = "";
});

$("movesClose").addEventListener("click", () => closeModal("movesModal"));
$("ordersClose").addEventListener("click", () => closeModal("ordersModal"));
$("adjustClose").addEventListener("click", () => closeModal("adjustModal"));

$("movesModal").addEventListener("click", (e) => { if(e.target.id === "movesModal") closeModal("movesModal"); });
$("ordersModal").addEventListener("click", (e) => { if(e.target.id === "ordersModal") closeModal("ordersModal"); });
$("adjustModal").addEventListener("click", (e) => { if(e.target.id === "adjustModal") closeModal("adjustModal"); });

$("adjustReset").addEventListener("click", () => {
  $("adjustActualMain").value = "";
  $("adjustActualRolls").value = "";
  setMsg($("adjustMsg"), "", true);
});

$("adjustSave").addEventListener("click", saveSingleItemAdjustment);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadData(); })();
