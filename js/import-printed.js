import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

// إعدادات المصدر
const PRINTED_CONFIG = {
    URL: "https://umrczwoxjhxwvrezocrm.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ",
    TABLE: "printed_mariages"
};

const printedSupabase = createClient(PRINTED_CONFIG.URL, PRINTED_CONFIG.KEY);

// عناصر الواجهة
const dom = {
    msg: document.getElementById("msg"),
    tbody: document.getElementById("tbody"),
    summary: document.getElementById("summary"),
    btnFetch: document.getElementById("btnFetch"),
    btnImport: document.getElementById("btnImport"),
    btnSelectAll: document.getElementById("btnSelectAll"),
    inputs: {
        main: document.getElementById("destMain"),
        sub: document.getElementById("destSub"),
        unit: document.getElementById("destUnit"),
        q: document.getElementById("q"),
        status: document.getElementById("statusFilter"),
        time: document.getElementById("timeRange")
    }
};

let CACHE_EXISTING = new Set();
let LAST_FETCHED_DATA = [];
let SELECTED_ITEMS = new Set();

/** 1. نظام الإكمال التلقائي الخفيف **/
async function initAutocomplete() {
    try {
        const { data } = await invSupabase.from("items").select("main_category, sub_category");
        if (!data) return;

        const mains = [...new Set(data.map(i => i.main_category).filter(Boolean))];
        const subs = [...new Set(data.map(i => i.sub_category).filter(Boolean))];

        updateDatalist("mainsList", mains, dom.inputs.main);
        updateDatalist("subsList", subs, dom.inputs.sub);
    } catch (e) { console.error("Autocomplete failed", e); }
}

function updateDatalist(id, list, input) {
    let dl = document.getElementById(id) || document.createElement("datalist");
    dl.id = id;
    dl.innerHTML = list.map(v => `<option value="${v}">`).join("");
    if (!dl.parentElement) document.body.appendChild(dl);
    input.setAttribute("list", id);
}

/** 2. الفحص السريع للمخزون **/
async function refreshExistingCache() {
    const { data } = await invSupabase.from("items").select("item_name, color_code");
    CACHE_EXISTING = new Set((data || []).map(i => 
        `${String(i.item_name).trim()}|||${String(i.color_code).trim()}`.toLowerCase()
    ));
}

/** 3. جلب البيانات ومعالجتها **/
const normalize = (s) => String(s || "").trim();

dom.btnFetch.onclick = async () => {
    dom.btnFetch.disabled = true;
    dom.msg.textContent = "⏳ جاري التحديث...";
    
    try {
        // تنفيذ العمليات بالتوازي لسرعة أكبر
        const [_, rawData] = await Promise.all([
            refreshExistingCache(),
            fetchFromSource()
        ]);

        LAST_FETCHED_DATA = processRows(rawData);
        renderTable();
        dom.msg.textContent = "✅ جاهز";
    } catch (e) {
        dom.msg.textContent = "❌ خطأ في الجلب";
    } finally {
        dom.btnFetch.disabled = false;
    }
};

async function fetchFromSource() {
    let query = printedSupabase.from(PRINTED_CONFIG.TABLE).select("designcode,mariagenumber,quality,imageurl,status,date");
    
    if (dom.inputs.status.value) query = query.eq("status", dom.inputs.status.value);
    if (dom.inputs.time.value === "30d") {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        query = query.gte("date", date.toISOString().split('T')[0]);
    }

    const { data, error } = await query.limit(2000);
    if (error) throw error;
    return data;
}

function processRows(rows) {
    const map = new Map();
    const searchQ = dom.inputs.q.value.toLowerCase();

    for (const r of rows) {
        if (searchQ && !Object.values(r).some(v => String(v).toLowerCase().includes(searchQ))) continue;

        const key = `${normalize(r.quality)}|${r.designcode}|${r.mariagenumber}`.toLowerCase();
        if (!map.has(key)) {
            map.set(key, { ...r, _count: 1, _img: r.imageurl });
        } else {
            const entry = map.get(key);
            entry._count++;
            if (r.date > entry.date) { entry.date = r.date; entry.status = r.status; }
        }
    }
    return [...map.values()];
}

/** 4. العرض السلس **/
function renderTable() {
    let html = "";
    let stats = { new: 0, exist: 0 };

    LAST_FETCHED_DATA.forEach(r => {
        const itemName = `${normalize(r.quality)} مطبوع رسمة ${normalize(r.designcode)}`;
        const colorCode = normalize(r.mariagenumber);
        const invKey = `${itemName}|||${colorCode}`.toLowerCase();
        const exists = CACHE_EXISTING.has(invKey);

        exists ? stats.exist++ : stats.new++;

        html += `
            <tr class="${exists ? 'row-exists' : ''}">
                <td>${exists ? '' : `<input type="checkbox" class="pick" data-key="${invKey}">`}</td>
                <td>${r.quality}</td>
                <td>${r.designcode}</td>
                <td>${r.mariagenumber}</td>
                <td>${r._img ? `<img src="${r._img}" class="thumb" loading="lazy">` : '—'}</td>
                <td>${r._count}</td>
                <td>${r.date || '—'}</td>
                <td><span class="pill ${exists ? 'exist' : 'new'}">${exists ? 'موجود' : 'جديد'}</span></td>
            </tr>`;
    });

    dom.tbody.innerHTML = html;
    dom.summary.innerHTML = `جديد: ${stats.new} | موجود: ${stats.exist}`;
    dom.btnImport.disabled = stats.new === 0;
}

/** 5. الاستيراد الفعلي **/
dom.btnImport.onclick = async () => {
    const main = normalize(dom.inputs.main.value);
    if (!main) { alert("المجموعة الأساسية مطلوبة"); return; }

    const toImport = LAST_FETCHED_DATA.filter(r => {
        const key = `${normalize(r.quality)} مطبوع رسمة ${normalize(r.designcode)}|||${normalize(r.mariagenumber)}`.toLowerCase();
        return SELECTED_ITEMS.has(key);
    });

    dom.btnImport.disabled = true;
    let count = 0;

    for (const r of toImport) {
        const { error } = await invSupabase.from("items").insert({
            main_category: main,
            sub_category: normalize(dom.inputs.sub.value) || null,
            item_name: `${normalize(r.quality)} مطبوع رسمة ${normalize(r.designcode)}`,
            color_code: normalize(r.mariagenumber),
            unit_type: dom.inputs.unit.value,
            is_active: true
        });
        if (!error) count++;
    }

    alert(`تم استيراد ${count} أصناف`);
    dom.btnFetch.click();
};

// إدارة التحديد
dom.tbody.onchange = (e) => {
    if (e.target.classList.contains("pick")) {
        e.target.checked ? SELECTED_ITEMS.add(e.target.dataset.key) : SELECTED_ITEMS.delete(e.target.dataset.key);
    }
};

dom.btnSelectAll.onclick = () => {
    document.querySelectorAll(".pick").forEach(cb => {
        cb.checked = true;
        SELECTED_ITEMS.add(cb.dataset.key);
    });
};

// تشغيل عند التحميل
initAutocomplete();
