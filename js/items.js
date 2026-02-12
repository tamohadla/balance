import { supabase } from "./supabaseClient.js";
import { $, cleanText, normalizeArabicDigits, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

// --- 1. الإعدادات والربط مع الواجهة ---
const msg = $("msg");
const tbody = $("itemsTbody");
const mainList = $("mainList");
const subList = $("subList");
const nameList = $("nameList");

// التحقق من الاتصال بالقاعدة
if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
    setMsg(msg, "مفاتيح Supabase غير مُعدلة. راجع js/supabaseClient.js", false);
}

// --- 2. دالة جلب وعرض البيانات (المعدلة لإظهار الموقوف والحذف) ---
async function loadItems() {
    setMsg(msg, "⏳ جارٍ تحديث القائمة...", true);
    
    // قراءة حالة الفلاتر
    const showAll = $("showAll")?.checked || false;
    const q = $("search")?.value.trim();

    // بناء الاستعلام من Supabase
    let query = supabase.from("items").select("*").order("created_at", { ascending: false });
    
    // إذا لم يتم اختيار "إظهار الكل"، نجلب المواد النشطة فقط
    if (!showAll) {
        query = query.eq("is_active", true);
    }

    // منطق البحث العام
    if (q) {
        query = query.or(`main_category.ilike.%${q}%,sub_category.ilike.%${q}%,item_name.ilike.%${q}%,color_code.ilike.%${q}%,color_name.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) return setMsg(msg, explainSupabaseError(error), false);

    // تحديث القوائم الذكية (Datalists) للاقتراحات أثناء الكتابة
    const mains = new Set(), subs = new Set(), names = new Set();
    data.forEach(r => {
        if (r.main_category) mains.add(r.main_category);
        if (r.sub_category) subs.add(r.sub_category);
        if (r.item_name) names.add(r.item_name);
    });
    mainList.innerHTML = [...mains].sort().map(v => `<option value="${escapeHtml(v)}">`).join("");
    subList.innerHTML = [...subs].sort().map(v => `<option value="${escapeHtml(v)}">`).join("");
    nameList.innerHTML = [...names].sort().map(v => `<option value="${escapeHtml(v)}">`).join("");

    // بناء صفوف الجدول
    tbody.innerHTML = (data || []).map(r => {
        const imgUrl = getPublicImageUrl(r.image_path);
        const imgTag = imgUrl ? `<img class="thumb" src="${imgUrl}" />` : `<div class="thumb-placeholder"></div>`;
        
        return `
      <tr class="${!r.is_active ? 'row-inactive' : ''}">
        <td>${imgTag}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td>${escapeHtml(r.unit_type)}</td>
        <td>${escapeHtml(r.description || "")}</td>
        <td>${r.is_active ? '<span class="badge ok">نشط</span>' : '<span class="badge warn">موقوف</span>'}</td>
        <td>
          <div class="actionsRow">
            <button class="secondary" data-act="edit" data-id="${r.id}" title="تعديل">تعديل</button>
            <button class="${r.is_active ? 'secondary' : 'primary'}" data-act="toggle" data-id="${r.id}" data-val="${r.is_active}" title="تغيير الحالة">
                ${r.is_active ? 'إيقاف' : 'تفعيل'}
            </button>
            <button class="danger" data-act="delete" data-id="${r.id}" style="background-color: #ff4757; color: white; border:none;">حذف</button>
          </div>
        </td>
      </tr>`;
    }).join("");

    setMsg(msg, `تم عرض ${data.length} مادة`, true);
}

// --- 3. معالجة الصور ---
async function uploadImageIfAny(itemId) {
    const file = $("image_file").files?.[0];
    if (!file) return null;
    const ext = file.name.split(".").pop();
    const path = `items/${itemId}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("item-images").upload(path, file, { upsert: true });
    if (error) throw error;
    return path;
}

// --- 4. الحفظ والتعديل الفردي ---
$("itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg(msg, "جارٍ الحفظ...", true);

    const payload = {
        main_category: cleanText($("main_category").value),
        sub_category: cleanText($("sub_category").value),
        item_name: cleanText($("item_name").value),
        color_code: normalizeArabicDigits(cleanText($("color_code").value)),
        color_name: cleanText($("color_name").value),
        unit_type: $("unit_type").value,
        description: cleanText($("description").value) || null
    };

    try {
        const id = $("editId").value;
        let res;
        if (id) {
            res = await supabase.from("items").update(payload).eq("id", id).select().single();
        } else {
            res = await supabase.from("items").insert([payload]).select().single();
        }
        if (res.error) throw res.error;

        const imgPath = await uploadImageIfAny(res.data.id);
        if (imgPath) await supabase.from("items").update({ image_path: imgPath }).eq("id", res.data.id);

        $("itemForm").reset();
        $("editId").value = "";
        setMsg(msg, "✅ تم حفظ المادة بنجاح", true);
        loadItems();
    } catch (err) {
        setMsg(msg, explainSupabaseError(err), false);
    }
});

// --- 5. أحداث الجدول (تعديل / تفعيل / حذف) ---
tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { act, id, val } = btn.dataset;

    if (act === "edit") {
        const { data } = await supabase.from("items").select("*").eq("id", id).single();
        if (data) {
            $("editId").value = data.id;
            $("main_category").value = data.main_category;
            $("sub_category").value = data.sub_category;
            $("item_name").value = data.item_name;
            $("color_code").value = data.color_code;
            $("color_name").value = data.color_name;
            $("unit_type").value = data.unit_type;
            $("description").value = data.description || "";
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    } 
    else if (act === "toggle") {
        const { error } = await supabase.from("items").update({ is_active: val === "false" }).eq("id", id);
        if (!error) loadItems();
    } 
    else if (act === "delete") {
        if (confirm("⚠️ هل أنت متأكد من حذف هذه المادة نهائياً؟")) {
            setMsg(msg, "جارٍ الحذف...", true);
            const { error } = await supabase.from("items").delete().eq("id", id);
            if (error) {
                setMsg(msg, "لا يمكن الحذف: المادة مرتبطة بحركات مخزنية (يفضل إيقافها بدلاً من حذفها)", false);
            } else {
                setMsg(msg, "تم حذف المادة بنجاح", true);
                loadItems();
            }
        }
    }
});

// --- 6. التحكم في المودال والفلاتر ---
$("btnBulk").onclick = () => {
    $("bulkModal").style.display = "flex";
};

$("btnReload").onclick = loadItems;

$("btnCancel").onclick = () => { 
    $("itemForm").reset(); 
    $("editId").value = ""; 
    setMsg(msg, "", true);
};

$("search").oninput = () => { 
    clearTimeout(window.searchTimeout); 
    window.searchTimeout = setTimeout(loadItems, 400); 
};

if ($("showAll")) {
    $("showAll").onchange = loadItems;
}

// البدء عند تحميل الصفحة
(async () => {
    if (await testSupabaseConnection(msg)) {
        loadItems();
    }
})();
