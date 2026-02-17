import { supabase } from "./supabaseClient.js";
import { $, cleanText, normalizeArabicDigits, escapeHtml, setMsg, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
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
const showInactiveEl = $("showInactive");

if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
  setMsg(msg, "مفاتيح Supabase غير مُعدلة. راجع js/supabaseClient.js", false);
}

let ALL_ITEMS = [];
let lastLoadedAt = 0;

// Bucket name
const ITEM_BUCKET = "item-images";

// ثابت: مسار واحد لكل مادة -> يمنع مخلفات عند تبديل الصورة
function stableItemImagePath(itemId){
  return `items/${itemId}.jpg`;
}

async function fileToImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// تصغير إلى 800px على أكبر ضلع + تحويل إلى JPG
async function resizeToJpegBlob(file, maxSide = 800, quality = 0.9){
  const img = await fileToImage(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if(!w || !h) throw new Error("Invalid image");

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,tw,th);
  ctx.drawImage(img, 0, 0, tw, th);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if(!blob) return reject(new Error("Failed to encode image"));
      resolve(blob);
    }, "image/jpeg", quality);
  });
}

function openImageViewer(url){
  const back = document.getElementById("imageModal");
  const img = document.getElementById("imageModalImg");
  if(!back || !img) return;
  img.src = url;
  back.style.display = "flex";
}

function closeImageViewer(){
  const back = document.getElementById("imageModal");
  const img = document.getElementById("imageModalImg");
  if(!back || !img) return;
  back.style.display = "none";
  img.src = "";
}

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

function render(){
  const q = (searchEl?.value || "").trim().toLowerCase();
  const showInactive = !!(showInactiveEl?.checked);

  const rows = (ALL_ITEMS || [])
    .filter(r => showInactive ? true : (r.is_active === true))
    .filter(r => matchesSearch(r, q))
    .sort((a,b) =>
      byText(a.main_category,b.main_category) ||
      byText(a.sub_category,b.sub_category) ||
      byText(a.item_name,b.item_name) ||
      byText(a.color_code,b.color_code)
    );

  tbody.innerHTML = rows.map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const imgTag = imgUrl
      ? `<img class="thumb" src="${imgUrl}" alt="img" data-full="${imgUrl}" style="cursor: zoom-in;" />`
      : `<div class="thumb-placeholder"></div>`;

    return `
      <tr class="${!r.is_active ? "row-inactive" : ""}">
        <td>${imgTag}</td>
        <td>${escapeHtml(r.main_category || "")}</td>
        <td>${escapeHtml(r.sub_category || "")}</td>
        <td>${escapeHtml(r.item_name || "")}</td>
        <td>${escapeHtml(r.color_code || "")}</td>
        <td>${escapeHtml(r.color_name || "")}</td>
        <td>${escapeHtml(r.unit_type || "")}</td>
        <td>${escapeHtml(r.description || "")}</td>
        <td>${r.is_active ? '<span class="badge ok">نشط</span>' : '<span class="badge warn">موقوف</span>'}</td>
        <td>
          <div class="actionsRow">
            <button class="secondary" data-act="edit" data-id="${r.id}" title="تعديل">تعديل</button>
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

async function refreshFromDb(force=false){
  const now = Date.now();
  // Avoid hammering refresh on fast typing; allow explicit reload
  if(!force && ALL_ITEMS.length && (now - lastLoadedAt) < 10_000){
    render();
    return;
  }

  setMsg(msg, "⏳ جارٍ تحديث القائمة...", true);

  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  if(error){
    setMsg(msg, explainSupabaseError(error), false);
    return;
  }

  ALL_ITEMS = data || [];
  lastLoadedAt = Date.now();
  buildDatalists(ALL_ITEMS);
  render();
}

// --- الصور ---
async function uploadOrReplaceImage(itemId, existingPath){
  const file = $("image_file")?.files?.[0];
  if(!file) return null;

  // 1) تصغير إلى 800px + JPG
  const blob = await resizeToJpegBlob(file, 800, 0.9);

  // 2) overwrite لنفس المسار الثابت
  const targetPath = stableItemImagePath(itemId);
  const { error: upErr } = await supabase
    .storage
    .from(ITEM_BUCKET)
    .upload(targetPath, blob, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600"
    });
  if(upErr) throw upErr;

  // 3) تنظيف مخلفات (لو كان موجود مسار قديم مختلف)
  if(existingPath && existingPath !== targetPath){
    try{ await supabase.storage.from(ITEM_BUCKET).remove([existingPath]); }catch(_e){ /* ignore */ }
  }

  return targetPath;
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
      const u = await supabase.from("items").update({ image_path: imgPath }).eq("id", res.data.id);
      if(u.error) throw u.error;
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
      const { data, error } = await supabase.from("items").select("*").eq("id", id).single();
      if(error) throw error;
      if(data){
        $("editId").value = data.id;
        $("main_category").value = data.main_category || "";
        $("sub_category").value = data.sub_category || "";
        $("item_name").value = data.item_name || "";
        $("color_code").value = data.color_code || "";
        $("color_name").value = data.color_name || "";
        $("unit_type").value = data.unit_type || "kg";
        $("description").value = data.description || "";
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
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
          try{ await supabase.storage.from(ITEM_BUCKET).remove([row.image_path]); }catch(_e){ /* ignore */ }
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

// --- Image modal controls ---
document.getElementById("imageModalClose")?.addEventListener("click", closeImageViewer);
document.getElementById("imageModal")?.addEventListener("click", (e) => {
  if(e.target && e.target.id === "imageModal") closeImageViewer();
});
document.addEventListener("keydown", (e) => {
  if(e.key === "Escape") closeImageViewer();
});

// --- تحكم ---
$("btnReload").onclick = () => refreshFromDb(true);
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
if(showInactiveEl){
  showInactiveEl.addEventListener("change", () => render());
}

// start
(async () => {
  if(await testSupabaseConnection(msg)){
    await refreshFromDb(true);
  }
})();
