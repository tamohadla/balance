import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

/**
 * بيانات الموقع المصدر (المطبوع)
 */
const PRINTED_SUPABASE_URL = "https://umrczwoxjhxwvrezocrm.supabase.co";
const PRINTED_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ";
const PRINTED_TABLE = "printed_mariages";
const DEST_BUCKET = "item-images";

const printedSupabase = createClient(PRINTED_SUPABASE_URL, PRINTED_SUPABASE_ANON_KEY);

const msgEl = document.getElementById("msg") || { set textContent(v){ console.log(v) } }; 
const tbody = document.getElementById("tbody");
const summaryEl = document.getElementById("summary");

const timeRangeEl = document.getElementById("timeRange");
const statusEl = document.getElementById("statusFilter");
const qEl = document.getElementById("q");
const sortByEl = document.getElementById("sortBy");
const destMainEl = document.getElementById("destMain");
const destSubEl = document.getElementById("destSub");
const destUnitEl = document.getElementById("destUnit");

const btnFetch = document.getElementById("btnFetch");
const btnImport = document.getElementById("btnImport");
const btnSelectAll = document.getElementById("btnSelectAll");

function setMsg(text, ok=true){
  const el = document.getElementById("msg") || msgEl;
  el.textContent = text;
  el.className = ok ? "msg ok" : "msg err";
}

function normalizeStr(s){ return String(s||"").trim(); }

// مفتاح الربط للمقارنة مع قاعدة البيانات الخاصة بك بناءً على الهيكلية الجديدة
function itemKeyCandidate(row){
  const main = normalizeStr(destMainEl.value).toLowerCase();
  const sub = normalizeStr(destSubEl.value).toLowerCase();
  const item_name = `${normalizeStr(row.quality)} مطبوع رسمة ${normalizeStr(row.designcode)}`.toLowerCase();
  const color_code = normalizeStr(row.mariagenumber).toLowerCase();
  
  return `${main}|||${sub}|||${item_name}|||${color_code}`;
}

function parseISODate(d) { return normalizeStr(d); }

function maxStatus(a,b){
  const rank = { "لم يتم التشكيل":1, "تم التشكيل":2, "تم الاستلام":3 };
  return (rank[b]||0) >= (rank[a]||0) ? b : a;
}

async function fetchPrintedRows(){
  let q = printedSupabase.from(PRINTED_TABLE).select("designcode,mariagenumber,quality,imageurl,status,date");
  const status = statusEl.value;
  if(status) q = q.eq("status", status);

  const tr = timeRangeEl.value;
  if(tr === "30d") {
    const now = new Date();
    const from = new Date(now.getTime() - 30*24*60*60*1000);
    const iso = from.toISOString().slice(0,10);
    q = q.gte("date", iso);
  }

  const { data, error } = await q.limit(10000);
  if(error) throw error;

  let rows = data || [];
  const qq = normalizeStr(qEl.value).toLowerCase();
  if(qq) {
    rows = rows.filter(r =>
      String(r.designcode||"").toLowerCase().includes(qq) ||
      String(r.mariagenumber||"").toLowerCase().includes(qq) ||
      String(r.quality||"").toLowerCase().includes(qq)
    );
  }
  return rows;
}

function dedup(rows){
  const map = new Map();
  for(const r of rows){
    const k = `${normalizeStr(r.quality)}|||${normalizeStr(r.designcode)}|||${normalizeStr(r.mariagenumber)}`.toLowerCase();
    if(!map.has(k)) {
      map.set(k, {
        ...r,
        _count: 1,
        _lastDate: parseISODate(r.date),
        _lastStatus: r.status || "",
        _anyImage: normalizeStr(r.imageurl),
      });
    } else {
      const cur = map.get(k);
      cur._count += 1;
      const d = parseISODate(r.date);
      if(d && (!cur._lastDate || d > cur._lastDate)) {
        cur._lastDate = d;
        cur._lastStatus = r.status || cur._lastStatus;
        if(normalizeStr(r.imageurl)) cur._anyImage = normalizeStr(r.imageurl);
      } else {
        cur._lastStatus = maxStatus(cur._lastStatus, r.status||cur._lastStatus);
        if(!cur._anyImage && normalizeStr(r.imageurl)) cur._anyImage = normalizeStr(r.imageurl);
      }
    }
  }
  return [...map.values()];
}

const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

function sortRows(rows){
  const m = sortByEl?.value || "newest";
  rows.sort((a,b)=>{
    const ad = a._lastDate ? (Date.parse(a._lastDate) || 0) : 0;
    const bd = b._lastDate ? (Date.parse(b._lastDate) || 0) : 0;
    if(m === "newest") return bd - ad;
    return collator.compare(a.designcode, b.designcode);
  });
  return rows;
}

async function fetchExistingInventoryKeys(){
  // جلب المواد الحالية للمقارنة ومنع التكرار
  const { data, error } = await invSupabase.from("items").select("main_category,sub_category,item_name,color_code");
  if(error) throw error;

  const set = new Set();
  for(const r of (data||[])){
    const k = `${normalizeStr(r.main_category)}|||${normalizeStr(r.sub_category)}|||${normalizeStr(r.item_name)}|||${normalizeStr(r.color_code)}`.toLowerCase();
    set.add(k);
  }
  return set;
}

