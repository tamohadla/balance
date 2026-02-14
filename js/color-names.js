import { supabase } from "./supabaseClient.js";
import { $, setMsg, escapeHtml, materialLabel, getPublicImageUrl, explainSupabaseError } from "./shared.js";

const msg = $("msg");
const tbody = $("tbody");
const mainGroupSel = $("mainGroup");
const showAllChk = $("showAll");
const qInput = $("q");

const reviewBack = $("reviewBack");
const reviewBody = $("reviewBody");
const reviewSummary = $("reviewSummary");
const applyMsg = $("applyMsg");

let ALL_ROWS = [];        // loaded from DB for selected main group
let FILTERED = [];        // after search/showAll filtering
let PENDING = new Map();  // itemId -> newColorName (string)

function norm(s){ return String(s ?? "").trim(); }

function missingColor(r){
  const v = norm(r.color_name);
  return !v;
}

function render(){
  const q = norm(qInput.value).toLowerCase();
  const showAll = showAllChk.checked;

  FILTERED = ALL_ROWS.filter(r => {
    if(!showAll && !missingColor(r)) return false;
    if(!q) return true;
    const hay = [
      r.item_name,
      r.color_code,
      r.color_name,
      r.main_category,
      r.sub_category
    ].map(x => String(x ?? "").toLowerCase()).join(" | ");
    return hay.includes(q);
  });

  tbody.innerHTML = FILTERED.map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const oldName = norm(r.color_name);
    const pending = PENDING.get(r.id);
    const newVal = pending !== undefined ? pending : "";
    return `
      <tr data-id="${r.id}">
        <td>${imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" />` : `<div class="thumb placeholder"></div>`}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code ?? "")}</td>
        <td>${oldName ? escapeHtml(oldName) : `<span class="muted">—</span>`}</td>
        <td>
          <input class="newColor" type="text" placeholder="ادخل اسم اللون" value="${escapeHtml(newVal)}" />
        </td>
      </tr>
    `;
  }).join("");

  setMsg(msg, `تم تحميل ${ALL_ROWS.length} مادة. المعروض الآن: ${FILTERED.length}.`, true);
}

function collectChanges(){
  const changes = [];
  for(const r of ALL_ROWS){
    const pending = PENDING.get(r.id);
    if(pending === undefined) continue;
    const newName = norm(pending);
    if(!newName) continue; // لا نمسح الاسم إذا تركه المستخدم فارغ
    const oldName = norm(r.color_name);
    if(newName === oldName) continue;
    changes.push({ id: r.id, item: r, oldName, newName });
  }
  return changes;
}

function openReview(changes){
  reviewBody.innerHTML = changes.map(c => `
    <tr>
      <td>${escapeHtml(materialLabel(c.item))}</td>
      <td>${escapeHtml(c.item.color_code ?? "")}</td>
      <td>${c.oldName ? escapeHtml(c.oldName) : `<span class="muted">—</span>`}</td>
      <td><b>${escapeHtml(c.newName)}</b></td>
    </tr>
  `).join("");

  reviewSummary.textContent = `عدد المواد التي سيتم تحديث اسم اللون لها: ${changes.length}`;
  applyMsg.textContent = "";
  reviewBack.style.display = "flex";
}

function closeReview(){
  reviewBack.style.display = "none";
  applyMsg.textContent = "";
}

async function loadMainGroups(){
  setMsg(msg, "جارٍ تحميل المجموعات الأساسية...", true);

  const { data, error } = await supabase
    .from("items")
    .select("main_category")
    .not("main_category","is", null)
    .limit(5000);

  if(error){
    setMsg(msg, explainSupabaseError(error), false);
    return;
  }

  const groups = Array.from(new Set((data || []).map(r => norm(r.main_category)).filter(Boolean)));
  groups.sort((a,b)=>a.localeCompare(b,"ar"));

  mainGroupSel.innerHTML = groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  if(groups.length === 0){
    mainGroupSel.innerHTML = `<option value="">(لا يوجد)</option>`;
  }
  setMsg(msg, "اختر مجموعة ثم اضغط (تحديث القائمة).", true);
}

async function loadItems(){
  const g = norm(mainGroupSel.value);
  if(!g) return setMsg(msg, "اختر المجموعة الأساسية أولاً.", false);

  setMsg(msg, "جارٍ تحميل المواد...", true);
  PENDING = new Map();
  tbody.innerHTML = "";

  // جلب كل مواد المجموعة (ثم نفلتر محلياً — أسرع)
  const { data, error } = await supabase
    .from("items")
    .select("id, main_category, sub_category, item_name, color_code, color_name, unit, image_path, is_active")
    .eq("main_category", g)
    .order("sub_category", { ascending: true, nullsFirst: true })
    .order("item_name", { ascending: true })
    .order("color_code", { ascending: true });

  if(error){
    setMsg(msg, explainSupabaseError(error), false);
    ALL_ROWS = [];
    return;
  }

  ALL_ROWS = data || [];
  render();
}

tbody.addEventListener("input", (e) => {
  const inp = e.target.closest("input.newColor");
  if(!inp) return;
  const tr = e.target.closest("tr");
  const id = tr?.dataset?.id;
  if(!id) return;
  PENDING.set(id, inp.value);
});

qInput.addEventListener("input", () => render());
showAllChk.addEventListener("change", () => render());

$("btnLoad").addEventListener("click", () => loadItems());

$("btnReview").addEventListener("click", () => {
  if(ALL_ROWS.length === 0) return setMsg(msg, "لا يوجد مواد محملة بعد.", false);

  const changes = collectChanges();
  if(changes.length === 0) return setMsg(msg, "لا يوجد أي تعديل للحفظ. اكتب اسم اللون في الحقول ثم راجع.", false);

  openReview(changes);
});

$("btnCloseReview").addEventListener("click", closeReview);
$("btnCancel").addEventListener("click", closeReview);

$("btnApply").addEventListener("click", async () => {
  const changes = collectChanges();
  if(changes.length === 0){
    applyMsg.textContent = "لا يوجد تعديلات.";
    return;
  }

  $("btnApply").disabled = true;
  $("btnCancel").disabled = true;
  applyMsg.textContent = "جارٍ الحفظ...";

  try{
    // تحديث دفعة واحدة عبر upsert على id
    const payload = changes.map(c => ({ id: c.id, color_name: c.newName }));
    const { error } = await supabase
      .from("items")
      .upsert(payload, { onConflict: "id" });
    if(error) throw error;

    // عكس التعديلات في الواجهة
    for(const c of changes){
      const row = ALL_ROWS.find(r => r.id === c.id);
      if(row) row.color_name = c.newName;
      PENDING.delete(c.id);
    }

    applyMsg.textContent = `تم حفظ ${changes.length} تعديل بنجاح.`;
    setMsg(msg, `تم حفظ ${changes.length} تعديل بنجاح.`, true);
    render();

    // أغلق بعد لحظة قصيرة
    setTimeout(closeReview, 600);
  }catch(err){
    console.error(err);
    applyMsg.textContent = "فشل الحفظ: " + (err?.message || "خطأ غير معروف");
  }finally{
    $("btnApply").disabled = false;
    $("btnCancel").disabled = false;
  }
});

// init
loadMainGroups();
