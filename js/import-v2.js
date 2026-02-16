import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

const PRINTED_CONF = {
    URL: "https://umrczwoxjhxwvrezocrm.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ",
    TABLE: "printed_mariages",
    DEST_BUCKET: "item-images"
};
const printedSupabase = createClient(PRINTED_CONF.URL, PRINTED_CONF.KEY);

const el = {
    tbody: document.getElementById("tbody"),
    btnFetch: document.getElementById("btnFetch"),
    btnOpenModal: document.getElementById("btnOpenModal"),
    btnConfirm: document.getElementById("btnConfirmImport"),
    modal: document.getElementById("importModal"),
    progFill: document.getElementById("progFill"),
    progText: document.getElementById("progText"),
    progCont: document.getElementById("progContainer"),
    selectedCount: document.getElementById("selectedCount"),
    selectAll: document.getElementById("selectAll"),
    qualityFilter: document.getElementById("qualityFilter"),
    statusFilter: document.getElementById("statusFilter"),
    timeRange: document.getElementById("timeRange"),
    sortOrder: document.getElementById("sortOrder"),
    newOnlyFilter: document.getElementById("newOnlyFilter"),
    qSearch: document.getElementById("q")
};

let SOURCE_DATA = [];
let EXISTING_KEYS = new Set();
let SELECTED_KEYS = new Set();

// 1. جلب الاكمال التلقائي
async function initAutocomplete() {
    const { data } = await invSupabase.from("items").select("main_category, sub_category");
    if (!data) return;
    const mains = [...new Set(data.map(i => i.main_category).filter(Boolean))];
    const subs = [...new Set(data.map(i => i.sub_category).filter(Boolean))];
    document.getElementById("mainsList").innerHTML = mains.map(m => `<option value="${m}">`).join("");
    document.getElementById("subsList").innerHTML = subs.map(s => `<option value="${s}">`).join("");
}

// 2. دالة نقل الصور
async function copyImageToInventory(itemId, imageUrl) {
    if (!imageUrl) return null;
    try {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        const path = `items/${itemId}_${Date.now()}.jpg`;
        const { error } = await invSupabase.storage.from(PRINTED_CONF.DEST_BUCKET).upload(path, blob);
        return error ? null : path;
    } catch { return null; }
}

// 3. الجلب الرئيسي
el.btnFetch.onclick = async () => {
    el.btnFetch.disabled = true;
    showMsg("⏳ جاري المزامنة مع المطبوع...");
    
    try {
        // فحص المخزون الحالي
        const { data: inv } = await invSupabase.from("items").select("item_name, color_code");
        EXISTING_KEYS = new Set((inv || []).map(i => `${i.item_name}|||${i.color_code}`.toLowerCase()));

        // جلب المصدر مع فلتر الوقت
        let query = printedSupabase.from(PRINTED_CONF.TABLE).select("*");
        
        if (el.timeRange.value === "30d") {
            const date = new Date();
            date.setDate(date.getDate() - 30);
            query = query.gte("date", date.toISOString().split('T')[0]);
        }

        const { data: source, error } = await query.order('date', { ascending: false }).limit(2000);
        if (error) throw error;

        // دمج التكرارات
        const map = new Map();
        const qualities = new Set();
        source.forEach(r => {
            const key = `${r.quality} مطبوع رسمة ${r.designcode}|||${r.mariagenumber}`.toLowerCase();
            if (r.quality) qualities.add(r.quality);
            if (!map.has(key)) map.set(key, { ...r, _count: 1 });
            else map.get(key)._count++;
        });

        SOURCE_DATA = [...map.values()];
        
        // تحديث فلتر الخامات
        el.qualityFilter.innerHTML = '<option value="">الكل</option>' + 
            [...qualities].sort().map(q => `<option value="${q}">${q}</option>`).join("");

        renderTable();
        showMsg("✅ تم تحديث البيانات بنجاح");
    } catch (err) {
        showMsg("❌ خطأ: " + err.message, true);
    } finally {
        el.btnFetch.disabled = false;
    }
};

