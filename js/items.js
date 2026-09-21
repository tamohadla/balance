import {openImageViewer} from "./image-viewer.js?v=1";
import {saveImagePair, removeImagePair} from "./item-image-store.js?v=224-1";
import {refreshSiteImages} from "./image-cache.js?v=224-1";
import {allRows as readAllRows} from "./stock-entries.js";
import { supabase } from "./supabaseClient.js";
import { $, cleanText, normalizeArabicDigits, escapeHtml, setMsg, getPublicImageUrl, getThumbnailImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js?v=224-1";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

/**
 * صفحة المواد (Items)
 * - المجموعات (main_category/sub_category) تنظيمية ويمكن تغييرها لاحقاً.
 * - هوية المادة لمنع التكرار: (item_name + color_code).
 */

const msg = $("msg");
const tbody = $("itemsTbody");
const mainList = $("mainList");
const subList = $("subList");
const nameList = $("nameList");

const searchEl = $("search");
const quickFiltersBar = $("quickFiltersBar");
const quickMainCategoryEl = $("quickMainCategory");
const quickSubCategoryEl = $("quickSubCategory");
const quickImageInputEl = $("quickImageInput");
const editItemModalEl = $("editItemModal");
const editItemFormEl = $("editItemForm");

if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
  setMsg(msg, "مفاتيح Supabase غير مُعدلة. راجع js/supabaseClient.js", false);
}

let ALL_ITEMS = [];
let lastLoadedAt = 0;
// Reuse cached images on normal visits; bust only after an explicit image refresh.
let imageCacheSeed = 0;
let pendingImageItemId = null;
const itemImageVersions = new Map();
const quickFilters = {
  status: ["active","inactive","all"].includes(new URL(location.href).searchParams.get("status"))?new URL(location.href).searchParams.get("status"):"active",
  mainCategory: "",
  subCategory: ""
};

// Bucket name used across the project
const ITEM_BUCKET = "item-images";

// ثابت: نخزن الصور بصيغة JPG وبمسار واحد لكل مادة لتفادي المخلفات


function byText(a, b){
  return (a || "").localeCompare((b || ""), "ar");
}

function buildDatalists(items){
  const mains = new Set(), subs = new Set(), names = new Set();
  items.forEach(r => {
    if (r.main_category) mains.add(r.main_category);
    if (r.sub_category) subs.add(r.sub_category);
    if (r.item_name) names.add(r.item_name);
  });
  mainList.innerHTML = [...mains].sort(byText).map(v => `<option value="${escapeHtml(v)}">`).join("");
  subList.innerHTML  = [...subs].sort(byText).map(v => `<option value="${escapeHtml(v)}">`).join("");
  nameList.innerHTML = [...names].sort(byText).map(v => `<option value="${escapeHtml(v)}">`).join("");
}

function matchesSearch(r, q){
  if(!q) return true;
  const hay = [
    r.main_category, r.sub_category, r.item_name,
    r.color_code, r.color_name, r.unit_type, r.description
  ].map(x => String(x || "")).join(" ").toLowerCase();
  return hay.includes(q);
}

function getItemImageUrl(row){
  const rowVersion = itemImageVersions.get(String(row.id));
  return getPublicImageUrl(row.image_path, rowVersion || imageCacheSeed);
}

function markItemImageUpdated(itemId){
  itemImageVersions.set(String(itemId), Date.now());
}

function refreshAllImagesFromCache(){
  refreshSiteImages();
  imageCacheSeed = Date.now();
  render();
}

function buildQuickFilterOptions(items){
  if(!quickMainCategoryEl || !quickSubCategoryEl) return;
  const mains = [...new Set((items || []).map(r => cleanText(r.main_category || "")).filter(Boolean))].sort(byText);

  quickMainCategoryEl.innerHTML = `<option value="">فلترة حسب المجموعة الرئيسية</option>` +
    mains.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  quickMainCategoryEl.value = quickFilters.mainCategory;
  syncQuickSubCategoryOptions();
}