function render(rows, existingSet){
  tbody.innerHTML = "";
  let newCount=0, existCount=0, probCount=0;

  for(const r of rows){
    const bad = !normalizeStr(r.quality) || !normalizeStr(r.designcode) || !normalizeStr(r.mariagenumber);
    const invKey = itemKeyCandidate(r);
    const exists = existingSet.has(invKey);

    if(bad) probCount += 1;
    else if(exists) existCount += 1;
    else newCount += 1;

    const canSelect = (!bad && !exists);
    const checked = selectedKeys.has(invKey) ? " checked" : "";
    const chk = canSelect ? `<input type="checkbox" class="pick" data-key="${invKey}"${checked}>` : "";
    const imgUrl = r._anyImage || "";
    const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="">` : "—";
    const badge = bad ? `<span class="pill" style="background:#fff5cf;border-color:#f0d483">بيانات ناقصة</span>`
                      : exists ? `<span class="pill exist">موجود مسبقاً</span>`
                               : `<span class="pill new">جديد</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${chk}</td>
      <td>${normalizeStr(r.quality) || "—"}</td>
      <td>${normalizeStr(r.designcode) || "—"}</td>
      <td>${normalizeStr(r.mariagenumber) || "—"}</td>
      <td>${img}</td>
      <td>${r._count}</td>
      <td>${r._lastDate || "—"}</td>
      <td>${r._lastStatus || "—"}</td>
      <td>${badge}</td>
    `;
    tbody.appendChild(tr);
  }

  summaryEl.style.display = "block";
  summaryEl.innerHTML = `
    <div class="right"><span class="pill new">جديد: ${newCount}</span> <span class="pill exist">موجود: ${existCount}</span> <span class="pill" style="background:#fff5cf;border-color:#f0d483">نواقص: ${probCount}</span></div>
  `;

  btnImport.disabled = (newCount===0);
  btnSelectAll.disabled = (newCount===0);
}

function buildItemFromRow(r, destMain, destSub, destUnit){
  return {
    main_category: normalizeStr(destMain),
    sub_category: normalizeStr(destSub) || null,
    // الهيكلية الجديدة لاسم المادة
    item_name: `${normalizeStr(r.quality)} مطبوع رسمة ${normalizeStr(r.designcode)}`,
    color_code: normalizeStr(r.mariagenumber),
    color_name: null,
    unit_type: destUnit || "kg",
    description: `استيراد من نظام المطبوع - خامة ${r.quality}`,
    is_active: true
  };
}

async function copyImageToInventory(itemId, imageUrl){
  if(!imageUrl) return null;
  try {
    const ext = "jpg";
    const path = `items/${itemId}_${Date.now()}.${ext}`;
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    const { error: upErr } = await invSupabase.storage.from(DEST_BUCKET).upload(path, blob, { upsert: true });
    if(upErr) throw upErr;
    return path;
  } catch (e) {
    console.warn("Image upload failed", e);
    return null;
  }
}

let lastRows = [];
let existingSet = new Set();
let selectedKeys = new Set();

btnFetch.addEventListener("click", async ()=>{
  const destMain = normalizeStr(destMainEl.value);
  if(!destMain){ setMsg("⚠️ يرجى إدخال المجموعة الأساسية أولاً لضمان دقة المقارنة.", false); return; }

  btnFetch.disabled = true;
  setMsg("⏳ جاري جلب البيانات وفحص المخزون الحالي...", true);

  try {
    const raw = await fetchPrintedRows();
    const rows = dedup(raw);
    sortRows(rows);
    lastRows = rows;
    existingSet = await fetchExistingInventoryKeys();
    selectedKeys = new Set();

    render(rows, existingSet);
    setMsg(`تم جلب ${rows.length} مادة فريدة.`, true);
  } catch (e) {
    setMsg(`خطأ: ${e.message}`, false);
  } finally {
    btnFetch.disabled = false;
  }
});

btnSelectAll.addEventListener("click", ()=>{
  document.querySelectorAll(".pick").forEach(ch => {
    ch.checked = true;
    selectedKeys.add(ch.getAttribute("data-key"));
  });
});

btnImport.addEventListener("click", async ()=>{
  const destMain = normalizeStr(destMainEl.value);
  const destSub = normalizeStr(destSubEl.value);
  const destUnit = destUnitEl.value;

  const pickedRows = lastRows.filter(r => selectedKeys.has(itemKeyCandidate(r)));
  if(!pickedRows.length) return setMsg("يرجى تحديد مواد للاستيراد.", false);

  btnImport.disabled = true;
  setMsg("⏳ جاري عملية الاستيراد ونقل الصور...", true);

  let success = 0;
  for(const r of pickedRows){
    try {
      const item = buildItemFromRow(r, destMain, destSub, destUnit);
      const { data, error } = await invSupabase.from("items").insert(item).select("id").single();
      if(error) throw error;

      if(r._anyImage){
        const path = await copyImageToInventory(data.id, r._anyImage);
        if(path) await invSupabase.from("items").update({ image_path: path }).eq("id", data.id);
      }
      success++;
    } catch (e) {
      console.error("Import error", e);
    }
  }

  setMsg(`✅ تمت العملية بنجاح. تم استيراد ${success} مادة.`, true);
  btnFetch.click();
});

tbody.addEventListener("change", (e)=>{
  if(e.target.classList.contains("pick")){
    const k = e.target.getAttribute("data-key");
    if(e.target.checked) selectedKeys.add(k);
    else selectedKeys.delete(k);
  }
});