// 4. عرض الجدول مع الفلترة والترتيب
function renderTable() {
    el.tbody.innerHTML = "";
    
    let filtered = SOURCE_DATA.filter(r => {
        const itemName = `${r.quality} مطبوع رسمة ${r.designcode}`;
        const key = `${itemName}|||${r.mariagenumber}`.toLowerCase();
        const exists = EXISTING_KEYS.has(key);

        // فلتر البحث
        if (el.qSearch.value && !itemName.toLowerCase().includes(el.qSearch.value.toLowerCase()) && !r.mariagenumber.includes(el.qSearch.value)) return false;
        // فلتر الخامة
        if (el.qualityFilter.value && r.quality !== el.qualityFilter.value) return false;
        // فلتر الحالة
        if (el.statusFilter.value && r.status !== el.statusFilter.value) return false;
        // فلتر الجديد فقط
        if (el.newOnlyFilter.value === "new" && exists) return false;

        return true;
    });

    // الترتيب
    filtered.sort((a, b) => {
        if (el.sortOrder.value === "date_desc") return new Date(b.date) - new Date(a.date);
        if (el.sortOrder.value === "design_asc") return a.designcode.localeCompare(b.designcode, undefined, {numeric: true});
        if (el.sortOrder.value === "quality_asc") return a.quality.localeCompare(b.quality);
        return 0;
    });

    filtered.forEach(r => {
        const key = `${r.quality} مطبوع رسمة ${r.designcode}|||${r.mariagenumber}`.toLowerCase();
        const exists = EXISTING_KEYS.has(key);
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="text-align:center">${exists ? '' : `<input type="checkbox" class="item-ch" data-key="${key}" ${SELECTED_KEYS.has(key)?'checked':''}>`}</td>
            <td>${r.quality}</td>
            <td>${r.designcode}</td>
            <td>${r.mariagenumber}</td>
            <td>${r.imageurl ? `<img src="${r.imageurl}" class="thumb" loading="lazy">` : '—'}</td>
            <td>${r._count}</td>
            <td>${r.date || '—'}</td>
            <td>${r.status || '—'}</td>
            <td><span class="pill ${exists ? 'exist' : 'new'}">${exists ? 'موجود' : 'جديد'}</span></td>
        `;
        el.tbody.appendChild(tr);
    });
}

// 5. الاستيراد الفعلي
el.btnConfirm.onclick = async () => {
    const main = document.getElementById("destMain").value.trim();
    if (!main) return alert("المجموعة الأساسية إجبارية");

    const toImport = SOURCE_DATA.filter(r => SELECTED_KEYS.has(`${r.quality} مطبوع رسمة ${r.designcode}|||${r.mariagenumber}`.toLowerCase()));

    el.btnConfirm.disabled = true;
    el.progCont.style.display = "block";
    
    let success = 0;
    for (let i = 0; i < toImport.length; i++) {
        const r = toImport[i];
        el.progFill.style.width = Math.round(((i + 1) / toImport.length) * 100) + "%";
        el.progText.textContent = `جاري معالجة ${i + 1} من ${toImport.length}...`;

        const { data: newItem, error } = await invSupabase.from("items").insert({
            main_category: main,
            sub_category: document.getElementById("destSub").value.trim() || null,
            item_name: `${r.quality} مطبوع رسمة ${r.designcode}`,
            color_code: r.mariagenumber,
            unit_type: document.getElementById("destUnit").value,
            is_active: true
        }).select("id").single();

        if (!error && newItem) {
            success++;
            if (r.imageurl) {
                const path = await copyImageToInventory(newItem.id, r.imageurl);
                if (path) await invSupabase.from("items").update({ image_path: path }).eq("id", newItem.id);
            }
        }
    }

    el.progText.textContent = `✅ اكتمل العمل! تم استيراد ${success} مواد.`;
    setTimeout(() => { location.reload(); }, 1500);
};

// مراقبة الفلاتر
[el.qualityFilter, el.statusFilter, el.sortOrder, el.newOnlyFilter, el.timeRange].forEach(f => f.onchange = renderTable);
el.qSearch.oninput = renderTable;

// إدارة التحديد
el.tbody.onchange = (e) => {
    if (e.target.classList.contains("item-ch")) {
        e.target.checked ? SELECTED_KEYS.add(e.target.dataset.key) : SELECTED_KEYS.delete(e.target.dataset.key);
        el.selectedCount.textContent = SELECTED_KEYS.size;
        el.btnOpenModal.disabled = SELECTED_KEYS.size === 0;
    }
};

el.selectAll.onchange = (e) => {
    document.querySelectorAll(".item-ch").forEach(ch => {
        ch.checked = e.target.checked;
        e.target.checked ? SELECTED_KEYS.add(ch.dataset.key) : SELECTED_KEYS.delete(ch.dataset.key);
    });
    el.selectedCount.textContent = SELECTED_KEYS.size;
    el.btnOpenModal.disabled = SELECTED_KEYS.size === 0;
};

el.btnOpenModal.onclick = () => el.modal.style.display = "flex";
document.getElementById("btnCloseModal").onclick = () => el.modal.style.display = "none";

function showMsg(t, err=false) {
    el.progText.parentElement.style.display = 'none';
    const m = document.getElementById("msg");
    m.style.display = "block"; m.textContent = t;
    m.style.background = err ? "#fee" : "#f0fdf4";
}

initAutocomplete();