function syncQuickSubCategoryOptions(){
  if(!quickSubCategoryEl) return;
  const selectedMain = cleanText(quickFilters.mainCategory || "");
  const validSubs = [...new Set((ALL_ITEMS || [])
    .filter(r => !selectedMain || cleanText(r.main_category || "") === selectedMain)
    .map(r => cleanText(r.sub_category || ""))
    .filter(Boolean))].sort(byText);

  const previous = cleanText(quickFilters.subCategory || "");
  quickSubCategoryEl.innerHTML = `<option value="">فلترة حسب المجموعة الفرعية</option>` +
    validSubs.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

  if(previous && !validSubs.includes(previous)){
    quickFilters.subCategory = "";
  }
  quickSubCategoryEl.value = quickFilters.subCategory;
}

function applyQuickStatusButtons(){
  if(!quickFiltersBar) return;
  quickFiltersBar.querySelectorAll("[data-quick-status]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.quickStatus === quickFilters.status);
  });
}

function render(){
  const q = (searchEl?.value || "").trim().toLowerCase();
  const selectedMain = cleanText(quickFilters.mainCategory || "");
  const selectedSub = cleanText(quickFilters.subCategory || "");

  const rows = (ALL_ITEMS || [])
    .filter(r => {
      if(quickFilters.status === "active") return r.is_active === true;
      if(quickFilters.status === "inactive") return r.is_active !== true;
      return true;
    })
    .filter(r => selectedMain ? cleanText(r.main_category || "") === selectedMain : true)
    .filter(r => selectedSub ? cleanText(r.sub_category || "") === selectedSub : true)
    .filter(r => matchesSearch(r, q))
    .sort((a,b) =>
      byText(a.main_category,b.main_category) ||
      byText(a.sub_category,b.sub_category) ||
      byText(a.item_name,b.item_name) ||
      byText(a.color_code,b.color_code)
    );

  tbody.innerHTML = rows.map(r => {
    const imgUrl = getItemImageUrl(r);
    const imgTag = imgUrl
      ? `<img class="thumb" src="${getThumbnailImageUrl(r.image_path, imageCacheSeed)}" alt="img" loading="lazy" decoding="async" width="150" height="150" data-full="${imgUrl}" style="cursor: zoom-in;" />`
      : `<div class="thumb-placeholder"></div>`;

    return `
      <tr class="item-card ${!r.is_active ? "row-inactive" : ""}">
        <td class="item-photo">${imgTag}</td>
        <td class="item-main-group">${escapeHtml(r.main_category || "")}</td>
        <td class="item-sub-group">${escapeHtml(r.sub_category || "")}</td>
        <td class="item-name">${escapeHtml(r.item_name || "")}</td>
        <td class="item-color-code" data-label="كود اللون">${escapeHtml(r.color_code || "—")}</td>
        <td class="item-color-name" data-label="اسم اللون">${escapeHtml(r.color_name || "—")}</td>
        <td class="item-unit" data-label="الوحدة">${r.unit_type === "kg" ? "كيلو" : r.unit_type === "m" ? "متر" : escapeHtml(r.unit_type || "—")}</td>
        <td class="item-description ${r.description ? "" : "is-empty"}" data-label="ملاحظات">${escapeHtml(r.description || "")}</td>
        <td class="item-status">${r.is_active ? '<span class="badge ok">نشط</span>' : '<span class="badge warn">موقوف</span>'}</td>
        <td class="item-card-actions">
          <div class="actionsRow">
            <button class="secondary" data-act="edit" data-id="${r.id}" title="تعديل">تعديل</button>
            <button class="secondary" data-act="change-image" data-id="${r.id}" title="تغيير الصورة">تغيير الصورة</button>
            <button class="${r.is_active ? "secondary" : "primary"}" data-act="toggle" data-id="${r.id}" data-val="${r.is_active}" title="تغيير الحالة">
              ${r.is_active ? "إيقاف" : "تفعيل"}
            </button>
            <button class="danger" data-act="delete" data-id="${r.id}" title="حذف">حذف</button>
          </div>
        </td>
      </tr>`;
  }).join("");

  setMsg(msg, `تم عرض ${rows.length} مادة`, true);
}

