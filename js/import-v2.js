import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

const PRINTED_CONF = {
    URL: "https://umrczwoxjhxwvrezocrm.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ",
    TABLE: "printed_mariages",
    DEST_BUCKET: "item-images" // اسم باكت الصور عندك
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
    statusFilter: document.getElementById("statusFilter")
};

let SOURCE_DATA = [];
let EXISTING_KEYS = new Set();
let SELECTED_KEYS = new Set();

// --- 1. الإكمال التلقائي ---
async function initAutocomplete() {
    const { data } = await invSupabase.from("items").select("main_category, sub_category");
    if (!data) return;
    const mains = [...new Set(data.map(i => i.main_category).filter(Boolean))];
    const subs = [...new Set(data.map(i => i.sub_category).filter(Boolean))];
    document.getElementById("mainsList").innerHTML = mains.map(m => `<option value="${m}">`).join("");
    document.getElementById("subsList").innerHTML = subs.map(s => `<option value="${s}">`).join("");
}

// --- 2. دالة نقل الصورة ---
async function copyImageToInventory(itemId, imageUrl) {
    if (!imageUrl) return null;
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const fileName = `items/${itemId}_img.jpg`;
        const { error: upErr } = await invSupabase.storage.from(PRINTED_CONF.DEST_BUCKET).upload(fileName, blob, { upsert: true });
        if (upErr) throw upErr;
        return fileName;
    } catch (e) {
        console.warn("فشل نقل الصورة:", e);
        return null;
    }
}

// --- 3. جلب ومعالجة البيانات ---
el.btnFetch.onclick = async () => {
    el.btnFetch.disabled = true;
    try {
        const { data: inv } = await invSupabase.from("items").select("item_name, color_code");
        EXISTING_KEYS = new Set((inv || []).map(i => `${i.item_name}|||${i.color_code}`.toLowerCase()));

        let query = printedSupabase.from(PRINTED_CONF.TABLE).select("*");
        const { data: source, error } = await query.limit(2000);
        if (error) throw error;

        const map = new Map();
        const qualities = new Set();

        source.forEach(r => {
            const key = `${r.quality} مطبوع رسمة ${r.designcode}|||${r.mariagenumber}`.toLowerCase();
            if (r.quality) qualities.add(r.quality);
            if (!map.has(key)) map.set(key, { ...r, _count: 1 });
            else map.get(key)._count++;
        });

        SOURCE_DATA = [...map.values()];
        
        // تحديث قائمة الخامات المنسدلة
        el.qualityFilter.innerHTML = '<option value="">كل الخامات</option>' + 
            [...qualities].sort().map(q => `<option value="${q}">${q}</option>`).join("");

        renderTable();
    } catch (err) { console.error(err); }
    finally { el.btnFetch.disabled = false; }
};

// --- 4. العرض والفلترة ---
function renderTable() {
    el.tbody.innerHTML = "";
    const qSearch = document.getElementById("q").value.toLowerCase();
    const qQual = el.qualityFilter.value;
    const qStat = el.statusFilter.value;
    
    SOURCE_DATA.forEach(r => {
        const itemName = `${r.quality} مطبوع رسمة ${r.designcode}`;
        const key = `${itemName}|||${r.mariagenumber}`.toLowerCase();
        const exists = EXISTING_KEYS.has(key);

        // تطبيق الفلاتر
        if (qSearch && !itemName.toLowerCase().includes(qSearch) && !r.mariagenumber.includes(qSearch)) return;
        if (qQual && r.quality !== qQual) return;
        if (qStat && r.status !== qStat) return;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${exists ? '' : `<input type="checkbox" class="item-ch" data-key="${key}">`}</td>
            <td>${r.quality}</td>
            <td>${r.designcode}</td>
            <td>${r.mariagenumber}</td>
            <td>${r.imageurl ? `<img src="${r.imageurl}" class="thumb" loading="lazy">` : '—'}</td>
            <td>${r._count}</td>
            <td>${r.status || '—'}</td>
            <td><span class="pill ${exists ? 'exist' : 'new'}">${exists ? 'موجود' : 'جديد'}</span></td>
        `;
        el.tbody.appendChild(tr);
    });
}

// ربط الفلاتر برسم الجدول فوراً عند التغيير
el.qualityFilter.onchange = renderTable;
el.statusFilter.onchange = renderTable;
document.getElementById("q").oninput = renderTable;

// --- 5. الاستيراد الفعلي ---
el.btnConfirm.onclick = async () => {
    const main = document.getElementById("destMain").value.trim();
    if (!main) return alert("المجموعة الأساسية إجبارية");

    const toImport = SOURCE_DATA.filter(r => {
        const key = `${r.quality} مطبوع رسمة ${r.designcode}|||${r.mariagenumber}`.toLowerCase();
        return SELECTED_KEYS.has(key);
    });

    el.btnConfirm.disabled = true;
    el.progCont.style.display = "block";
    
    let success = 0;
    for (let i = 0; i < toImport.length; i++) {
        const r = toImport[i];
        const progress = Math.round(((i + 1) / toImport.length) * 100);
        el.progFill.style.width = progress + "%";
        el.progText.textContent = `جاري استيراد ونقل صور ${i + 1} من ${toImport.length}...`;

        // 1. إدخال بيانات المادة
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
            // 2. معالجة الصورة إذا وجدت
            if (r.imageurl) {
                const imagePath = await copyImageToInventory(newItem.id, r.imageurl);
                if (imagePath) {
                    await invSupabase.from("items").update({ image_path: imagePath }).eq("id", newItem.id);
                }
            }
        }
    }

    el.progText.textContent = `✅ تم استيراد ${success} مادة مع صورها بنجاح!`;
    setTimeout(() => { location.reload(); }, 2000);
};

// بقية الدوال (إدارة التحديد والمودال)
el.tbody.onchange = (e) => { if (e.target.classList.contains("item-ch")) { e.target.checked ? SELECTED_KEYS.add(e.target.dataset.key) : SELECTED_KEYS.delete(e.target.dataset.key); updateUI(); } };
el.selectAll.onchange = (e) => { document.querySelectorAll(".item-ch").forEach(ch => { ch.checked = e.target.checked; e.target.checked ? SELECTED_KEYS.add(ch.dataset.key) : SELECTED_KEYS.delete(ch.dataset.key); }); updateUI(); };
function updateUI() { el.selectedCount.textContent = SELECTED_KEYS.size; el.btnOpenModal.disabled = SELECTED_KEYS.size === 0; }
el.btnOpenModal.onclick = () => el.modal.style.display = "flex";
document.getElementById("btnCloseModal").onclick = () => el.modal.style.display = "none";

initAutocomplete();
