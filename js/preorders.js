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
let pendingByItem = {}; // مجموع الأثواب المحجوزة في الطلبات السابقة (مسودات)

function cartTotals(){
  const itemIds = Object.keys(cart);
  const totalItems = itemIds.length;
  const totalRolls = itemIds.reduce((s,id)=> s + (cart[id]||0), 0);
  return { totalItems, totalRolls };
}

function updateCartSummary(){
  const { totalItems, totalRolls } = cartTotals();
  cartSummary.textContent = `${totalItems} صنف — ${totalRolls} ثوب`;
  if(cartSummaryFloating) cartSummaryFloating.textContent = `${totalItems} صنف — ${totalRolls} ثوب`;
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
async function fetchPendingDraftByItem(itemIds){
  if(!itemIds || itemIds.length === 0) return {};
  // قد تحتاج تقسيم لو القائمة كبيرة
  const chunkSize = 500;
  const acc = {};
  for(let i=0; i<itemIds.length; i+=chunkSize){
    const chunk = itemIds.slice(i, i+chunkSize);

    // نجلب بنود الطلبات التي حالتها draft فقط
    const { data, error } = await supabase
      .from("customer_order_lines")
      .select("item_id, qty_rolls, customer_orders!inner(status)")
      .in("item_id", chunk)
      .eq("customer_orders.status", "draft");

    if(error) throw error;
    for(const r of (data||[])){
      const id = r.item_id;
      const q = parseInt(r.qty_rolls||0, 10) || 0;
      acc[id] = (acc[id]||0) + q;
    }
  }
  return acc;
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
    const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" loading="lazy" />` : `<span class="thumb"></span>`;
    const qty = cart[r.id] || 0;
    const bal = parseInt(r.balance_rolls||0,10);
    const prev = (pendingByItem[r.id]||0);
    const afterPrev = bal - prev;
    const afterThis = afterPrev - qty;

    return `
      <tr data-id="${r.id}">
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td class="bal">${bal}</td>
        <td class="afterBal"><strong>${afterPrev}</strong><div class="muted" style="font-size:12px;margin-top:4px;">بعد هذا الطلب: <b>${afterThis}</b></div></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px; justify-content:center;">
            <button class="secondary btnMinus" type="button" style="padding:4px 10px; min-height:44px;">-</button>
            <span class="qty" style="min-width:32px; text-align:center; font-weight:700;">${qty}</span>
            <button class="secondary btnPlus" type="button" style="padding:4px 10px; min-height:44px;">+</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // events
  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const bal = parseInt(tr.querySelector(".bal")?.textContent || "0", 10) || 0;
    const afterEl = tr.querySelector(".afterBal");
    if(afterEl){
      const prev = (pendingByItem[id]||0);
      const afterPrev = bal - prev;
      const afterThis = afterPrev - (cart[id]||0);
      afterEl.style.color = (afterThis < 0) ? "#b42318" : "";
    }
    tr.querySelector(".btnPlus").addEventListener("click", () => {
      setQty(id, (cart[id]||0) + 1);
      tr.querySelector(".qty").textContent = String(cart[id]||0);
      if(afterEl) afterEl.innerHTML = `<strong>${bal - (pendingByItem[id]||0)}</strong><div class="muted" style="font-size:12px;margin-top:4px;">بعد هذا الطلب: <b>${(bal - (pendingByItem[id]||0)) - (cart[id]||0)}</b></div>`;
      if(afterEl){
        const prev = (pendingByItem[id]||0);
        const afterPrev = bal - prev;
        const afterThis = afterPrev - (cart[id]||0);
        afterEl.style.color = (afterThis < 0) ? "#b42318" : "";
      }
    });
    tr.querySelector(".btnMinus").addEventListener("click", () => {
      setQty(id, (cart[id]||0) - 1);
      tr.querySelector(".qty").textContent = String(cart[id]||0);
      if(afterEl) afterEl.innerHTML = `<strong>${bal - (pendingByItem[id]||0)}</strong><div class="muted" style="font-size:12px;margin-top:4px;">بعد هذا الطلب: <b>${(bal - (pendingByItem[id]||0)) - (cart[id]||0)}</b></div>`;
      if(afterEl){
        const prev = (pendingByItem[id]||0);
        const afterPrev = bal - prev;
        const afterThis = afterPrev - (cart[id]||0);
        afterEl.style.color = (afterThis < 0) ? "#b42318" : "";
      }
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
    pendingByItem = await fetchPendingDraftByItem(items.map(i=>i.id));

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
      qty: cart[r.id],
      prev_reserved: (pendingByItem[r.id]||0),
      image_path: r.image_path
    }));

  const totalRolls = selected.reduce((s,x)=>s+x.qty,0);
  $("previewSummary").textContent = `${selected.length} صنف — ${totalRolls} ثوب`;
  $("previewWrap").innerHTML = `
    <table style="width:100%; table-layout:fixed; border-collapse:collapse;">
      <colgroup>
        <col style="width:170px;" />
        <col style="width:210px;" />
        <col style="width:90px;" />
        <col style="width:120px;" />
        <col style="width:90px;" />
      </colgroup>
      <thead>
        <tr>
          <th style="padding:10px 8px; text-align:center; border-bottom:1px solid #eee;">صورة</th>
          <th style="padding:10px 8px; text-align:right; border-bottom:1px solid #eee;">المادة</th>
          <th style="padding:10px 8px; text-align:center; border-bottom:1px solid #eee;">رقم اللون</th>
          <th style="padding:10px 8px; text-align:center; border-bottom:1px solid #eee;">اسم اللون</th>
          <th style="padding:10px 8px; text-align:center; border-bottom:1px solid #eee;">الطلب</th>
        </tr>
      </thead>
      <tbody>
        ${selected.map(x=>{
          const imgUrl = getPublicImageUrl(x.image_path);
          const img = imgUrl
            ? `<img src="${imgUrl}" crossorigin="anonymous"
                 style="width:160px;height:160px;object-fit:cover;border-radius:10px;border:1px solid #eee;display:block;margin:auto;" />`
            : `<div style="width:160px;height:160px;border-radius:10px;border:1px solid #eee;background:#fafafa;margin:auto;"></div>`;
          return `
            <tr>
              <td style="padding:10px 8px; text-align:center; vertical-align:top;">${img}</td>
              <td style="padding:10px 8px; vertical-align:top; max-width:210px; white-space:normal; word-break:break-word; line-height:1.35;">
                ${escapeHtml(x.label)}
              </td>
              <td style="padding:10px 8px; text-align:center; vertical-align:top;">${escapeHtml(x.color_code)}</td>
              <td style="padding:10px 8px; text-align:center; vertical-align:top;">${escapeHtml(x.color_name)}</td>
              <td style="padding:10px 8px; text-align:center; vertical-align:top; font-weight:800;">${x.qty}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
          const avail = (x.balance_rolls||0) - (x.prev_reserved||0);
          const after = avail - (x.qty||0);
          return `
            <tr>
              <td >${img}</td>
              <td style="max-width:140px; white-space:normal; word-break:break-word; line-height:1.35;">${escapeHtml(x.label)}</td>
              
              <td>${escapeHtml(x.color_code)}</td>
              <td>${escapeHtml(x.color_name)}</td>

              <td><strong>${x.qty}</strong></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  $("modalMsg").textContent = "";
  $("orderModal").style.display = "flex";
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
    <table style="width:100%; table-layout:fixed; border-collapse:collapse;">
      <thead>
        <tr>
          <th style="border:1px solid #ddd; padding:8px;">صورة</th>
          <th style="border:1px solid #ddd; padding:8px;">المادة</th>
          <th style="border:1px solid #ddd; padding:8px;">رقم اللون</th>
          <th style="border:1px solid #ddd; padding:8px;">اسم اللون</th>

          <th style="border:1px solid #ddd; padding:8px;">الطلب (أثواب)</th>
        </tr>
      </thead>
      <tbody>
        ${selected.map(x=>{
          const imgUrl = getPublicImageUrl(x.image_path);
          const img = imgUrl ? `<img src="${imgUrl}" crossorigin="anonymous" style="width:150px;height:150px;object-fit:cover;border-radius:10px;border:1px solid #eee;" />` : ``;
          const qty = (x.qty ?? x.qty_rolls ?? 0);
          const key = x.id || x.item_id;
          const prev = (pendingByItem[key]||0);
          const avail = (x.balance_rolls||0) - prev;
          const after = avail - (qty||0);
          return `
            <tr>
              <td style="border:1px solid #ddd; padding:8px; text-align:center;">${img}</td>
              <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(x.label)}</td>
              <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(x.color_code)}</td>
              <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(x.color_name)}</td>
              
              <td style="border:1px solid #ddd; padding:8px; text-align:center; font-weight:800;">${qty}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

async function downloadSnapshotPng(order, selected, fileName){
  const el = makeSnapshotElement(order, selected);
  try{
    await waitImages(el);
    const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, allowTaint: false });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = fileName;
    a.click();
  } finally {
    el.remove();
  }
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
      qty: cart[r.id],
      prev_reserved: (pendingByItem[r.id]||0),
      label: materialLabel(r),
      color_code: r.color_code,
      color_name: r.color_name,
      balance_rolls: parseInt(r.balance_rolls||0,10),
      image_path: r.image_path
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

// أزرار الشريط الثابت
$("btnClearFloating")?.addEventListener("click", () => $("btnClear").click());
$("btnConfirmFloating")?.addEventListener("click", () => $("btnConfirm").click());

$("btnConfirm").addEventListener("click", openModal);
$("modalClose").addEventListener("click", closeModal);
$("btnCancel").addEventListener("click", closeModal);
$("btnSave").addEventListener("click", saveOrder);

$("search").addEventListener("input", () => { clearTimeout(window.__ti); window.__ti = setTimeout(render, 200); });
$("scope").addEventListener("change", load);
$("onlySelected").addEventListener("change", render);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();