function exportAllItemsToExcel(){
  if(typeof XLSX === "undefined"){
    setMsg(msg, "تعذر إنشاء ملف Excel حالياً (مكتبة XLSX غير متاحة).", false);
    return;
  }

  const rows = (ALL_ITEMS || [])
    .slice()
    .sort((a,b) =>
      byText(a.main_category,b.main_category) ||
      byText(a.sub_category,b.sub_category) ||
      byText(a.item_name,b.item_name) ||
      byText(a.color_code,b.color_code)
    )
    .map((r, idx) => ({
      "#": idx + 1,
      "المجموعة الأساسية": r.main_category || "",
      "المجموعة الفرعية": r.sub_category || "",
      "اسم المادة": r.item_name || "",
      "رقم اللون": r.color_code || "",
      "اسم اللون": r.color_name || "",
      "الوحدة": r.unit_type || "",
      "الشرح": r.description || "",
      "الحالة": r.is_active ? "نشط" : "موقوف"
    }));

  if(!rows.length){
    setMsg(msg, "لا توجد مواد للتنزيل حالياً.", false);
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "المواد");

  const now = new Date();
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(workbook, `items-${datePart}.xlsx`);
  setMsg(msg, `✅ تم تنزيل ملف Excel بعدد ${rows.length} مادة.`, true);
}

function openEditItemModal(item){
  if(!editItemModalEl || !item) return;
  $("editModalId").value = item.id;
  $("edit_main_category").value = item.main_category || "";
  $("edit_sub_category").value = item.sub_category || "";
  $("edit_item_name").value = item.item_name || "";
  $("edit_color_code").value = item.color_code || "";
  $("edit_color_name").value = item.color_name || "";
  $("edit_unit_type").value = item.unit_type || "kg";
  $("edit_description").value = item.description || "";
  editItemModalEl.style.display = "flex";
}

function closeEditItemModal(){
  if(!editItemModalEl) return;
  editItemModalEl.style.display = "none";
  editItemFormEl?.reset();
  $("editModalId").value = "";
}

async function refreshFromDb(force=false){
  const now = Date.now();
  // Avoid hammering refresh on fast typing; allow explicit reload
  if(!force && ALL_ITEMS.length && (now - lastLoadedAt) < 10_000){
    render();
    return;
  }

  setMsg(msg, "⏳ جارٍ تحديث القائمة...", true);

  let data;try{data=await readAllRows(()=>supabase.from('items').select('*').order('created_at',{ascending:false}).order('id'));}catch(error){setMsg(msg,explainSupabaseError(error),false);return;}
  ALL_ITEMS = data || [];
  lastLoadedAt = Date.now();
  buildDatalists(ALL_ITEMS);
  buildQuickFilterOptions(ALL_ITEMS);
  render();
}

// --- الصور ---
async function uploadOrReplaceImage(itemId, existingPath, file){
  const chosenFile = file || $("image_file")?.files?.[0];
  if(!chosenFile) return null;
  const {path, cleanupError} = await saveImagePair(supabase, itemId, existingPath, chosenFile);
  if(cleanupError) alert("تم حفظ الصورتين، لكن تعذر تنظيف النسخ القديمة من التخزين. " + cleanupError.message);
  return path;
}

