import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const cartSummary = $("cartSummary");

const CART_KEY = "preorder_cart_v1";

function loadCart(){
  try{
    const raw = localStorage.getItem(CART_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if(!obj || typeof obj !== "object") return {};
    // تنظيف
    for(const k of Object.keys(obj)){
      const n = parseInt(obj[k], 10);
      if(!Number.isFinite(n) || n <= 0) delete obj[k];
      else obj[k] = n;
    }
    return obj;
  }catch{ return {}; }
}

function saveCart(cart){
  localStorage.setItem(CART_KEY, JSON.stringify(cart || {}));
}

let cart = loadCart();
let rowsCache = []; // rows مع الرصيد

function cartTotals(){
  const itemIds = Object.keys(cart);
  const totalItems = itemIds.length;
  const totalRolls = itemIds.reduce((s,id)=> s + (cart[id]||0), 0);
  return { totalItems, totalRolls };
}

function updateCartSummary(){
  const { totalItems, totalRolls } = cartTotals();
  cartSummary.textContent = `${totalItems} صنف — ${totalRolls} ثوب`;
}

function setQty(itemId, qty){
  const n = parseInt(qty, 10);
  if(!Number.isFinite(n) || n <= 0) delete cart[itemId];
  else cart[itemId] = n;
  saveCart(cart);
  updateCartSummary();
}

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
    const chunk = itemIds.slice(i,i+chunkSize);
    const { data, error } = await supabase
      .from("stock_moves")
      .select("item_id, qty_rolls_in, qty_rolls_out")
      .in("item_id", chunk);
    if(error) throw error;
    all.push(...(data||[]));
  }
  return all;
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
  if(onlySelected){
    rows = rows.filter(r => (cart[r.id]||0) > 0);
  }

  tbody.innerHTML = rows.map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" />` : `<span class="thumb"></span>`;
    const qty = cart[r.id] || 0;

    return `
      <tr data-id="${r.id}">
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td>${parseInt(r.balance_rolls||0,10)}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px; justify-content:center;">
            <button class="secondary btnMinus" type="button" style="padding:4px 10px;">-</button>
            <span class="qty" style="min-width:32px; text-align:center; font-weight:700;">${qty}</span>
            <button class="secondary btnPlus" type="button" style="padding:4px 10px;">+</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // events
  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.getAttribute("data-id");
    tr.querySelector(".btnPlus").addEventListener("click", () => {
      setQty(id, (cart[id]||0) + 1);
      tr.querySelector(".qty").textContent = String(cart[id]||0);
    });
    tr.querySelector(".btnMinus").addEventListener("click", () => {
      setQty(id, (cart[id]||0) - 1);
      tr.querySelector(".qty").textContent = String(cart[id]||0);
      if($("onlySelected").checked && !(cart[id] > 0)) render();
    });
  });
}

async function load(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";
  try{
    const items = await fetchItems();
    const moves = await fetchMovesForItems(items.map(i=>i.id));

    const agg = new Map();
    for(const it of items){
      agg.set(it.id, { ...it, balance_rolls: 0 });
    }
    for(const m of moves){
      const r = agg.get(m.item_id);
      if(!r) continue;
      r.balance_rolls += (m.qty_rolls_in||0) - (m.qty_rolls_out||0);
    }

    rowsCache = [...agg.values()];
    setMsg(msg, `تم التحميل: ${rowsCache.length} مادة`, true);
    render();
    updateCartSummary();
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

function openModal(){
  const { totalItems } = cartTotals();
  if(totalItems === 0){
    setMsg(msg, "اختر أصناف أولاً (+) قبل تأكيد الطلب.", false);
    return;
  }

  // build preview table for selected
  const selected = rowsCache
    .filter(r => (cart[r.id]||0) > 0)
    .map(r => ({
      id: r.id,
      label: materialLabel(r),
      color_code: r.color_code,
      color_name: r.color_name,
      balance_rolls: parseInt(r.balance_rolls||0,10),
      qty: cart[r.id]
    }));

  const totalRolls = selected.reduce((s,x)=>s+x.qty,0);
  $("previewSummary").textContent = `${selected.length} صنف — ${totalRolls} ثوب`;
  $("previewWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>المادة</th>
          <th>رقم اللون</th>
          <th>اسم اللون</th>
          <th>رصيد الأثواب</th>
          <th>الطلب (أثواب)</th>
        </tr>
      </thead>
      <tbody>
        ${selected.map(x=>`
          <tr>
            <td>${escapeHtml(x.label)}</td>
            <td>${escapeHtml(x.color_code)}</td>
            <td>${escapeHtml(x.color_name)}</td>
            <td>${x.balance_rolls}</td>
            <td><strong>${x.qty}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  $("modalMsg").textContent = "";
  $("orderModal").style.display = "block";
}

