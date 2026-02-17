import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const cartSummary = $("cartSummary");
const cartSummaryFloating = $("cartSummaryFloating");
const CART_KEY = "preorder_cart_v1";

// --- إدارة السلة والتخزين ---
let cart = loadCart();
let rowsCache = []; 
let pendingByItem = {}; 

function loadCart(){
  try{
    const raw = localStorage.getItem(CART_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if(!obj || typeof obj !== "object") return {};
    for(const k of Object.keys(obj)){
      const n = parseInt(obj[k], 10);
      if(!Number.isFinite(n) || n <= 0) delete obj[k];
      else obj[k] = n;
    }
    return obj;
  } catch { return {}; }
}

function saveCart(newCart){
  cart = newCart || {};
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

// دالة لمسح الكاش وإعادة التحميل القسري
async function hardRefresh() {
  if(!confirm("سيتم مسح السلة الحالية وتحديث البيانات من السيرفر، هل أنت متأكد؟")) return;
  localStorage.removeItem(CART_KEY);
  cart = {};
  await load();
}

function cartTotals(){
  const itemIds = Object.keys(cart);
  return {
    totalItems: itemIds.length,
    totalRolls: itemIds.reduce((s, id) => s + (cart[id] || 0), 0)
  };
}

function updateCartSummary(){
  const { totalItems, totalRolls } = cartTotals();
  const txt = `${totalItems} صنف — ${totalRolls} ثوب`;
  if(cartSummary) cartSummary.textContent = txt;
  if(cartSummaryFloating) cartSummaryFloating.textContent = txt;
}

// --- جلب البيانات ---
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
  for(let i=0; i<itemIds.length; i+=chunkSize){
    const chunk = itemIds.slice(i, i+chunkSize);
    const { data, error } = await supabase
      .from("stock_moves")
      .select("item_id, qty_rolls_in, qty_rolls_out")
      .in("item_id", chunk);
    if(error) throw error;
    all.push(...(data || []));
  }
  return all;
}

async function fetchPendingDraftByItem(itemIds){
  if(!itemIds || itemIds.length === 0) return {};
  const acc = {};
  const { data, error } = await supabase
    .from("customer_order_lines")
    .select("item_id, qty_rolls, customer_orders!inner(status)")
    .in("item_id", itemIds)
    .eq("customer_orders.status", "draft");

  if(error) throw error;
  for(const r of (data || [])){
    acc[r.item_id] = (acc[r.item_id] || 0) + (parseInt(r.qty_rolls, 10) || 0);
  }
  return acc;
}

// --- العرض والتحكم ---
function getRowStats(r) {
  const bal = parseInt(r.balance_rolls || 0, 10);
  const prev = (pendingByItem[r.id] || 0);
  const qty = (cart[r.id] || 0);
  const afterPrev = bal - prev;
  const afterThis = afterPrev - qty;
  return { bal, prev, qty, afterPrev, afterThis };
}

function render(){
  const q = $("search").value.trim().toLowerCase();
  const onlySelected = $("onlySelected").checked;

  let rows = rowsCache;
  if(q){
    rows = rows.filter(r => {
      const hay = `${materialLabel(r)} ${r.color_code} ${r.color_name} ${r.description||""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if(onlySelected) rows = rows.filter(r => (cart[r.id] || 0) > 0);

  tbody.innerHTML = rows.map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" loading="lazy" />` : `<span class="thumb"></span>`;
    const { bal, qty, afterPrev, afterThis } = getRowStats(r);
    const colorStyle = afterThis < 0 ? 'style="color: #b42318;"' : '';

    return `
      <tr data-id="${r.id}">
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td class="bal">${bal}</td>
        <td class="afterBal" ${colorStyle}>
          <strong>${afterPrev}</strong>
          <div class="muted" style="font-size:12px; margin-top:4px;">بعد هذا الطلب: <b>${afterThis}</b></div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:8px; justify-content:center;">
            <button class="secondary btnMinus" type="button">-</button>
            <span class="qty" style="min-width:32px; text-align:center; font-weight:700;">${qty}</span>
            <button class="secondary btnPlus" type="button">+</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  attachRowEvents();
}

function attachRowEvents() {
  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const item = rowsCache.find(x => x.id === id);
    
    const updateUI = () => {
      const { qty, afterPrev, afterThis } = getRowStats(item);
      tr.querySelector(".qty").textContent = qty;
      const afterEl = tr.querySelector(".afterBal");
      afterEl.innerHTML = `<strong>${afterPrev}</strong><div class="muted" style="font-size:12px;margin-top:4px;">بعد هذا الطلب: <b>${afterThis}</b></div>`;
      afterEl.style.color = (afterThis < 0) ? "#b42318" : "";
      updateCartSummary();
    };

    tr.querySelector(".btnPlus").addEventListener("click", () => {
      cart[id] = (cart[id] || 0) + 1;
      saveCart(cart);
      updateUI();
    });

    tr.querySelector(".btnMinus").addEventListener("click", () => {
      const newQty = (cart[id] || 0) - 1;
      if(newQty <= 0) delete cart[id];
      else cart[id] = newQty;
      saveCart(cart);
      if($("onlySelected").checked && !cart[id]) render();
      else updateUI();
    });
  });
}

async function load(){
  setMsg(msg, "تحميل البيانات...", true);
  try{
    const items = await fetchItems();
    const moves = await fetchMovesForItems(items.map(i => i.id));
    pendingByItem = await fetchPendingDraftByItem(items.map(i => i.id));

    const agg = new Map();
    items.forEach(it => agg.set(it.id, { ...it, balance_rolls: 0 }));
    moves.forEach(m => {
      const r = agg.get(m.item_id);
      if(r) r.balance_rolls += (m.qty_rolls_in || 0) - (m.qty_rolls_out || 0);
    });

    rowsCache = [...agg.values()];
    setMsg(msg, `تم التحميل: ${rowsCache.length} مادة`, true);
    render();
    updateCartSummary();
  } catch(ex) {
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

// --- النوافذ المنبثقة (Modal) ---
function openModal(){
  const { totalItems } = cartTotals();
  if(totalItems === 0) return setMsg(msg, "اختر أصنافاً أولاً.", false);

  const selected = rowsCache
    .filter(r => (cart[r.id] || 0) > 0)
    .map(r => ({ ...r, qty: cart[r.id], label: materialLabel(r) }));

  $("previewSummary").textContent = `${selected.length} صنف — ${selected.reduce((s,x)=>s+x.qty,0)} ثوب`;
  $("previewWrap").innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr>
          <th>صورة</th><th>المادة</th><th>اللون</th><th>الطلب</th>
        </tr>
      </thead>
      <tbody>
        ${selected.map(x => `
          <tr>
            <td style="text-align:center;"><img src="${getPublicImageUrl(x.image_path)}" style="width:60px; height:60px; object-fit:cover; border-radius:5px;"></td>
            <td style="font-size:13px;">${escapeHtml(x.label)}</td>
            <td>${escapeHtml(x.color_code)}</td>
            <td style="text-align:center;"><strong>${x.qty}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  $("modalMsg").textContent = "";
  $("orderModal").style.display = "flex";
}

function closeModal() { $("orderModal").style.display = "none"; }

async function saveOrder(){
  const customer_name = $("customer_name").value.trim();
  const customer_phone = $("customer_phone").value.trim();
  if(!customer_name || !customer_phone) return $("modalMsg").textContent = "الاسم والهاتف مطلوبان.";

  const selected = rowsCache.filter(r => (cart[r.id]||0) > 0).map(r => ({
    item_id: r.id, qty_rolls: cart[r.id], label: materialLabel(r),
    color_code: r.color_code, color_name: r.color_name, balance_rolls: r.balance_rolls, image_path: r.image_path
  }));

  try {
    $("btnSave").disabled = true;
    $("modalMsg").textContent = "جاري الحفظ والتحميل...";

    const { data: orderRow, error: orderErr } = await supabase
      .from("customer_orders")
      .insert({ customer_name, customer_phone, note: $("note").value.trim() || null, status: "draft" })
      .select("id").single();
    if(orderErr) throw orderErr;

    const { error: linesErr } = await supabase.from("customer_order_lines").insert(
      selected.map(x => ({ order_id: orderRow.id, item_id: x.item_id, qty_rolls: x.qty_rolls }))
    );
    if(linesErr) throw linesErr;

    // Snapshot
    const orderIdStr = String(orderRow.id).slice(0, 8);
    await downloadSnapshotPng({ customer_name, customer_phone, note: $("note").value }, selected, `order_${orderIdStr}.png`);

    saveCart({});
    updateCartSummary();
    closeModal();
    window.location.href = `./orders.html?id=${encodeURIComponent(orderRow.id)}`;
  } catch(ex) {
    $("modalMsg").textContent = explainSupabaseError(ex);
    $("btnSave").disabled = false;
  }
}

// --- Snapshot (تصحيح المنطق) ---
function makeSnapshotElement(order, selected){
  const wrap = document.createElement("div");
  wrap.className = "snapshot-print-area"; // للتنسيق الخارجي إن وجد
  wrap.style = "position:fixed; left:-9999px; top:0; background:white; padding:20px; width:900px; direction:rtl; font-family:sans-serif;";
  
  wrap.innerHTML = `
    <h2 style="margin-bottom:5px;">طلب مسبق (مسودة)</h2>
    <p>الزبون: <b>${escapeHtml(order.customer_name)}</b> | الهاتف: <b>${escapeHtml(order.customer_phone)}</b></p>
    <hr>
    <table style="width:100%; border-collapse:collapse; margin-top:15px;">
      <thead>
        <tr style="background:#f9f9f9;">
          <th style="border:1px solid #eee; padding:10px;">صورة</th>
          <th style="border:1px solid #eee; padding:10px;">المادة واللون</th>
          <th style="border:1px solid #eee; padding:10px;">الكمية</th>
        </tr>
      </thead>
      <tbody>
        ${selected.map(x => `
          <tr>
            <td style="border:1px solid #eee; text-align:center;"><img src="${getPublicImageUrl(x.image_path)}" style="width:120px; height:120px; object-fit:cover;"></td>
            <td style="border:1px solid #eee; padding:10px;">${escapeHtml(x.label)}<br>لون: ${escapeHtml(x.color_code)} - ${escapeHtml(x.color_name)}</td>
            <td style="border:1px solid #eee; text-align:center; font-size:20px;"><b>${x.qty_rolls}</b></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

async function downloadSnapshotPng(order, selected, fileName){
  const el = makeSnapshotElement(order, selected);
  try {
    await waitImages(el);
    const canvas = await window.html2canvas(el, { scale: 2, useCORS: true });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = fileName;
    a.click();
  } finally { el.remove(); }
}

function waitImages(root){
  const imgs = [...root.querySelectorAll("img")];
  return Promise.all(imgs.map(img => new Promise(res => {
    if(img.complete) res(); else { img.onload = res; img.onerror = res; }
  })));
}

// --- Events ---
$("btnClear").addEventListener("click", () => { if(confirm("حذف السلة؟")) { saveCart({}); render(); updateCartSummary(); } });
$("btnConfirm").addEventListener("click", openModal);
$("modalClose").addEventListener("click", closeModal);
$("btnCancel").addEventListener("click", closeModal);
$("btnSave").addEventListener("click", saveOrder);
$("search").addEventListener("input", () => { clearTimeout(window.__ti); window.__ti = setTimeout(render, 250); });
$("scope").addEventListener("change", load);
$("onlySelected").addEventListener("change", render);

// زر "تحديث الكاش" إذا أردت إضافته في HTML لاحقاً
$("btnReloadData")?.addEventListener("click", hardRefresh);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();
