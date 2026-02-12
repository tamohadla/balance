import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

/**
 * Source (printed) — these values are constants from printed_2.html
 * ملاحظة: حتى لو لم نعرضها في الواجهة، فهي تبقى قابلة للاطلاع داخل كود الواجهة.
 * إذا تريد إخفاءها فعلاً نحتاج Edge Function / سيرفر وسيط.
 */
const PRINTED_SUPABASE_URL = "https://umrczwoxjhxwvrezocrm.supabase.co";
const PRINTED_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ";
const PRINTED_TABLE = "printed_mariages";
const DEST_BUCKET = "item-images";

const printedSupabase = createClient(PRINTED_SUPABASE_URL, PRINTED_SUPABASE_ANON_KEY);

const msgEl = document.getElementById("msg");
const tbody = document.getElementById("tbody");
const summaryEl = document.getElementById("summary");

const timeRangeEl = document.getElementById("timeRange");
const statusEl = document.getElementById("statusFilter");
const qEl = document.getElementById("q");

const btnFetch = document.getElementById("btnFetch");
const btnImport = document.getElementById("btnImport");
const btnSelectAll = document.getElementById("btnSelectAll");

function setMsg(text, ok=true){
  msgEl.textContent = text;
  msgEl.style.borderColor = ok ? "#cfead8" : "#f3c6c6";
  msgEl.style.background = ok ? "#f3fff7" : "#fff5f5";
}

function normalizeStr(s){ return String(s||"").trim(); }
function keyOf(quality, designcode, mariage) {
  return `${normalizeStr(quality).toLowerCase()}|||${normalizeStr(designcode)}|||${normalizeStr(mariage)}`;
}

function itemKeyCandidate(row){
  const main_category = normalizeStr(row.quality);
  const sub_category  = "مطبوع";
  const item_name     = `رسمة ${normalizeStr(row.designcode)}`;
  const color_code    = normalizeStr(row.mariagenumber);
  return `${main_category.toLowerCase()}|||${sub_category.toLowerCase()}|||${item_name.toLowerCase()}|||${color_code.toLowerCase()}`;
}

function parseISODate(d) {
  // printed_2 stores date in YYYY-MM-DD most likely; keep string compare safe.
  return normalizeStr(d);
}

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

  // fetch (limit high but safe). If you expect huge data, we can paginate later.
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
    const k = keyOf(r.quality, r.designcode, r.mariagenumber);
    if(!normalizeStr(r.quality) || !normalizeStr(r.designcode) || !normalizeStr(r.mariagenumber)) {
      // still keep as a separate bucket by raw string so user sees it in problems
    }
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