// --- حفظ/تعديل ---
$("itemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(msg, "جارٍ الحفظ...", true);

  const payload = {
    main_category: cleanText($("main_category").value),
    sub_category: cleanText($("sub_category").value) || null,
    item_name: cleanText($("item_name").value),
    color_code: normalizeArabicDigits(cleanText($("color_code").value)),
    color_name: cleanText($("color_name").value) || null,
    unit_type: $("unit_type").value,
    description: cleanText($("description").value) || null
  };

  try{
    const id = $("editId").value;

    // Prevent duplicates on (item_name + color_code)
    if(!id){
      const { data: exists, error: exErr } = await supabase
        .from("items")
        .select("id")
        .eq("item_name", payload.item_name)
        .eq("color_code", payload.color_code)
        .limit(1);

      if(exErr) throw exErr;
      if(exists && exists.length){
        setMsg(msg, "⚠️ هذه المادة موجودة مسبقاً (نفس اسم المادة + رقم اللون).", false);
        return;
      }
    }

    let res;
    if(id){
      res = await supabase.from("items").update(payload).eq("id", id).select().single();
    }else{
      res = await supabase.from("items").insert([payload]).select().single();
    }
    if(res.error) throw res.error;

    const imgPath = await uploadOrReplaceImage(res.data.id, res.data.image_path);
    if(imgPath && res.data.image_path !== imgPath){
      markItemImageUpdated(res.data.id);
    }

    $("itemForm").reset();
    $("editId").value = "";
    setMsg(msg, "✅ تم حفظ المادة بنجاح", true);
    await refreshFromDb(true);
  }catch(err){
    setMsg(msg, explainSupabaseError(err), false);
  }
});

// --- أحداث الجدول ---
tbody.addEventListener("click", async (e) => {
  // فتح الصورة كبيرة عند الضغط عليها
  const imgEl = e.target.closest("img.thumb");
  if(imgEl && imgEl.dataset.full){
    openImageViewer(imgEl.dataset.full);
    return;
  }

  const btn = e.target.closest("button");
  if(!btn) return;

  const { act, id, val } = btn.dataset;

  try{
    if(act === "edit"){
      const item = (ALL_ITEMS || []).find(r => String(r.id) === String(id));
      if(item) openEditItemModal(item);
      else{
        const { data, error } = await supabase.from("items").select("*").eq("id", id).single();
        if(error) throw error;
        openEditItemModal(data);
      }
      return;
    }

    if(act === "change-image"){
      pendingImageItemId = id;
      quickImageInputEl.value = "";
      quickImageInputEl.click();
      return;
    }

    if(act === "toggle"){
      const next = (val === "false"); // val is current is_active
      const { error } = await supabase.from("items").update({ is_active: next }).eq("id", id);
      if(error) throw error;
      await refreshFromDb(true);
      return;
    }

    if(act === "delete"){
      if(!confirm("⚠️ هل أنت متأكد من حذف هذه المادة نهائياً؟")) return;
      setMsg(msg, "جارٍ الحذف...", true);

      // نقرأ مسار الصورة أولاً (لأن الحذف قد يفشل بسبب الحركات)
      const { data: row, error: rErr } = await supabase.from("items").select("image_path").eq("id", id).single();
      if(rErr) throw rErr;

      const { error } = await supabase.from("items").delete().eq("id", id);
      if(error){
        setMsg(msg, "لا يمكن الحذف: المادة مرتبطة بحركات مخزنية (يفضل إيقافها بدلاً من حذفها)", false);
      }else{
        // حذف الصورة من Storage (بدون ترك مخلفات)
        if(row?.image_path){
          try{ await removeImagePair(supabase, row.image_path); }catch(ex){
            await refreshFromDb(true);
            setMsg(msg, "حُذفت المادة، لكن تعذر حذف ملفات صورها: " + ex.message, false);
            return;
          }
        }
        setMsg(msg, "تم حذف المادة بنجاح", true);
        await refreshFromDb(true);
      }
      return;
    }
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
});

// --- تحكم ---
$("btnReload").onclick = () => refreshFromDb(true);
$("btnExportExcel").onclick = exportAllItemsToExcel;
$("btnRefreshImages").onclick = () => {
  try{refreshAllImagesFromCache();setMsg(msg,"تم طلب أحدث الصور لكل صفحات الموقع وتبويباته في هذا المتصفح.",true);}
  catch{setMsg(msg,"تعذر حفظ تحديث الصور المشترك. اسمح بتخزين بيانات الموقع في المتصفح ثم أعد المحاولة.",false);}
};
$("btnCancel").onclick = () => {
  $("itemForm").reset();
  $("editId").value = "";
  setMsg(msg, "", true);
};

if($("btnBulk")){
  $("btnBulk").onclick = () => { $("bulkModal").style.display = "flex"; };
}

let tSearch = null;
if(searchEl){
  searchEl.addEventListener("input", () => {
    clearTimeout(tSearch);
    tSearch = setTimeout(() => render(), 120);
  });
}

if(quickFiltersBar){
  quickFiltersBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quick-status]");
    if(!btn) return;
    const { quickStatus } = btn.dataset;
    if(quickStatus === "all"){
      quickFilters.status = "all";
      quickFilters.mainCategory = "";
      quickFilters.subCategory = "";
      if(quickMainCategoryEl) quickMainCategoryEl.value = "";
      syncQuickSubCategoryOptions();
    }else{
      quickFilters.status = quickStatus;
    }
    applyQuickStatusButtons();
    render();
  });
}

