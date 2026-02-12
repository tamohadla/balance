import { supabase } from "./supabaseClient.js";
import { $, cleanText, normalizeArabicDigits, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

// --- 1. الأساسيات والتحقق من الإعدادات ---
const msg = $("msg");
if (keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)) {
    setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("itemsTbody");
const mainList = $("mainList");
const subList = $("subList");
const nameList = $("nameList");

// Debug helpers
window.__itemsModuleLoaded = true;
window.addEventListener("error", (e) => { try { setMsg(msg, "خطأ JavaScript: " + (e?.message || e), false); } catch (_) { } });
window.addEventListener("unhandledrejection", (e) => { try { setMsg(msg, "Promise error: " + (e?.reason?.message || e?.reason || e), false); } catch (_) { } });

setMsg(msg, "تم تحميل صفحة المواد (items.js) ...", true);

// --- 2. الدوال المساعدة للعرض ---
function rowStatusBadge(isActive) {
    return isActive ? '<span class="badge ok">نشط</span>' : '<span class="badge warn">موقوف</span>';
}

async function loadItems() {
    setMsg(msg, "تحميل...", true);
    tbody.innerHTML = "";
    mainList.innerHTML = ""; subList.innerHTML = ""; nameList.innerHTML = "";

    const showAll = $("showAll").checked;
    const q = $("search").value.trim();

    let query = supabase.from("items").select("*").order("created_at", { ascending: false });
    if (!showAll) query = query.eq("is_active", true);

    if (q) {
        query = query.or(`main_category.ilike.%${q}%,sub_category.ilike.%${q}%,item_name.ilike.%${q}%,color_code.ilike.%${q}%,color_name.ilike.%${q}%,description.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) { setMsg(msg, explainSupabaseError(error), false); return; }

    const mains = new Set(), subs = new Set(), names = new Set();
    for (const r of (data || [])) {
        if (r.main_category) mains.add(r.main_category);
        if (r.sub_category) subs.add(r.sub_category);
        if (r.item_name) names.add(r.item_name);
    }
    mainList.innerHTML = [...mains].sort().map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
    subList.innerHTML = [...subs].sort().map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
    nameList.innerHTML = [...names].sort().map(v => `<option value="${escapeHtml(v)}"></option>`).join("");

    tbody.innerHTML = (data || []).map(r => {
        const imgUrl = getPublicImageUrl(r.image_path);
        const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" />` : `<span class="thumb"></span>`;
        const desc = escapeHtml(r.description ?? "");
        return `
      <tr>
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td>${escapeHtml(r.unit_type)}</td>
        <td>${desc}</td>
        <td>${rowStatusBadge(r.is_active)}</td>
        <td>
          <div class="actionsRow">
            <button class="secondary" data-act="edit" data-id="${r.id}">تعديل</button>
            ${r.is_active
                ? `<button class="secondary" data-act="deactivate" data-id="${r.id}">إيقاف</button>`
                : `<button class="secondary" data-act="activate" data-id="${r.id}">تفعيل</button>`
            }
            <button class="danger" data-act="delete" data-id="${r.id}">حذف</button>
          </div>
        </td>
      </tr>`;
    }).join("");

    setMsg(msg, `تم التحميل: ${(data || []).length} مادة`, true);
}

async function uploadImageIfAny(itemId) {
    const file = $("image_file").files?.[0];
    if (!file) return null;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `items/${itemId}.${ext}`;
    const { error: upErr } = await supabase.storage
        .from("item-images")
        .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (upErr) throw upErr;
    return path;
}

// --- 3. أحداث النموذج والبحث ---
$("btnReload").addEventListener("click", loadItems);
$("search").addEventListener("input", () => { clearTimeout(window.__t); window.__t = setTimeout(loadItems, 250); });
$("showAll").addEventListener("change", loadItems);

$("btnCancel").addEventListener("click", () => {
    $("editId").value = "";
    $("itemForm").reset();
    setMsg(msg, "تم إلغاء التعديل", true);
});

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
        description: cleanText($("description").value) || null,
    };

    try {
        const editId = $("editId").value || null;
        let itemId = editId;

        if (!editId) {
            const { data, error } = await supabase.from("items").insert([payload]).select("id").single();
            if (error) throw error;
            itemId = data.id;
        } else {
            const { error } = await supabase.from("items").update(payload).eq("id", editId);
            if (error) throw error;
        }

        const image_path = await uploadImageIfAny(itemId);
        if (image_path) {
            const { error } = await supabase.from("items").update({ image_path }).eq("id", itemId);
            if (error) throw error;
        }

        $("editId").value = "";
        $("itemForm").reset();
        setMsg(msg, "تم الحفظ بنجاح", true);
        await loadItems();
    } catch (err) {
        setMsg(msg, explainSupabaseError(err), false);
    }
});

