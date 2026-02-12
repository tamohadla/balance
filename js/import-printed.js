import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase, setMsg, explainSupabaseError } from "./shared.js";

const msg = document.getElementById("msg");
const tbody = document.getElementById("tbody");
const stats = document.getElementById("stats");

const elPageUrl = document.getElementById("printedPageUrl");
const elSrcUrl = document.getElementById("srcUrl");
const elSrcKey = document.getElementById("srcKey");
const elSrcTable = document.getElementById("srcTable");
const elSrcBucket = document.getElementById("srcBucket");

const elRange = document.getElementById("rangeFilter");
const elStatus = document.getElementById("statusFilter");
const elUnit = document.getElementById("unitType");
const elCopyImages = document.getElementById("copyImages");

let SRC = null; // {client, table, bucket}

const CFG_KEY = "printed_import_cfg_v1";

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function daysAgoISO(n){
  const d = new Date();
  d.setDate(d.getDate()-n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function statusRank(s){
  if(s === "تم الاستلام") return 3;
  if(s === "تم التشكيل") return 2;
  if(s === "لم يتم التشكيل") return 1;
  return 0;
}

function keyOfCandidate(c){
  return `${(c.quality||"").trim().toLowerCase()}|||${String(c.designcode||"").trim()}|||${String(c.mariagenumber||"").trim()}`;
}
function itemKey(main, sub, name, code){
  return `${(main||"").trim().toLowerCase()}|||${(sub||"").trim().toLowerCase()}|||${(name||"").trim().toLowerCase()}|||${String(code||"").trim().toLowerCase()}`;
}

function loadCfg(){
  try{
    const raw = localStorage.getItem(CFG_KEY);
    if(!raw) return;
    const c = JSON.parse(raw);
    elSrcUrl.value = c.url || "";
    elSrcKey.value = c.key || "";
    elSrcTable.value = c.table || "";
    elSrcBucket.value = c.bucket || "";
  }catch{}
}
function saveCfg(){
  const c = { url: elSrcUrl.value.trim(), key: elSrcKey.value.trim(), table: elSrcTable.value.trim(), bucket: elSrcBucket.value.trim() };
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  setMsg(msg, "تم حفظ الإعدادات محلياً.", true);
}

async function autoConfigFromPrintedPage(){
  const url = elPageUrl.value.trim();
  if(!url) return setMsg(msg, "أدخل رابط صفحة المطبوع", false);

  setMsg(msg, "جلب إعدادات صفحة المطبوع...", true);
  try{
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const mUrl = text.match(/const\s+SUPABASE_URL\s*=\s*\"([^\"]+)\"/);
    const mKey = text.match(/const\s+SUPABASE_ANON_KEY\s*=\s*\"([^\"]+)\"/);
    const mTable = text.match(/const\s+TABLE_NAME\s*=\s*\"([^\"]+)\"/);
    const mBucket = text.match(/const\s+STORAGE_BUCKET\s*=\s*\"([^\"]+)\"/);

    if(mUrl) elSrcUrl.value = mUrl[1];
    if(mKey) elSrcKey.value = mKey[1];
    if(mTable) elSrcTable.value = mTable[1];
    if(mBucket) elSrcBucket.value = mBucket[1];

    setMsg(msg, "تم استخراج الإعدادات من صفحة المطبوع.", true);
  }catch(e){
    setMsg(msg, "تعذر استخراج الإعدادات: " + (e?.message || e), false);
  }
}

function buildSrcClient(){
  const url = elSrcUrl.value.trim();
  const key = elSrcKey.value.trim();
  const table = elSrcTable.value.trim() || "printed_mariages";
  const bucket = elSrcBucket.value.trim() || "images";
  if(!url || !key) return null;
  return { client: createClient(url, key), table, bucket };
}

async function fetchPrintedRows(){
  SRC = buildSrcClient();
  if(!SRC) throw new Error("إعدادات المطبوع غير مكتملة (URL/KEY).");

  const range = elRange.value;
  const statusVal = elStatus.value;

  let fromDate = null;
  if(range === "30") fromDate = daysAgoISO(30);

  let all = [];
  const pageSize = 1000;
  let from = 0;

  while(true){
    let q = SRC.client
      .from(SRC.table)
      .select("designcode,mariagenumber,quality,imageurl,status,date")
      .order("date", { ascending: false })
      .range(from, from + pageSize - 1);

    if(fromDate) q = q.gte("date", fromDate);
    if(statusVal) q = q.eq("status", statusVal);

    const { data, error } = await q;
    if(error) throw error;

    const chunk = data || [];
    all = all.concat(chunk);

    if(chunk.length < pageSize) break;
    from += pageSize;

    // حماية: لا نجلب أكثر من 7000 صف افتراضياً
    if(all.length >= 7000) break;
  }
  return all;
}

function dedupRows(rows){
  const map = new Map();

  for(const r of rows){
    const quality = (r.quality || "").trim();
    const designcode = String(r.designcode || "").trim();
    const mariagenumber = String(r.mariagenumber || "").trim();
    if(!quality || !designcode || !mariagenumber) continue;

    const key = keyOfCandidate({ quality, designcode, mariagenumber });

    const cur = map.get(key);
    if(!cur){
      map.set(key, {
        quality, designcode, mariagenumber,
        imageurl: r.imageurl || null,
        status: r.status || "",
        last_date: r.date || null,
        count: 1
      });
      continue;
    }

    cur.count += 1;

    // آخر تاريخ
    if(r.date && (!cur.last_date || r.date > cur.last_date)) cur.last_date = r.date;

    // أعلى حالة
    if(statusRank(r.status) > statusRank(cur.status)) cur.status = r.status;

    // صورة: خذ أول صورة غير فارغة أو أحدث
    if(!cur.imageurl && r.imageurl) cur.imageurl = r.imageurl;
  }

  return Array.from(map.values());
}

async function fetchExistingItemsSet(candidates){
  // نقارن عبر مفتاح items: (main + sub + name + code)
  const mains = [...new Set(candidates.map(x => x.quality).filter(Boolean))];
  const names = [...new Set(candidates.map(x => `رسمة ${x.designcode}`))];
  const codes = [...new Set(candidates.map(x => String(x.mariagenumber)))];

  let q = supabase
    .from("items")
    .select("main_category, sub_category, item_name, color_code")
    .eq("sub_category", "مطبوع");

  if(mains.length) q = q.in("main_category", mains);
  if(names.length) q = q.in("item_name", names);
  if(codes.length) q = q.in("color_code", codes);

  const { data, error } = await q;
  if(error) throw error;

  const set = new Set();
  for(const it of (data || [])){
    set.add(itemKey(it.main_category, it.sub_category, it.item_name, it.color_code));
  }
  return set;
}

let VIEW = []; // {candidate, exists, selected}
function render(){
  tbody.innerHTML = "";

  const newCount = VIEW.filter(x => !x.exists).length;
  const existCount = VIEW.filter(x => x.exists).length;
  stats.textContent = `المجموع بعد إزالة التكرار: ${VIEW.length} | جديد: ${newCount} | موجود: ${existCount}`;

  for(const row of VIEW){
    const c = row.c;
    const name = `رسمة ${c.designcode}`;
    const code = String(c.mariagenumber);

    const tr = document.createElement("tr");

    const tdSel = document.createElement("td");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!row.selected;
    chk.disabled = row.exists;
    chk.addEventListener("change", () => { row.selected = chk.checked; });
    tdSel.appendChild(chk);

    const tdImg = document.createElement("td");
    if(c.imageurl){
      const img = document.createElement("img");
      img.src = c.imageurl;
      img.className = "rowImg";
      img.loading = "lazy";
      tdImg.appendChild(img);
    }else{
      tdImg.textContent = "—";
      tdImg.className = "mini";
    }

    const tdQ = document.createElement("td"); tdQ.textContent = c.quality;
    const tdD = document.createElement("td"); tdD.textContent = name;
    const tdM = document.createElement("td"); tdM.textContent = code;
    const tdC = document.createElement("td"); tdC.innerHTML = `<span class="pill">${c.count}</span>`;
    const tdLd = document.createElement("td"); tdLd.textContent = c.last_date || "—";
    const tdSt = document.createElement("td"); tdSt.textContent = c.status || "—";

    const tdRes = document.createElement("td");
    if(row.exists){
      tdRes.innerHTML = `<span class="pill ok">موجود</span>`;
    }else{
      tdRes.innerHTML = `<span class="pill">جديد</span>`;
    }

    tr.appendChild(tdSel);
    tr.appendChild(tdImg);
    tr.appendChild(tdQ);
    tr.appendChild(tdD);
    tr.appendChild(tdM);
    tr.appendChild(tdC);
    tr.appendChild(tdLd);
    tr.appendChild(tdSt);
    tr.appendChild(tdRes);

    tbody.appendChild(tr);
  }
}

async function doFetchCompare(){
  setMsg(msg, "جلب بيانات المطبوع...", true);
  tbody.innerHTML = "";
  stats.textContent = "—";

  const raw = await fetchPrintedRows();
  const dedup = dedupRows(raw);

  setMsg(msg, `تم جلب ${raw.length} صف، وبعد إزالة التكرار: ${dedup.length}.`, true);

  const existing = await fetchExistingItemsSet(dedup);

  VIEW = dedup.map(c => {
    const k = itemKey(c.quality, "مطبوع", `رسمة ${c.designcode}`, String(c.mariagenumber));
    const exists = existing.has(k);
    return { c, exists, selected: !exists };
  });

  render();
}

async function uploadImageToInventory(itemId, imageUrl){
  const res = await fetch(imageUrl, { cache: "no-store" });
  if(!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
  const blob = await res.blob();

  // حاول استنتاج امتداد
  let ext = "jpg";
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if(ct.includes("png")) ext = "png";
  if(ct.includes("webp")) ext = "webp";

  const path = `items/${itemId}.${ext}`;
  const { error: upErr } = await supabase.storage.from("item-images").upload(path, blob, { upsert: true, contentType: blob.type || undefined });
  if(upErr) throw upErr;

  return path;
}

async function doImport(){
  const toImport = VIEW.filter(x => !x.exists && x.selected).map(x => x.c);
  if(!toImport.length) return setMsg(msg, "لا يوجد عناصر جديدة محددة للاستيراد.", false);

  const unit_type = elUnit.value;
  const copyImages = !!elCopyImages.checked;

  setMsg(msg, `استيراد ${toImport.length} مادة...`, true);

  // نبني payloads
  const payloads = toImport.map(c => ({
    main_category: c.quality,
    sub_category: "مطبوع",
    item_name: `رسمة ${c.designcode}`,
    color_code: String(c.mariagenumber),
    color_name: null,
    unit_type,
    description: "مستورد من المطبوع",
    image_path: null,
    is_active: true
  }));

  const { data, error } = await supabase
    .from("items")
    .insert(payloads)
    .select("id, main_category, sub_category, item_name, color_code");

  if(error) return setMsg(msg, explainSupabaseError(error), false);

  let okImgs = 0, failImgs = 0;
  if(copyImages){
    for(let i=0;i<data.length;i++){
      const inserted = data[i];
      const src = toImport[i];
      if(!src.imageurl) continue;
      try{
        const path = await uploadImageToInventory(inserted.id, src.imageurl);
        const { error: upErr } = await supabase.from("items").update({ image_path: path }).eq("id", inserted.id);
        if(upErr) throw upErr;
        okImgs += 1;
      }catch(e){
        console.warn("copy image failed", inserted.id, e);
        failImgs += 1;
      }
    }
  }

  // اعادة المقارنة
  setMsg(msg, `تم الاستيراد: ${data.length} مادة. نسخ الصور: ${okImgs} ناجح / ${failImgs} فشل.`, true);
  await doFetchCompare();
}

document.getElementById("btnAutoConfig").addEventListener("click", autoConfigFromPrintedPage);
document.getElementById("btnSaveCfg").addEventListener("click", saveCfg);
document.getElementById("btnFetch").addEventListener("click", async () => {
  try{
    await doFetchCompare();
  }catch(e){
    setMsg(msg, explainSupabaseError(e), false);
  }
});

document.getElementById("btnSelectAllNew").addEventListener("click", () => {
  for(const r of VIEW){ if(!r.exists) r.selected = true; }
  render();
});
document.getElementById("btnClearSel").addEventListener("click", () => {
  for(const r of VIEW){ r.selected = false; }
  render();
});
document.getElementById("btnImport").addEventListener("click", async () => {
  try{
    await doImport();
  }catch(e){
    setMsg(msg, explainSupabaseError(e), false);
  }
});

loadCfg();
