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
const bulkModal = document.getElementById("bulkModal");
const bulkMsg = document.getElementById("bulkMsg");
const bulkTbody = document.getElementById("bulkTbody");
const bulkText = document.getElementById("bulkText");

function openBulk() { if (bulkModal) bulkModal.style.display = "flex"; }
function closeBulk() { if (bulkModal) bulkModal.style.display = "none"; }

function parseBulkLines(text) {
    const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const parts = raw.split("|").map(p => p.trim());
        if (parts.length < 6) {
            out.push({ idx: i + 1, raw, ok: false, reason: "صيغة غير صحيحة (اقل من 6 حقول)" });
            continue;
        }
        const [main_category, sub_category, item_name, color_code_raw, color_name, unit_raw] = parts;
        const description = parts.slice(6).join(" | ").trim() || null;

        const color_code = normalizeArabicDigits(cleanText(color_code_raw));
        const unit_type = unit_raw.toLowerCase();

        if (!main_category || !sub_category || !item_name || !color_code || !color_name || !unit_type) {
            out.push({ idx: i + 1, raw, ok: false, reason: "حقول ناقصة" });
            continue;
        }
        if (unit_type !== "kg" && unit_type !== "m") {
            out.push({ idx: i + 1, raw, ok: false, reason: "الوحدة يجب أن تكون kg أو m" });
            continue;
        }
        out.push({
            idx: i + 1, raw, ok: true,
            data: {
                main_category: cleanText(main_category),
                sub_category: cleanText(sub_category),
                item_name: cleanText(item_name),
                color_code,
                color_name: cleanText(color_name),
                unit_type,
                description: description ? cleanText(description) : null,
                is_active: true
            }
        });
    }
    return out;
}

function keyOf(d) {
    return `${d.main_category}|||${d.sub_category}|||${d.item_name}|||${d.color_code}`.toLowerCase();
}

async function fetchExistingKeys(candidates) {
    const mains = [...new Set(candidates.map(x => x.main_category))];
    const { data, error } = await supabase.from("items").select("main_category, sub_category, item_name, color_code").in("main_category", mains);
    if (error) throw error;
    const set = new Set();
    for (const r of (data || [])) {
        set.add(`${r.main_category}|||${r.sub_category}|||${r.item_name}|||${r.color_code}`.toLowerCase());
    }
    return set;
}

async function bulkPreview() {
    setMsg(bulkMsg, "جارٍ التحضير...", true);
    const parsed = parseBulkLines(bulkText?.value || "");
    const okOnes = parsed.filter(x => x.ok).map(x => x.data);

    const seen = new Set();
    const uniqueCandidates = [];
    for (const d of okOnes) {
        const k = keyOf(d);
        if (seen.has(k)) continue;
        seen.add(k);
        uniqueCandidates.push(d);
    }

    let existingSet = new Set();
    if (uniqueCandidates.length) {
        try { existingSet = await fetchExistingKeys(uniqueCandidates); } catch (e) { console.error(e); }
    }

    if (bulkTbody) {
        bulkTbody.innerHTML = parsed.map(p => {
            if (!p.ok) return `<tr><td>${p.idx}</td><td><span class="badge danger">خطأ</span> ${escapeHtml(p.reason)}</td><td colspan="5"><code>${escapeHtml(p.raw)}</code></td></tr>`;
            const isDup = existingSet.has(keyOf(p.data));
            return `<tr>
                <td>${p.idx}</td>
                <td>${isDup ? '<span class="badge warn">موجود</span>' : '<span class="badge ok">جديد</span>'}</td>
                <td>${escapeHtml(materialLabel(p.data))}</td>
                <td>${escapeHtml(p.data.color_code)}</td>
                <td>${escapeHtml(p.data.color_name)}</td>
                <td>${escapeHtml(p.data.unit_type)}</td>
                <td>${escapeHtml(p.data.description || "")}</td>
            </tr>`;
        }).join("");
    }

    const total = parsed.length;
    const newCount = uniqueCandidates.filter(d => !existingSet.has(keyOf(d))).length;
    setMsg(bulkMsg, `إجمالي: ${total} | جديد: ${newCount}`, true);
    return { uniqueCandidates, existingSet };
}

async function bulkApply() {
    const { uniqueCandidates, existingSet } = await bulkPreview();
    const toInsert = uniqueCandidates.filter(d => !existingSet.has(keyOf(d)));
    if (!toInsert.length) return setMsg(bulkMsg, "لا توجد بيانات جديدة للحفظ", false);

    setMsg(bulkMsg, `جارٍ حفظ ${toInsert.length} مادة...`, true);
    const { error } = await supabase.from("items").insert(toInsert);
    if (error) {
        setMsg(bulkMsg, explainSupabaseError(error), false);
    } else {
        setMsg(bulkMsg, `تم بنجاح إضافة ${toInsert.length} مادة`, true);
        bulkText.value = "";
        await loadItems();
    }
}

// ربط أزرار الـ Bulk
document.getElementById("btnBulk")?.addEventListener("click", openBulk);
document.getElementById("bulkClose")?.addEventListener("click", closeBulk);
document.getElementById("bulkPreview")?.addEventListener("click", bulkPreview);
document.getElementById("bulkApply")?.addEventListener("click", bulkApply);
document.getElementById("bulkClear")?.addEventListener("click", () => { bulkText.value = ""; bulkTbody.innerHTML = ""; });

// التشغيل المبدئي
(async () => {
    const ok = await testSupabaseConnection(msg);
    if (ok) await loadItems();
})();
