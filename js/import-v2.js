import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

const PRINTED_CONF = {
    URL: "https://umrczwoxjhxwvrezocrm.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ",
    TABLE: "printed_mariages"
};
const printedSupabase = createClient(PRINTED_CONF.URL, PRINTED_CONF.KEY);

// DOM Elements
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
    selectAll: document.getElementById("selectAll")
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

// --- 2. جلب البيانات وفحص الوجود ---
el.btnFetch.onclick = async () => {
    el.btnFetch.disabled = true;
    showMsg("⏳ جاري جلب البيانات وفحص المخزون الحالي...");
    
    try {
        // جلب المخزون الحالي (الاسم واللون فقط للمطابقة)
        const { data: inv } = await invSupabase.from("items").select("item_name, color_code");
        EXISTING_KEYS = new Set((inv || []).map(i => `${i.item_name}|||${i.color_code}`.toLowerCase()));

        // جلب بيانات المصدر
        let query = printedSupabase.from(PRINTED_CONF.TABLE).select("*");
        if (document.getElementById("timeRange").value === "30d") {
            const d = new Date(); d.setDate(d.getDate() - 30);
            query = query.gte("date", d.toISOString().split('T')[0]);
        }
        
        const { data: source, error } = await query.limit(1000);
        if (error) throw error;

        // دمج المتكرر في المصدر نفسه
        const map = new Map();
        source.forEach(r => {
            const key = `${r.quality} مطبوع رسمة ${r.designcode}|||${r.mariagenumber}`.toLowerCase();
            if (!map.has(key)) map.set(key, { ...r, _count: 1 });
            else map.get(key)._count++;
        });

        SOURCE_DATA = [...map.values()];
        renderTable();
        showMsg(`✅ تم جلب ${SOURCE_DATA.length} مادة فريدة.`);
    } catch (err) {
        showMsg("❌ خطأ: " + err.message, true);
    } finally {
        el.btnFetch.disabled = false;
    }
};

function renderTable() {
    el.tbody.innerHTML = "";
    const q = document.getElementById("q").value.toLowerCase();
    
    SOURCE_DATA.forEach(r => {
        const itemName = `${r.quality} مطبوع رسمة ${r.designcode}`;
        const key = `${itemName}|||${r.mariagenumber}`.toLowerCase();
        const exists = EXISTING_KEYS.has(key);

        if (q && !itemName.toLowerCase().includes(q) && !r.mariagenumber.includes(q)) return;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${exists ? '' : `<input type="checkbox" class="item-ch" data-key="${key}">`}</td>
            <td>${r.quality}</td>
            <td>${r.designcode}</td>
            <td>${r.mariagenumber}</td>
            <td>${r.imageurl ? `<img src="${r.imageurl}" class="thumb">` : '—'}</td>
            <td>${r._count}</td>
            <td>${r.status || '—'}</td>
            <td><span class="pill ${exists ? 'exist' : 'new'}">${exists ? 'موجود' : 'جديد'}</span></td>
        `;
        el.tbody.appendChild(tr);
    });
}

// --- 3. إدارة التحديد والمودال ---
el.tbody.onchange = (e) => {
    if (e.target.classList.contains("item-ch")) {
        e.target.checked ? SELECTED_KEYS.add(e.target.dataset.key) : SELECTED_KEYS.delete(e.target.dataset.key);
        updateUI();
    }
};

el.selectAll.onchange = (e) => {
    document.querySelectorAll(".item-ch").forEach(ch => {
        ch.checked = e.target.checked;
        e.target.checked ? SELECTED_KEYS.add(ch.dataset.key) : SELECTED_KEYS.delete(ch.dataset.key);
    });
    updateUI();
};

function updateUI() {
    el.selectedCount.textContent = SELECTED_KEYS.size;
    el.btnOpenModal.disabled = SELECTED_KEYS.size === 0;
}

el.btnOpenModal.onclick = () => el.modal.style.display = "flex";
document.getElementById("btnCloseModal").onclick = () => el.modal.style.display = "none";

// --- 4. عملية الاستيراد مع شريط التقدم ---
el.btnConfirm.onclick = async () => {
    const main = document.getElementById("destMain").value.trim();
    if (!main) return alert("المجموعة الأساسية إجبارية");

    const sub = document.getElementById("destSub").value.trim();
    const unit = document.getElementById("destUnit").value;
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
        el.progText.textContent = `جاري استيراد ${i + 1} من أصل ${toImport.length}...`;

        const { error } = await invSupabase.from("items").insert({
            main_category: main,
            sub_category: sub || null,
            item_name: `${r.quality} مطبوع رسمة ${r.designcode}`,
            color_code: r.mariagenumber,
            unit_type: unit,
            is_active: true
        });

        if (!error) success++;
    }

    el.progText.textContent = `✅ اكتمل العمل! تم استيراد ${success} مادة بنجاح.`;
    setTimeout(() => {
        el.modal.style.display = "none";
        el.progCont.style.display = "none";
        el.btnConfirm.disabled = false;
        SELECTED_KEYS.clear();
        el.btnFetch.click(); // لتحديث الجدول
    }, 2000);
};

function showMsg(text, isErr = false) {
    const m = document.getElementById("msg");
    m.style.display = "block";
    m.textContent = text;
    m.style.background = isErr ? "#fee" : "#f0fdf4";
}

initAutocomplete();