async function fetchExistingInventoryKeys(candidates){
  // candidates are already mapped to inventory item fields, but we only need keys
  const mains = [...new Set(candidates.map(x=>normalizeStr(x.quality)).filter(Boolean))];
  const names = [...new Set(candidates.map(x=>`رسمة ${normalizeStr(x.designcode)}`).filter(Boolean))];
  const codes = [...new Set(candidates.map(x=>normalizeStr(x.mariagenumber)).filter(Boolean))];

  let q = invSupabase.from("items").select("main_category,sub_category,item_name,color_code");
  // filter to reduce data: main_category IN, sub_category = 'مطبوع', item_name IN, color_code IN
  if(mains.length) q = q.in("main_category", mains);
  q = q.eq("sub_category", "مطبوع");
  if(names.length) q = q.in("item_name", names);
  if(codes.length) q = q.in("color_code", codes);

  const { data, error } = await q.limit(10000);
  if(error) throw error;

  const set = new Set();
  for(const r of (data||[])){
    const k = `${String(r.main_category||"").toLowerCase()}|||${String(r.sub_category||"").toLowerCase()}|||${String(r.item_name||"").toLowerCase()}|||${String(r.color_code||"").toLowerCase()}`;
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
    const chk = canSelect ? `<input type="checkbox" class="pick" data-key="${invKey}">` : "";
    const imgUrl = r._anyImage || "";
    const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="">` : "—";
    const badge = bad ? `<span class="pill" style="background:#fff5cf;border-color:#f0d483">ناقص</span>`
                      : exists ? `<span class="pill exist">موجود</span>`
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
    <div class="right"><span class="pill new">جديد: ${newCount}</span> <span class="pill exist">موجود: ${existCount}</span> <span class="pill" style="background:#fff5cf;border-color:#f0d483">ناقص: ${probCount}</span></div>
    <div style="margin-top:8px;color:#666;font-size:13px">التحديد متاح فقط للصفوف الجديدة غير الموجودة.</div>
  `;

  btnImport.disabled = (newCount===0);
  btnSelectAll.disabled = (newCount===0);
}

function getPickedKeys(){
  return [...document.querySelectorAll(".pick:checked")].map(x=>x.getAttribute("data-key"));
}

function buildItemFromRow(r){
  return {
    main_category: normalizeStr(r.quality),
    sub_category: "مطبوع",
    item_name: `رسمة ${normalizeStr(r.designcode)}`,
    color_code: normalizeStr(r.mariagenumber),
    color_name: "",
    unit_type: "kg",
    description: "",
    image_path: null
  };
}

async function copyImageToInventory(itemId, imageUrl){
  if(!imageUrl) return null;
  // infer ext
  const clean = imageUrl.split("?")[0];
  const ext = (clean.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || "jpg").toLowerCase();
  const path = `items/${itemId}.${ext}`;

  const resp = await fetch(imageUrl);
  if(!resp.ok) throw new Error(`image fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  const contentType = blob.type || (ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg");

  const { error: upErr } = await invSupabase.storage.from(DEST_BUCKET).upload(path, blob, {
    upsert: true,
    contentType
  });
  if(upErr) throw upErr;

  return path;
}

let lastRows = [];
let existingSet = new Set();

btnFetch.addEventListener("click", async ()=>{
  btnFetch.disabled = true;
  btnImport.disabled = true;
  btnSelectAll.disabled = true;
  setMsg("جاري الجلب والمقارنة…", true);

  try {
    const raw = await fetchPrintedRows();
    const rows = dedup(raw);
    lastRows = rows;

    // build candidates list for existing check
    const candidates = rows.filter(r => normalizeStr(r.quality) && normalizeStr(r.designcode) && normalizeStr(r.mariagenumber));
    existingSet = await fetchExistingInventoryKeys(candidates);

    render(rows, existingSet);
    setMsg(`تم الجلب: ${raw.length} سجل → بعد إزالة التكرار: ${rows.length}`, true);
  } catch (e) {
    console.error(e);
    setMsg(`خطأ أثناء الجلب/المقارنة: ${e.message || e}`, false);
  } finally {
    btnFetch.disabled = false;
  }
});

btnSelectAll.addEventListener("click", ()=>{
  document.querySelectorAll(".pick").forEach(ch => ch.checked = true);
});

btnImport.addEventListener("click", async ()=>{
  const picked = new Set(getPickedKeys());
  if(!picked.size) {
    return setMsg("لم يتم تحديد أي صفوف جديدة للاستيراد.", false);
  }

  btnImport.disabled = true;
  setMsg("جاري الاستيراد…", true);

  let ok=0, skip=0, imgOk=0, imgFail=0, fail=0;
  const errors = [];

  for(const r of lastRows){
    const bad = !normalizeStr(r.quality) || !normalizeStr(r.designcode) || !normalizeStr(r.mariagenumber);
    if(bad) continue;

    const invKey = itemKeyCandidate(r);
    const exists = existingSet.has(invKey);
    if(exists) { skip += 1; continue; }
    if(!picked.has(invKey)) continue;

    try {
      const item = buildItemFromRow(r);

      // insert item
      const { data, error } = await invSupabase.from("items").insert(item).select("id").single();
      if(error) throw error;

      ok += 1;
      const itemId = data.id;

      // copy image if exists
      const imgUrl = r._anyImage || "";
      if(imgUrl) {
        try {
          const image_path = await copyImageToInventory(itemId, imgUrl);
          if(image_path) {
            const { error: up2 } = await invSupabase.from("items").update({ image_path }).eq("id", itemId);
            if(up2) throw up2;
            imgOk += 1;
          }
        } catch (ie) {
          console.warn("image copy failed", ie);
          imgFail += 1;
        }
      }

      // update existingSet so duplicates in same run are skipped
      existingSet.add(invKey);

    } catch (e) {
      console.error(e);
      fail += 1;
      errors.push({ quality:r.quality, designcode:r.designcode, mariagenumber:r.mariagenumber, error: e.message || String(e) });
    }
  }

  if(errors.length) {
    console.table(errors.slice(0,20));
  }

  setMsg(`تم الاستيراد: ${ok} | موجود/تخطّي: ${skip} | فشل: ${fail} | صور نُسخت: ${imgOk} | صور فشلت: ${imgFail}`, fail===0);
  btnImport.disabled = false;

  // Refresh view
  btnFetch.click();
});