if(quickMainCategoryEl){
  quickMainCategoryEl.addEventListener("change", () => {
    quickFilters.mainCategory = quickMainCategoryEl.value;
    quickFilters.subCategory = "";
    syncQuickSubCategoryOptions();
    render();
  });
}
if(quickSubCategoryEl){
  quickSubCategoryEl.addEventListener("change", () => {
    quickFilters.subCategory = quickSubCategoryEl.value;
    render();
  });
}

if(quickImageInputEl){
  quickImageInputEl.addEventListener("change", async () => {
    const file = quickImageInputEl.files?.[0];
    const itemId = pendingImageItemId;
    pendingImageItemId = null;
    quickImageInputEl.value = "";
    if(!file || !itemId) return;

    try{
      setMsg(msg, "جارٍ تحديث الصورة...", true);
      const item = (ALL_ITEMS || []).find(r => String(r.id) === String(itemId));
      if(!item) throw new Error("تعذر العثور على المادة.");

      const imgPath = await uploadOrReplaceImage(itemId, item.image_path, file);
      if(imgPath && item.image_path !== imgPath){
        item.image_path = imgPath;
      }
      markItemImageUpdated(itemId);
      render();
      setMsg(msg, "✅ تم تحديث صورة المادة بنجاح.", true);
    }catch(ex){
      setMsg(msg, explainSupabaseError(ex), false);
    }
  });
}

if(editItemFormEl){
  editItemFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("editModalId").value;
    if(!id) return;

    const payload = {
      main_category: cleanText($("edit_main_category").value),
      sub_category: cleanText($("edit_sub_category").value) || null,
      item_name: cleanText($("edit_item_name").value),
      color_code: normalizeArabicDigits(cleanText($("edit_color_code").value)),
      color_name: cleanText($("edit_color_name").value) || null,
      unit_type: $("edit_unit_type").value,
      description: cleanText($("edit_description").value) || null
    };

    try{
      const { data, error } = await supabase.from("items").update(payload).eq("id", id).select().single();
      if(error) throw error;

      const idx = ALL_ITEMS.findIndex(r => String(r.id) === String(id));
      if(idx >= 0) ALL_ITEMS[idx] = { ...ALL_ITEMS[idx], ...data };
      buildDatalists(ALL_ITEMS);
      buildQuickFilterOptions(ALL_ITEMS);
      render();
      closeEditItemModal();
      setMsg(msg, "✅ تم تحديث المادة بنجاح.", true);
    }catch(ex){
      setMsg(msg, explainSupabaseError(ex), false);
    }
  });
}

$("editItemModalClose")?.addEventListener("click", closeEditItemModal);
$("editItemModalCancel")?.addEventListener("click", closeEditItemModal);
editItemModalEl?.addEventListener("click", (e) => {
  if(e.target === editItemModalEl) closeEditItemModal();
});
document.addEventListener("keydown", (e) => {
  if(e.key === "Escape" && editItemModalEl?.style.display === "flex"){
    closeEditItemModal();
  }
});

// start
(async () => {
  if(await testSupabaseConnection(msg)){
    applyQuickStatusButtons();
    await refreshFromDb(true);
  }
})();

