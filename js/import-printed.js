import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

/**
 * إعدادات الربط مع موقع المطبوع
 */
const PRINTED_SUPABASE_URL = "https://umrczwoxjhxwvrezocrm.supabase.co";
const PRINTED_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ";
const PRINTED_TABLE = "printed_mariages";

const printedSupabase = createClient(PRINTED_SUPABASE_URL, PRINTED_SUPABASE_ANON_KEY);

// عناصر الصفحة
const msgEl = document.getElementById("msg");
const tbody = document.getElementById("tbody");
const summaryEl = document.getElementById("summary");
const destMainEl = document.getElementById("destMain");
const destSubEl = document.getElementById("destSub");
const destUnitEl = document.getElementById("destUnit");

const btnFetch = document.getElementById("btnFetch");
const btnImport = document.getElementById("btnImport");
const btnSelectAll = document.getElementById("btnSelectAll");

let existingSet = new Set();
let lastRows = [];
let selectedKeys = new Set();

/**
 * 1. ميزة الإكمال التلقائي للمجموعات
 */
async function setupAutocomplete() {
    const { data } = await invSupabase.from("items").select("main_category, sub_category");
    if (!data) return;

    const mains = new Set(data.map(i => i.main_category).filter(Boolean));
    const subs = new Set(data.map(i => i.sub_category).filter(Boolean));

    fillDatalist("mainsList", mains, destMainEl);
    fillDatalist("subsList", subs, destSubEl);
}

function fillDatalist(id, set, input) {
    let dl = document.getElementById(id);
    if (!dl) {
        dl = document.createElement("datalist");
        dl.id = id;
        document.body.appendChild(dl);
    }
    dl.innerHTML = [...set].map(v => `<option value="${v}">`).join("");
    input.setAttribute("list", id);
}

/**
 * 2. الدوال المساعدة
 */
function normalizeStr(s) { return String(s || "").trim(); }

function setMsg(text, ok = true) {
    msgEl.textContent = text;
    msgEl.className = ok ? "msg ok" : "msg err";
}

// مفتاح المطابقة: اسم المادة + الكود (لعدم التكرار بغض النظر عن المجموعة)
function getItemKey(row) {
    const name = `${normalizeStr(row.quality)} مطبوع رسمة ${normalizeStr(row.designcode)}`.toLowerCase();
    const color = normalizeStr(row.mariagenumber).toLowerCase();
    return `${name}|||${color}`;
}

/**
 * 3. جلب ومعالجة البيانات
 */
btnFetch.onclick = async () => {
    btnFetch.disabled = true;
    setMsg("⏳ جاري جلب البيانات وفحص المخزون...");

    try {
        // أ. جلب المخزون الحالي للمقارنة
        const { data: invData } = await invSupabase.from("items").select("item_name, color_code");
        existingSet = new Set((invData || []).map(i => 
            `${normalizeStr(i.item_name)}|||${normalizeStr(i.color_code)}`.toLowerCase()
        ));

        // ب. جلب البيانات من المطبوع
        let q = printedSupabase.from(PRINTED_TABLE).select("*");
        
        // فلتر الوقت (آخر 30 يوم كمثال)
        const tr = document.getElementById("timeRange").value;
        if(tr === "30d") {
            const d = new Date(); d.setDate(d.getDate() - 30);
            q = q.gte("date", d.toISOString().split('T')[0]);
        }

        const { data: sourceData, error } = await q.limit(1000);
        if (error) throw error;

        // ج. معالجة البيانات (إزالة التكرار من المصدر)
        const map = new Map();
        sourceData.forEach(r => {
            const key = getItemKey(r);
            if (!map.has(key)) {
                map.set(key, { ...r, _count: 1 });
            } else {
                map.get(key)._count++;
            }
        });

        lastRows = [...map.values()];
        renderTable();
        setMsg("✅ تم تحديث القائمة");
    } catch (e) {
        setMsg("❌ خطأ: " + e.message, false);
    } finally {
        btnFetch.disabled = false;
    }
};

function renderTable() {
    tbody.innerHTML = "";
    let newItems = 0;

    lastRows.forEach(r => {
        const key = getItemKey(r);
        const exists = existingSet.has(key);
        if (!exists) newItems++;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${exists ? '' : `<input type="checkbox" class="pick" data-key="${key}">`}</td>
            <td>${r.quality}</td>
            <td>${r.designcode}</td>
            <td>${r.mariagenumber}</td>
            <td>${r.imageurl ? `<img src="${r.imageurl}" class="thumb">` : '—'}</td>
            <td>${r._count}</td>
            <td>${r.date || '—'}</td>
            <td>${r.status || '—'}</td>
            <td><span class="pill ${exists ? 'exist' : 'new'}">${exists ? 'موجود' : 'جديد'}</span></td>
        `;
        tbody.appendChild(tr);
    });

    summaryEl.innerHTML = `عدد المواد الجديدة القابلة للاستيراد: ${newItems}`;
    btnSelectAll.disabled = btnImport.disabled = (newItems === 0);
}

/**
 * 4. إدارة التحديد والاستيراد
 */
btnSelectAll.onclick = () => {
    document.querySelectorAll(".pick").forEach(cb => {
        cb.checked = true;
        selectedKeys.add(cb.dataset.key);
    });
};

tbody.onchange = (e) => {
    if (e.target.classList.contains("pick")) {
        if (e.target.checked) selectedKeys.add(e.target.dataset.key);
        else selectedKeys.delete(e.target.dataset.key);
    }
};

btnImport.onclick = async () => {
    const mainCat = normalizeStr(destMainEl.value);
    if (!mainCat) return alert("يرجى تحديد المجموعة الأساسية أولاً");

    const toImport = lastRows.filter(r => selectedKeys.has(getItemKey(r)));
    setMsg(`⏳ جاري استيراد ${toImport.length} مادة...`);

    let success = 0;
    for (const r of toImport) {
        const { error } = await invSupabase.from("items").insert({
            main_category: mainCat,
            sub_category: normalizeStr(destSubEl.value) || null,
            item_name: `${normalizeStr(r.quality)} مطبوع رسمة ${normalizeStr(r.designcode)}`,
            color_code: normalizeStr(r.mariagenumber),
            unit_type: destUnitEl.value,
            is_active: true
        });
        if (!error) success++;
    }

    alert(`تم استيراد ${success} مادة بنجاح`);
    btnFetch.click(); // تحديث القائمة بعد الاستيراد
};

// تشغيل عند تحميل الصفحة
setupAutocomplete();
