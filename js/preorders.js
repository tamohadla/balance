import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
const tbody = $("tbody");
const cartSummary = $("cartSummary");
const cartSummaryFloating = $("cartSummaryFloating");
const CART_KEY = "preorder_cart_v1";

let cart = loadCart(); // source of truth for preorder quantities by item_id
let rowsCache = []; // base items data from DB
let pendingByItem = {}; // previous draft quantities from DB
let preorderedItemIds = new Set(); // item_ids that appeared in previously saved draft orders
let positiveRollsOnly = false;
let onlyPreordered = false;

const uiFilters = {
  search: "",
  scope: "active",
  filterMain: "",
  filterSub: "",
  onlySelected: false
};

function loadCart(){
    try {
        const raw = localStorage.getItem(CART_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveCart(newCart){
    cart = newCart || {};
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function updateCartSummary(){
    const ids = Object.keys(cart);
    const totalRolls = ids.reduce((s, id) => s + (cart[id] || 0), 0);
    const txt = `${ids.length} صنف — ${totalRolls} ثوب`;
    if(cartSummary) cartSummary.textContent = txt;
    if(cartSummaryFloating) cartSummaryFloating.textContent = txt;
}

function getScopeRows(){
  if(uiFilters.scope === "active") return rowsCache.filter(r => r.is_active === true);
  return rowsCache.slice();
}

function buildCategoryFilters(){
  const mainSel = $("filterMain");
  const subSel = $("filterSub");
  if(!mainSel || !subSel) return;

  const scopedRows = getScopeRows();
  const mains = [...new Set(scopedRows.map(r => String(r.main_category || "").trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"ar"));

  mainSel.innerHTML = `<option value="">المجموعة الأساسية: الكل</option>`
    + mains.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if(uiFilters.filterMain && mains.includes(uiFilters.filterMain)) mainSel.value = uiFilters.filterMain;
  else mainSel.value = "";

  const activeMain = mainSel.value || "";
  const subs = [...new Set(
    scopedRows
      .filter(r => !activeMain || String(r.main_category || "").trim() === activeMain)
      .map(r => String(r.sub_category || "").trim())
      .filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,"ar"));

  subSel.innerHTML = `<option value="">المجموعة الفرعية: الكل</option>`
    + subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if(uiFilters.filterSub && subs.includes(uiFilters.filterSub)) subSel.value = uiFilters.filterSub;
  else subSel.value = "";

  uiFilters.filterMain = mainSel.value || "";
  uiFilters.filterSub = subSel.value || "";
}

function syncFilterButtons(){
  const setActive = (id, active) => {
    const btn = $(id);
    if(!btn) return;
    btn.classList.toggle("active", !!active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  };
  setActive("onlySelected", uiFilters.onlySelected);
  setActive("positiveRollsOnly", positiveRollsOnly);
  setActive("onlyPreordered", onlyPreordered);
}

function getFilteredRows(){
  const q = uiFilters.search.trim().toLowerCase();

  return getScopeRows().filter(r => {
    const matchMain = uiFilters.filterMain ? String(r.main_category || "").trim() === uiFilters.filterMain : true;
    const matchSub = uiFilters.filterSub ? String(r.sub_category || "").trim() === uiFilters.filterSub : true;
    const matchSearch = q ? `${materialLabel(r)} ${r.color_code || ""} ${r.color_name || ""}`.toLowerCase().includes(q) : true;
    const matchSelected = uiFilters.onlySelected ? (cart[r.id] > 0) : true;
    const matchPositiveRolls = positiveRollsOnly ? Number(r.balance_rolls || 0) > 0 : true;
    const matchOnlyPreordered = onlyPreordered ? preorderedItemIds.has(String(r.id)) : true;

    return matchMain && matchSub && matchSearch && matchSelected && matchPositiveRolls && matchOnlyPreordered;
  });
}

function clearFiltersAndSearch(){
  uiFilters.search = "";
  uiFilters.scope = "active";
  uiFilters.filterMain = "";
  uiFilters.filterSub = "";
  uiFilters.onlySelected = false;
  positiveRollsOnly = false;
  onlyPreordered = false;

  const searchEl = $("search");
  if(searchEl) searchEl.value = "";
  const scopeEl = $("scope");
  if(scopeEl) scopeEl.value = "active";
  const mainEl = $("filterMain");
  if(mainEl) mainEl.value = "";
  const subEl = $("filterSub");
  if(subEl) subEl.value = "";
  buildCategoryFilters();
  syncFilterButtons();
  render();
  setMsg(msg, "تم مسح الفلترة والبحث.", true);
}

function clearCartOnly(){
  const hasAny = cart && Object.keys(cart).some(id => (cart[id]||0) > 0);
  if(!hasAny){
    setMsg(msg, "السلة فارغة بالفعل.", true);
    updateCartSummary();
    return;
  }
  if(!confirm("هل تريد تفريغ السلة (الكميات المختارة) فقط؟")) return;
  cart = {};
  localStorage.removeItem(CART_KEY);
  render();
  updateCartSummary();
  setMsg(msg, "تم تفريغ السلة.", true);
}

function waitImages(root){
  const imgs = [...root.querySelectorAll("img")];
  if(imgs.length === 0) return Promise.resolve();
  return Promise.all(imgs.map(img => new Promise(res => {
    if(img.complete) return res();
    img.onload = () => res();
    img.onerror = () => res();
  })));
}

function buildOrderSnapshotEl({ orderId, createdAt, customerName, customerPhone, note, lineIds }){
  const itemsById = new Map(rowsCache.map(r => [String(r.id), r]));
  const totalRolls = lineIds.reduce((s,id)=>s+(cart[id]||0),0);

  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-10000px";
  wrap.style.top = "0";
  wrap.style.width = "1250px";
  wrap.style.boxSizing = "border-box";
  wrap.style.background = "#ffffff";
  wrap.style.padding = "16px";
  wrap.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', Tahoma, Arial";
  wrap.style.direction = "rtl";
  wrap.style.color = "#111827";

  const dtTxt = (()=>{ try{ return new Date(createdAt || Date.now()).toLocaleString("ar-EG"); }catch{ return ""; } })();

  const rowsHtml = lineIds.map(id => {
    const r = itemsById.get(String(id));
    const label = r ? materialLabel(r) : "(مادة محذوفة)";
    const cc = r?.color_code || "-";
    const cn = r?.color_name || "-";
    const qty = cart[id] || 0;
    const imgUrl = r?.image_path ? getPublicImageUrl(r.image_path) : "";
    const img = imgUrl ? `<img crossorigin="anonymous" src="${imgUrl}" style="width:150px;height:150px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;background:#f8fafc;" />` : "";

    return `
      <tr>
        <td style="width:160px;">${img}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(cc)}</td>
        <td>${escapeHtml(cn)}</td>
        <td style="text-align:center;"><strong>${parseInt(qty||0,10)}</strong></td>
      </tr>
    `;
  }).join("");

  wrap.innerHTML = `
    <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <div style="font-size:18px;font-weight:800;margin-bottom:6px;">طلب مبدئي (مسودة)</div>
          <div>الزبون: <strong>${escapeHtml(customerName)}</strong></div>
          <div>الهاتف: <strong>${escapeHtml(customerPhone)}</strong></div>
          ${note ? `<div>ملاحظة: ${escapeHtml(note)}</div>` : ``}
        </div>
        <div style="text-align:left;opacity:.75;">${escapeHtml(dtTxt)}</div>
      </div>

      <hr style="margin:12px 0;border:0;border-top:1px solid #e5e7eb;" />

      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">صورة</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">المادة</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">رقم اللون</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">اسم اللون</th>
            <th style="text-align:center;padding:10px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">الطلب (أثواب)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div style="margin-top:10px;font-size:13px;opacity:.85;">
        الإجمالي: <strong>${lineIds.length}</strong> صنف — <strong>${totalRolls}</strong> ثوب
        <span style="float:left;opacity:.7;">ID: ${escapeHtml(String(orderId).slice(0,8))}</span>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);
  return wrap;
}

async function downloadOrderSnapshotPng({ orderId, createdAt, customerName, customerPhone, note, lineIds }){
  if(!window.html2canvas){
    return;
  }
  const el = buildOrderSnapshotEl({ orderId, createdAt, customerName, customerPhone, note, lineIds });
  try{
    await waitImages(el);
    const w = Math.max(el.scrollWidth || 0, el.offsetWidth || 0);
    const h = Math.max(el.scrollHeight || 0, el.offsetHeight || 0);
    const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, allowTaint: false, width: w, height: h, windowWidth: w, windowHeight: h });
    const a = document.createElement("a");
    const safeName = String(customerName || "customer").replace(/[^0-9a-zA-Z\u0600-\u06FF_-]/g, "_");
    a.href = canvas.toDataURL("image/png");
    a.download = `order_${safeName}_${String(orderId).slice(0,8)}.png`;
    a.click();
  }finally{
    el.remove();
  }
}


// --- جلب البيانات ---
async function load(){
    setMsg(msg, "جاري تحديث البيانات...", true);
    try {
        const { data: items, error: err1 } = await supabase.from("items").select("*")
            .order("main_category").order("sub_category").order("item_name").order("color_code");
        if(err1) throw err1;

        // جلب الحركات (المخزون)
        const { data: moves, error: err2 } = await supabase.from("stock_moves").select("item_id, qty_rolls_in, qty_rolls_out");
        if(err2) throw err2;

        // جلب المحجوز (Draft)
        const { data: pending, error: err3 } = await supabase.from("customer_order_lines")
            .select("item_id, qty_rolls, customer_orders!inner(status)")
            .eq("customer_orders.status", "draft");
        if(err3) throw err3;

        // تجميع البيانات
        pendingByItem = {};
        preorderedItemIds = new Set();
        pending.forEach(p => {
          const itemId = String(p.item_id);
          preorderedItemIds.add(itemId);
          pendingByItem[itemId] = (pendingByItem[itemId] || 0) + (p.qty_rolls || 0);
        });

        const agg = new Map();
        items.forEach(it => agg.set(it.id, { ...it, balance_rolls: 0 }));
        moves.forEach(m => {
            const r = agg.get(m.item_id);
            if(r) r.balance_rolls += (m.qty_rolls_in || 0) - (m.qty_rolls_out || 0);
        });

        rowsCache = [...agg.values()];
        buildCategoryFilters();
        syncFilterButtons();
        setMsg(msg, `تم تحميل ${rowsCache.length} صنف`, true);
        render();
        updateCartSummary();
    } catch(ex) {
        setMsg(msg, explainSupabaseError(ex), false);
    }
}

// --- العرض ---
function render(){
    const rows = getFilteredRows();

    tbody.innerHTML = rows.map(r => {
        const bal = r.balance_rolls || 0;
        const prev = pendingByItem[r.id] || 0;
        const qty = cart[r.id] || 0;

        return `
            <tr data-id="${r.id}">
                <td><img src="${getPublicImageUrl(r.image_path)}" class="thumb" loading="lazy"></td>
                <td><div class="m-label">${escapeHtml(materialLabel(r))}</div></td>
                <td><span class="badge-code">${escapeHtml(r.color_code)}</span></td>
                <td>${escapeHtml(r.color_name || '-')}</td>
                <td class="txt-center">${bal}</td>
                <td class="txt-center">${prev}</td>
                <td>
                    <div class="stepper">
                        <button onclick="changeQty('${r.id}', -1)" style="width: 45px;">-</button>
                        <span class="qty-val" style="padding: 12px;">${qty}</span>
                        <button onclick="changeQty('${r.id}', 1)" style="width: 45px;">+</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// أصبحت دالة عالمية لتسهيل الاستدعاء من HTML
window.changeQty = (id, delta) => {
    const current = cart[id] || 0;
    const next = current + delta;
    if (next <= 0) delete cart[id];
    else cart[id] = next;
    saveCart(cart);
    render();
    updateCartSummary();
};

// --- المودال ---
window.openOrderModal = () => {
  const selected = rowsCache.filter(r => cart[r.id] > 0);
  if(selected.length === 0) return alert("السلة فارغة!");

  const totalRolls = selected.reduce((s,x)=>s+(cart[x.id]||0),0);
  const previewSummary = $("previewSummary");
  if(previewSummary) previewSummary.textContent = `${selected.length} صنف — ${totalRolls} ثوب`;

  $("previewWrap").innerHTML = `
    <div class="tableWrap preorder-preview-wrap">
      <table class="preorder-preview-table">
        <colgroup>
          <col class="col-img" />
          <col class="col-label" />
          <col class="col-code" />
          <col class="col-color" />
          <col class="col-qty" />
        </colgroup>
        <thead>
          <tr>
            <th>صورة</th>
            <th>المادة</th>
            <th>رقم اللون</th>
            <th>اسم اللون</th>
            <th>الطلب (أثواب)</th>
          </tr>
        </thead>
        <tbody>
          ${selected.map(x => {
            const imgUrl = x.image_path ? getPublicImageUrl(x.image_path) : "";
            const img = imgUrl ? `<img src="${imgUrl}" crossorigin="anonymous" class="preview-modal-thumb" />` : "";
            return `
              <tr>
                <td class="preview-col-img">${img}</td>
                <td class="preorder-item-cell">${escapeHtml(materialLabel(x))}</td>
                <td>${escapeHtml(x.color_code || "-")}</td>
                <td>${escapeHtml(x.color_name || "-")}</td>
                <td style="text-align:center;"><strong>${parseInt(cart[x.id]||0,10)}</strong></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  $("orderModal").style.display = "flex";
};

// إغلاق المودال
window.closeModal = () => $("orderModal").style.display = "none";

// حفظ الطلب
window.confirmOrder = async () => {
  const modalMsg = $("modalMsg");
  const btn = $("btnSave");

  const name = ($("customer_name")?.value || "").trim();
  const phone = ($("customer_phone")?.value || "").trim();
  const note = ($("note")?.value || "").trim();

  const selectedIds = Object.keys(cart).filter(id => (cart[id] || 0) > 0);
  if (selectedIds.length === 0) {
    alert("السلة فارغة!");
    return;
  }
  if (!name || !phone) {
    alert("يرجى إدخال اسم الزبون ورقم الهاتف");
    return;
  }

  const totalRolls = selectedIds.reduce((s,id)=>s+(cart[id]||0),0);
  if (!confirm(`تأكيد حفظ الطلب كمسودة؟
${selectedIds.length} صنف — ${totalRolls} ثوب`)) return;

  try{
    if (btn) { btn.disabled = true; btn.textContent = "جارٍ الحفظ..."; }
    setMsg(modalMsg, "جارٍ حفظ الطلب...", true);

    // 1) إنشاء الطلب
    const orderPayload = {
      customer_name: name,
      customer_phone: phone,
      status: "draft",
      note: note || null
    };

    const { data: orderRow, error: orderErr } = await supabase
      .from("customer_orders")
      .insert(orderPayload)
      .select("id, created_at")
      .single();

    if (orderErr) throw orderErr;

    // 2) إنشاء البنود
    const lines = selectedIds.map(id => ({
      order_id: orderRow.id,
      item_id: id,
      qty_rolls: cart[id] || 0
    }));

    const { error: linesErr } = await supabase
      .from("customer_order_lines")
      .insert(lines);

    if (linesErr) throw linesErr;

    // 3) تنزيل صورة
    await downloadOrderSnapshotPng({
      orderId: orderRow.id,
      createdAt: orderRow.created_at,
      customerName: name,
      customerPhone: phone,
      note,
      lineIds: selectedIds
    });

    // 4) تفريغ السلة
    cart = {};
    localStorage.removeItem(CART_KEY);
    updateCartSummary();
    render();

    // 5) إغلاق + تحديث بيانات (لتحديث المحجوز draft)
    closeModal();
    await load();

    setMsg(msg, "تم حفظ الطلب كمسودة وتنزيل الصورة.", true);
  }catch(ex){
    setMsg(modalMsg, explainSupabaseError(ex), false);
  }finally{
    if (btn) { btn.disabled = false; btn.textContent = "حفظ + تنزيل صورة"; }
  }
};

// ربط الأزرار
document.addEventListener("DOMContentLoaded", () => {
    $("btnConfirm")?.addEventListener("click", openOrderModal);
    $("btnConfirmFloating")?.addEventListener("click", openOrderModal);
    $("btnClear")?.addEventListener("click", clearCartOnly);
    $("btnClearFloating")?.addEventListener("click", clearCartOnly);
    $("modalClose")?.addEventListener("click", closeModal);
    $("btnCancel")?.addEventListener("click", closeModal);
    $("btnSave")?.addEventListener("click", confirmOrder);
    $("search")?.addEventListener("input", (e) => {
      uiFilters.search = e.target.value || "";
      render();
    });
    $("scope")?.addEventListener("change", (e) => {
      uiFilters.scope = e.target.value || "active";
      buildCategoryFilters();
      render();
    });
    $("filterMain")?.addEventListener("change", (e) => {
      uiFilters.filterMain = e.target.value || "";
      uiFilters.filterSub = "";
      buildCategoryFilters();
      render();
    });
    $("filterSub")?.addEventListener("change", (e) => {
      uiFilters.filterSub = e.target.value || "";
      render();
    });
    $("onlySelected")?.addEventListener("click", () => {
      uiFilters.onlySelected = !uiFilters.onlySelected;
      syncFilterButtons();
      render();
    });
    $("positiveRollsOnly")?.addEventListener("click", () => {
      positiveRollsOnly = !positiveRollsOnly;
      syncFilterButtons();
      render();
    });
    $("onlyPreordered")?.addEventListener("click", () => {
      onlyPreordered = !onlyPreordered;
      syncFilterButtons();
      render();
    });
    $("btnResetFilters")?.addEventListener("click", clearFiltersAndSearch);

    uiFilters.search = $("search")?.value || "";
    uiFilters.scope = $("scope")?.value || "active";
    uiFilters.onlySelected = false;
    positiveRollsOnly = false;
    onlyPreordered = false;
    syncFilterButtons();

    load();
});
