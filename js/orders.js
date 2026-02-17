import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, explainSupabaseError, keysLookUnchanged, testSupabaseConnection } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const detailsCard = $("detailsCard");
const details = $("details");

let ordersCache = [];
let currentOrder = null;
let currentLines = [];

function getQueryId(){
  const url = new URL(window.location.href);
  return url.searchParams.get("id");
}

function fmtDate(ts){
  try{
    const d = new Date(ts);
    return d.toLocaleString("ar-EG");
  }catch{ return ts || "-"; }
}

async function fetchOrders(){
  const status = $("status").value;
  let q = supabase.from("customer_orders")
    .select("id, created_at, customer_name, customer_phone, status, note")
    .order("created_at", { ascending: false });
  if(status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

function renderOrders(){
  const q = $("search").value.trim().toLowerCase();
  let rows = ordersCache;
  if(q){
    rows = rows.filter(o => `${o.customer_name||""} ${o.customer_phone||""}`.toLowerCase().includes(q));
  }

  tbody.innerHTML = rows.map(o => `
    <tr>
      <td>${escapeHtml(fmtDate(o.created_at))}</td>
      <td>${escapeHtml(o.customer_name)}</td>
      <td>${escapeHtml(o.customer_phone)}</td>
      <td>${escapeHtml(o.status)}</td>
      <td><button class="secondary btnOpen" data-id="${o.id}">فتح</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btnOpen").forEach(btn => {
    btn.addEventListener("click", () => openOrder(btn.getAttribute("data-id")));
  });
}

async function fetchLines(orderId){
  const { data, error } = await supabase
    .from("customer_order_lines")
    .select("item_id, qty_rolls")
    .eq("order_id", orderId);
  if(error) throw error;
  return data || [];
}

async function fetchItemsByIds(ids){
  if(ids.length === 0) return [];
  const all = [];
  const chunkSize = 200;
  for(let i=0;i<ids.length;i+=chunkSize){
    const chunk = ids.slice(i,i+chunkSize);
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .in("id", chunk);
    if(error) throw error;
    all.push(...(data||[]));
  }
  return all;
}

function buildDetailsHtml(order, lines, itemsMap){
  const totalRolls = lines.reduce((s,l)=>s+(l.qty_rolls||0),0);
  const header = `
    <div id="snapshotArea" class="card" style="background:#fafafa;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div>
          <div style="font-size:18px; font-weight:800; margin-bottom:6px;">طلب مبدئي (مسودة)</div>
          <div>الزبون: <strong>${escapeHtml(order.customer_name)}</strong></div>
          <div>الهاتف: <strong>${escapeHtml(order.customer_phone)}</strong></div>
          ${order.note ? `<div>ملاحظة: ${escapeHtml(order.note)}</div>` : ``}
        </div>
        <div style="text-align:left; opacity:.8;">${escapeHtml(fmtDate(order.created_at))}</div>
      </div>
      <hr style="margin:12px 0;" />
      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>المادة</th>
              <th>رقم اللون</th>
              <th>اسم اللون</th>
              <th>الطلب (أثواب)</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map(l => {
              const it = itemsMap.get(l.item_id);
              const label = it ? materialLabel(it) : "(مادة محذوفة)";
              const cc = it?.color_code || "-";
              const cn = it?.color_name || "-";
              return `
                <tr>
                  <td>${escapeHtml(label)}</td>
                  <td>${escapeHtml(cc)}</td>
                  <td>${escapeHtml(cn)}</td>
                  <td><strong>${parseInt(l.qty_rolls||0,10)}</strong></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;" class="muted">الإجمالي: <strong>${lines.length}</strong> صنف — <strong>${totalRolls}</strong> ثوب</div>
    </div>
  `;
  return header;
}

async function downloadDetailsPng(){
  const el = document.getElementById("snapshotArea");
  if(!el) return;
  const safeName = (currentOrder?.customer_name || "customer").replace(/[^0-9a-zA-Z\u0600-\u06FF_-]/g, "_");
  const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `order_${safeName}_${(currentOrder?.id||"").slice(0,8)}.png`;
  a.click();
}

async function openOrder(orderId){
  try{
    setMsg(msg, "تحميل تفاصيل الطلب...", true);
    const order = ordersCache.find(o => o.id === orderId);
    if(!order) throw new Error("الطلب غير موجود.");

    const lines = await fetchLines(orderId);
    const ids = [...new Set(lines.map(l=>l.item_id))];
    const items = await fetchItemsByIds(ids);
    const map = new Map(items.map(it => [it.id, it]));

    currentOrder = order;
    currentLines = lines;

    $("dTitle").textContent = `تفاصيل الطلب: ${order.customer_name}`;
    details.innerHTML = buildDetailsHtml(order, lines, map);
    detailsCard.style.display = "block";

    setMsg(msg, "", true);
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

async function load(){
  try{
    setMsg(msg, "تحميل...", true);
    ordersCache = await fetchOrders();
    renderOrders();
    setMsg(msg, `تم التحميل: ${ordersCache.length} طلب`, true);

    const openId = getQueryId();
    if(openId){
      const exists = ordersCache.some(o=>o.id === openId);
      if(exists) await openOrder(openId);
    }
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

// events
$("btnReload").addEventListener("click", load);
$("search").addEventListener("input", () => { clearTimeout(window.__ti); window.__ti = setTimeout(renderOrders, 200); });
$("status").addEventListener("change", load);
$("btnCloseDetails").addEventListener("click", () => { detailsCard.style.display = "none"; details.innerHTML = ""; currentOrder=null; currentLines=[]; });
$("btnDownload").addEventListener("click", downloadDetailsPng);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();
