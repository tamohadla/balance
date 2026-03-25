import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, unitLabel, daysSince, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const summaryEl = $("summary");

let allRows = []; // rows after aggregation (before UI filters)
let zeroRollsOnly = false;

/** -------------------- Data fetch (from DB) -------------------- **/

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
      .select("item_id, type, move_date, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out")
      .in("item_id", chunk);
    if(error) throw error;
    all.push(...(data||[]));
  }
  return all;
}

/** -------------------- UI helpers -------------------- **/

function applyPreset(rows, preset){
  const byText = (a,b) => (a||"").localeCompare(b||"", "ar");
  const byNum = (a,b) => (a??0) - (b??0);

  if(preset === "default"){
    rows.sort((x,y) =>
      byText(x.main_category,y.main_category) ||
      byText(x.sub_category,y.sub_category) ||
      byText(x.item_name,y.item_name) ||
      byText(x.color_code,y.color_code)
    );
    return;
  }

  if(preset === "most_qty_in_item"){
    rows.sort((x,y) =>
      byText(x.main_category,y.main_category) ||
      byText(x.sub_category,y.sub_category) ||
      byText(x.item_name,y.item_name) ||
      (byNum(y.balance_main, x.balance_main)) ||
      byText(x.color_code,y.color_code)
    );
    return;
  }

  if(preset === "stale"){
    rows.sort((x,y) => (y.days_since_sale ?? -1) - (x.days_since_sale ?? -1));
    return;
  }

  if(preset === "latest_sale"){
    rows.sort((x,y) => (x.last_sale_date||"").localeCompare(y.last_sale_date||""));
    rows.reverse();
    return;
  }

  if(preset === "most_rolls"){
    rows.sort((x,y) => (y.balance_rolls ?? 0) - (x.balance_rolls ?? 0));
    return;
  }
}

function buildFilterOptions(){
  const mainSel = $("filterMain");
  const subSel  = $("filterSub");

  const mains = Array.from(new Set(allRows.map(r => (r.main_category||"").trim()).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"ar"));

  const selectedMain = (mainSel.value || "").trim();

  mainSel.innerHTML = `<option value="">الكل</option>` + mains.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if(selectedMain && mains.includes(selectedMain)) mainSel.value = selectedMain;

  const subs = Array.from(new Set(
    allRows
      .filter(r => !mainSel.value || (r.main_category||"").trim() === mainSel.value)
      .map(r => (r.sub_category||"").trim())
      .filter(Boolean)
  )).sort((a,b)=>a.localeCompare(b,"ar"));

  const selectedSub = (subSel.value || "").trim();
  subSel.innerHTML = `<option value="">الكل</option>` + subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if(selectedSub && subs.includes(selectedSub)) subSel.value = selectedSub;
  else subSel.value = ""; // إذا الفلترة الرئيسية تغيرت
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

  if(Math.abs(totalKg) > 1e-9) parts.push(`إجمالي الكمية: ${Number(totalKg||0).toFixed(3)} كغ`);
  if(Math.abs(totalM) > 1e-9) parts.push(`إجمالي الكمية: ${Number(totalM||0).toFixed(3)} متر`);

  if(Math.abs(totalKg) <= 1e-9 && Math.abs(totalM) <= 1e-9){
    const any = rows.find(r => (r.balance_main||0) !== 0);
    if(any){
      const uLbl = unitLabel(any.unit_type);
      const sumAll = rows.reduce((acc,r)=>acc+(r.balance_main||0),0);
      parts.push(`إجمالي الكمية: ${Number(sumAll||0).toFixed(3)} ${escapeHtml(uLbl)}`);
    }
  }

  summaryEl.textContent = parts.join(" | ");
}