function closeModal(){
  $("orderModal").style.display = "none";
}

function makeSnapshotElement(order, selected){
  // عنصر مؤقت للتصوير
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-99999px";
  wrap.style.top = "0";
  wrap.style.background = "white";
  wrap.style.padding = "16px";
  wrap.style.width = "1100px";
  wrap.style.direction = "rtl";
  wrap.style.fontFamily = "Arial, sans-serif";

  const dt = new Date().toLocaleString("ar-EG");
  wrap.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
      <div>
        <div style="font-size:20px; font-weight:800; margin-bottom:6px;">طلب مبدئي (مسودة)</div>
        <div>الزبون: <strong>${escapeHtml(order.customer_name)}</strong></div>
        <div>الهاتف: <strong>${escapeHtml(order.customer_phone)}</strong></div>
        ${order.note ? `<div>ملاحظة: ${escapeHtml(order.note)}</div>` : ``}
      </div>
      <div style="text-align:left; opacity:.8;">${escapeHtml(dt)}</div>
    </div>
    <hr style="margin:12px 0;" />
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr>
          <th style="border:1px solid #ddd; padding:8px;">المادة</th>
          <th style="border:1px solid #ddd; padding:8px;">رقم اللون</th>
          <th style="border:1px solid #ddd; padding:8px;">اسم اللون</th>
          <th style="border:1px solid #ddd; padding:8px;">رصيد الأثواب</th>
          <th style="border:1px solid #ddd; padding:8px;">الطلب (أثواب)</th>
        </tr>
      </thead>
      <tbody>
        ${selected.map(x=>`
          <tr>
            <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(x.label)}</td>
            <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(x.color_code)}</td>
            <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(x.color_name)}</td>
            <td style="border:1px solid #ddd; padding:8px; text-align:center;">${x.balance_rolls}</td>
            <td style="border:1px solid #ddd; padding:8px; text-align:center; font-weight:800;">${x.qty}</td>
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
  try{
    const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = fileName;
    a.click();
  } finally {
    el.remove();
  }
}

async function saveOrder(){
  const customer_name = $("customer_name").value.trim();
  const customer_phone = $("customer_phone").value.trim();
  const note = $("note").value.trim();

  if(!customer_name || !customer_phone){
    $("modalMsg").textContent = "اسم الزبون ورقم الهاتف مطلوبان.";
    return;
  }

  const selected = rowsCache
    .filter(r => (cart[r.id]||0) > 0)
    .map(r => ({
      item_id: r.id,
      qty_rolls: cart[r.id],
      label: materialLabel(r),
      color_code: r.color_code,
      color_name: r.color_name,
      balance_rolls: parseInt(r.balance_rolls||0,10)
    }));

  if(selected.length === 0){
    $("modalMsg").textContent = "لا يوجد أصناف محددة.";
    return;
  }

  try{
    $("btnSave").disabled = true;
    $("modalMsg").textContent = "حفظ...";

    const { data: orderRow, error: orderErr } = await supabase
      .from("customer_orders")
      .insert({ customer_name, customer_phone, note: note || null, status: "draft" })
      .select("id")
      .single();
    if(orderErr) throw orderErr;

    const linesPayload = selected.map(x => ({
      order_id: orderRow.id,
      item_id: x.item_id,
      qty_rolls: x.qty_rolls
    }));

    const { error: linesErr } = await supabase
      .from("customer_order_lines")
      .insert(linesPayload);
    if(linesErr) throw linesErr;

    // تنزيل صورة (بدون تخزين)
    const safeName = customer_name.replace(/[^0-9a-zA-Z\u0600-\u06FF_-]/g, "_");
    await downloadSnapshotPng(
      { customer_name, customer_phone, note },
      selected,
      `order_${safeName}_${orderRow.id.slice(0,8)}.png`
    );

    // تنظيف السلة
    cart = {};
    saveCart(cart);
    updateCartSummary();
    closeModal();
    render();

    // اذهب لصفحة الطلبات وافتح الطلب
    window.location.href = `./orders.html?id=${encodeURIComponent(orderRow.id)}`;
  }catch(ex){
    $("modalMsg").textContent = explainSupabaseError(ex);
  }finally{
    $("btnSave").disabled = false;
  }
}

// Events
$("btnClear").addEventListener("click", () => {
  cart = {};
  saveCart(cart);
  updateCartSummary();
  render();
});

$("btnConfirm").addEventListener("click", openModal);
$("modalClose").addEventListener("click", closeModal);
$("btnCancel").addEventListener("click", closeModal);
$("btnSave").addEventListener("click", saveOrder);

$("search").addEventListener("input", () => { clearTimeout(window.__ti); window.__ti = setTimeout(render, 200); });
$("scope").addEventListener("change", load);
$("onlySelected").addEventListener("change", render);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();