// الأحداث داخل الجدول (تعديل، تفعيل، حذف)
tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === "edit") {
        const { data, error } = await supabase.from("items").select("*").eq("id", id).single();
        if (error) return setMsg(msg, explainSupabaseError(error), false);

        $("editId").value = data.id;
        $("main_category").value = data.main_category || "";
        $("sub_category").value = data.sub_category || "";
        $("item_name").value = data.item_name || "";
        $("color_code").value = data.color_code || "";
        $("color_name").value = data.color_name || "";
        $("unit_type").value = data.unit_type || "";
        $("description").value = data.description || "";
        $("image_file").value = "";
        setMsg(msg, "وضع التعديل مفعل — عدّل ثم اضغط حفظ", true);
    } else if (act === "activate" || act === "deactivate") {
        const is_active = act === "activate";
        const { error } = await supabase.from("items").update({ is_active }).eq("id", id);
        if (error) return setMsg(msg, explainSupabaseError(error), false);
        await loadItems();
    } else if (act === "delete") {
        if (!confirm("تأكيد الحذف النهائي؟")) return;
        const { error } = await supabase.from("items").delete().eq("id", id);
        if (error) return setMsg(msg, explainSupabaseError(error), false);
        await loadItems();
    }
});

// --- 4. قسم الإضافة الجماعية (Bulk Add) ---
// --- قسم الإضافة الجماعية المطور (Excel + Paste) ---
const bulkModal = $("bulkModal");
const bulkMsg = $("bulkMsg");
const bulkTbody = $("bulkTbody");
const bulkText = $("bulkText");
const bulkFile = $("bulkFile");
const btnApply = $("bulkApply");

function openBulk() { bulkModal.style.display = "flex"; }
function closeBulk() { bulkModal.style.display = "none"; }

// دالة قراءة ملف الإكسل
async function readExcel(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // تحويل الصفوف إلى تنسيق النص الذي يفهمه محرك الفحص لدينا (تجاهل الهيدر)
    return rows.slice(1).map(row => row.join("|")).join("\n");
}

// مراقبة اختيار الملف
bulkFile.addEventListener("change", async (e) => {
    if (e.target.files.length > 0) {
        const text = await readExcel(e.target.files[0]);
        bulkText.value = text;
        setMsg(bulkMsg, "تم استخراج البيانات من الملف، اضغط معاينة للفحص", true);
    }
});

async function bulkPreview() {
    setMsg(bulkMsg, "جارٍ الفحص والمطابقة...", true);
    btnApply.style.display = "none";

    const parsed = parseBulkLines(bulkText?.value || "");
    const okOnes = parsed.filter(x => x.ok).map(x => x.data);

    if (okOnes.length === 0 && parsed.length > 0) {
        setMsg(bulkMsg, "جميع السطور تحتوي على أخطاء في الصيغة!", false);
        renderPreviewTable(parsed, new Set());
        return;
    }

    // فحص التكرار في قاعدة البيانات
    let existingSet = new Set();
    try {
        existingSet = await fetchExistingKeys(okOnes);
    } catch (e) {
        console.error("خطأ في فحص التكرار", e);
    }

    renderPreviewTable(parsed, existingSet);

    const newCount = okOnes.filter(d => !existingSet.has(keyOf(d))).length;
    if (newCount > 0) {
        btnApply.style.display = "inline-block";
        setMsg(bulkMsg, `فحص مكتمل: تم العثور على ${newCount} مادة جديدة جاهزة للاعتماد.`, true);
    } else {
        setMsg(bulkMsg, "لا توجد مواد جديدة (كلها موجودة مسبقاً أو بها أخطاء).", false);
    }
    
    return { okOnes, existingSet };
}

function renderPreviewTable(parsed, existingSet) {
    bulkTbody.innerHTML = parsed.map(p => {
        if (!p.ok) return `<tr class="err-row"><td>${p.idx}</td><td><span class="badge danger">خطأ صيغة</span></td><td colspan="5">${p.reason}</td></tr>`;
        
        const isDup = existingSet.has(keyOf(p.data));
        const status = isDup ? '<span class="badge warn">موجود مسبقاً</span>' : '<span class="badge ok">جاهز للاعتماد</span>';
        
        return `<tr class="${isDup ? 'dup-row' : ''}">
            <td>${p.idx}</td>
            <td>${status}</td>
            <td>${materialLabel(p.data)}</td>
            <td>${p.data.color_code}</td>
            <td>${p.data.color_name}</td>
            <td>${p.data.unit_type}</td>
            <td>${p.data.description || ""}</td>
        </tr>`;
    }).join("");
}

// ... (تكملة الدوال المساعدة parseBulkLines و keyOf و fetchExistingKeys من الكود السابق) ...

// ربط الأزرار
document.getElementById("btnBulk")?.addEventListener("click", openBulk);
document.getElementById("bulkClose")?.addEventListener("click", closeBulk);
document.getElementById("bulkPreview")?.addEventListener("click", bulkPreview);
document.getElementById("bulkApply")?.addEventListener("click", bulkApply);
document.getElementById("bulkClear")?.addEventListener("click", () => { 
    bulkText.value = ""; bulkFile.value = ""; bulkTbody.innerHTML = ""; btnApply.style.display = "none"; 
});


// التشغيل المبدئي
(async () => {
    const ok = await testSupabaseConnection(msg);
    if (ok) await loadItems();
})();