function applyFiltersAndRender(){
  const qRaw = $("search").value.trim().toLowerCase();
  const preset = $("preset").value;
  const onlyStale = $("onlyStale").checked;
  const fMain = ($("filterMain").value || "").trim();
  const fSub  = ($("filterSub").value || "").trim();

  let rows = allRows.slice();

  if(fMain){
    rows = rows.filter(r => (r.main_category||"").trim() === fMain);
  }
  if(fSub){
    rows = rows.filter(r => (r.sub_category||"").trim() === fSub);
  }

  if(zeroRollsOnly){
    rows = rows.filter(r => Number(r.balance_rolls || 0) === 0);
  }

  // بحث عام لكل الأعمدة
  if(qRaw){
    rows = rows.filter(r => {
      const imgPath = r.image_path || "";
      const hay = [
        r.main_category, r.sub_category, r.item_name,
        r.color_code, r.color_name,
        r.description, r.unit_type,
        r.last_sale_date,
        materialLabel(r),
        String(r.balance_main ?? ""),
        String(r.balance_rolls ?? ""),
        String(r.days_since_sale ?? ""),
        imgPath
      ].join(" ").toLowerCase();
      return hay.includes(qRaw);
    });
  }

  if(onlyStale){
    rows = rows.filter(r => (r.days_since_sale ?? 999999) >= 30);
  }

  applyPreset(rows, preset);

  tbody.innerHTML = rows.map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const img = imgUrl
      ? `<img class="thumb zoomable" src="${imgUrl}" alt="img" />`
      : `<span class="thumb"></span>`;

    const days = r.days_since_sale;

    let badge = "";
    if(days === null) badge = '<span class="badge warn">بدون مبيعات</span>';
    else if(days <= 7) badge = '<span class="badge ok">طبيعي</span>';
    else if(days <= 30) badge = '<span class="badge warn">انتباه</span>';
    else badge = '<span class="badge danger">راكد</span>';

    return `
      <tr>
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td>${Number(r.balance_main||0).toFixed(3)} ${escapeHtml(unitLabel(r.unit_type))}</td>
        <td>${parseInt(r.balance_rolls||0,10)}</td>
        <td>${escapeHtml(r.last_sale_date || "-")} ${badge}</td>
        <td>${days === null ? "-" : days}</td>
      </tr>
    `;
  }).join("");

  updateSummary(rows);
  setMsg(msg, `تم العرض: ${rows.length} مادة`, true);
}

function syncZeroRollsButton(){
  const btn = $("btnZeroRolls");
  if(!btn) return;
  btn.classList.toggle("active", zeroRollsOnly);
  btn.setAttribute("aria-pressed", zeroRollsOnly ? "true" : "false");
  btn.textContent = zeroRollsOnly ? "رصيد الأثواب = 0 ✓" : "رصيد الأثواب = 0";
}

/** -------------------- Main load -------------------- **/

async function loadData(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";
  summaryEl.textContent = "";

  try{
    const items = await fetchItems();
    const moves = await fetchMovesForItems(items.map(i=>i.id));

    const agg = new Map();
    for(const it of items){
      agg.set(it.id, { ...it, balance_main: 0, balance_rolls: 0, last_sale_date: null });
    }

    for(const m of moves){
      const r = agg.get(m.item_id);
      if(!r) continue;
      r.balance_main += (m.qty_main_in||0) - (m.qty_main_out||0);
      r.balance_rolls += (m.qty_rolls_in||0) - (m.qty_rolls_out||0);

      // آخر مبيعات فقط (لا adjustment)
      if(m.type === "sale"){
        if(!r.last_sale_date || m.move_date > r.last_sale_date) r.last_sale_date = m.move_date;
      }
    }

    allRows = [...agg.values()].map(r => ({ ...r, days_since_sale: daysSince(r.last_sale_date) }));

    buildFilterOptions();
    applyFiltersAndRender();
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

/** -------------------- Events -------------------- **/

$("btnReload").addEventListener("click", loadData);

// البحث: بدون إعادة تحميل من DB
$("search").addEventListener("input", () => {
  clearTimeout(window.__ti);
  window.__ti = setTimeout(applyFiltersAndRender, 200);
});

$("preset").addEventListener("change", applyFiltersAndRender);
$("onlyStale").addEventListener("change", applyFiltersAndRender);

// تغيير نطاق المواد: يعيد جلب من DB (لأن القائمة تختلف)
$("scope").addEventListener("change", loadData);

// فلاتر المجموعات
$("filterMain").addEventListener("change", () => {
  buildFilterOptions(); // يحدّث الفرعية حسب الرئيسية
  applyFiltersAndRender();
});
$("filterSub").addEventListener("change", applyFiltersAndRender);

$("btnZeroRolls").addEventListener("click", () => {
  zeroRollsOnly = !zeroRollsOnly;
  syncZeroRollsButton();
  applyFiltersAndRender();
});

// مسح الفلترة/البحث
$("btnClearFilters").addEventListener("click", () => {
  $("search").value = "";
  $("filterMain").value = "";
  buildFilterOptions();
  $("filterSub").value = "";
  $("onlyStale").checked = false;
  zeroRollsOnly = false;
  syncZeroRollsButton();
  applyFiltersAndRender();
});

// تكبير الصورة
const imageModal = $("imageModal");
const imageModalImg = $("imageModalImg");
tbody.addEventListener("click", (e) => {
  const img = e.target.closest("img.thumb.zoomable");
  if(!img) return;
  imageModalImg.src = img.src;
  imageModal.style.display = "flex";
});
imageModal.addEventListener("click", () => {
  imageModal.style.display = "none";
  imageModalImg.src = "";
});

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadData(); })();
