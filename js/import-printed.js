import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { supabase as invSupabase } from "./supabaseClient.js";

/**
 * بيانات الموقع المصدر (المطبوع)
 */
const PRINTED_SUPABASE_URL = "https://umrczwoxjhxwvrezocrm.supabase.co";
const PRINTED_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmN6d294amh4d3ZyZXpvY3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODA0MTUsImV4cCI6MjA3OTU1NjQxNX0.88PDM2h93rhGhOxVRDa5q3rismemqJJEpmBdwWmfgVQ";
const PRINTED_TABLE = "printed_mariages";
const DEST_BUCKET = "item-images";

const printedSupabase = createClient(PRINTED_SUPABASE_URL, PRINTED_SUPABASE_ANON_KEY);

const msgEl = document.getElementById("msg");
const tbody = document.getElementById("tbody");
const summaryEl = document.getElementById("summary");

const timeRangeEl = document.getElementById("timeRange");
const statusEl = document.getElementById("statusFilter");
const qEl = document.getElementById("q");
const sortByEl = document.getElementById("sortBy");
const destMainEl = document.getElementById("destMain");
const destSubEl = document.getElementById("destSub");
const destUnitEl = document.getElementById("destUnit");

const btnFetch = document.getElementById("btnFetch");
const btnImport = document.getElementById("btnImport");
const btnSelectAll = document.getElementById("btnSelectAll");

let existingSet = new Set();
let lastRows = [];
let selectedKeys = new Set();

// --- إعداد قوائم الإكمال التلقائي (Autocomplete) ---
async function setupDatalists() {
    const { data, error } = await invSupabase.from("items").select("main_category, sub_category");
    if (error) return;

    const mains = new Set();
    const subs = new Set();

    data.forEach(item => {
        if (item.main_category) mains.add(item.main_category);
        if (item.sub_category) subs.add(item.sub_category);
    });

    createDatalist("mainsList", mains, destMainEl);
    createDatalist("subsList", subs, destSubEl);
}

function createDatalist(id, set, inputEl) {
    let dl = document.getElementById(id);
    if (!dl) {
        dl = document.createElement("datalist");
        dl.id = id;
        document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    [...set].sort().forEach(val => {
        const opt = document.createElement("option");
        opt.value = val;
        dl.appendChild(opt);
    });
    inputEl.setAttribute("list", id);
}

function setMsg(text, ok = true) {
    msgEl.textContent = text;
    msgEl.className = ok ? "msg ok" : "msg err";
}

function normalizeStr(s) { return String(s || "").trim(); }

/**
 * تعديل المطابقة: الآن نطابق بناءً على اسم المادة ورقم المرياج فقط
 * لمنع التكرار حتى لو تغيرت المجموعات
 */
function itemKeyCandidate(row) {
    const item_name = `${normalizeStr(row.quality)} مطبوع رسمة ${normalizeStr(row.designcode)}`.toLowerCase();
    const color_code = normalizeStr(row.mariagenumber).toLowerCase();
    return `${item_name}|||${color_code}`;
}

async function fetchExistingInventoryKeys() {
    // جلب اسم المادة والكود فقط للمقارنة الشاملة
    const { data, error } = await invSupabase.from("items").select("item_name, color_code");
    if (error) throw error;

    const set = new Set();
    for (const r of (data || [])) {
        const k = `${normalizeStr(r.item_name)}|||${normalizeStr(r.color_code)}`.toLowerCase();
        set.add(k);
    }
    return set;
}

// --- الدوال المساعدة للجلب من المصدر (لم تتغير) ---
async function fetchPrintedRows() {
    let q = printedSupabase.from(PRINTED_TABLE).select("designcode,mariagenumber,quality,imageurl,status,date");
    const status = statusEl.value;
    if (status) q = q.eq("status", status);

    const tr = timeRangeEl.value;
    if (tr === "30d") {
        const now = new Date();
        const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        q = q.gte("date", from.toISOString().slice(0, 10));
    }

    const { data, error } = await q.limit(1000);
    if (error) throw error;
    return data || [];
}

function dedup(rows) {
    const map = new Map();
    for (const r of rows) {
        const k = `${normalizeStr(r.quality)}|||${normalizeStr(r.designcode)}|||${normalizeStr(r.mariagenumber)}`.toLowerCase();
        if (!map.has(k)) {
            map.set(k, { ...r, _count: 1, _anyImage: normalizeStr(r.imageurl), _lastDate: r.date, _lastStatus: r.status });
        } else {
            const cur = map.get(k);
            cur._count++;
            if (r.date > cur._lastDate) { cur._lastDate = r.date; cur._lastStatus = r.status; }
            if (!cur._anyImage && r.imageurl) cur._anyImage = r.imageurl;
        }
    }
    return [...map.values()];
}

function render(rows, existingSet) {
    tbody.innerHTML = "";
    let newCount = 0, existCount = 0;

    rows.forEach(r => {
        const invKey = itemKeyCandidate(r);
        const exists = existingSet.has(invKey);

        if (exists) existCount++; else newCount++;

        const tr = document.createElement("tr");
        const chk = !exists ? `<input type="checkbox" class="pick" data-key="${invKey}">` : "";
        const badge = exists ? `<span class="pill exist">موجود</span>` : `<span class="pill new">جديد</span>`;

        tr.innerHTML = `
      <td>${chk}</td>
      <td>${r.quality}</td>
      <td>${r.designcode}</td>
      <td>${r.mariagenumber}</td>
      <td>${r._anyImage ? `<img class="thumb" src="${r._anyImage}">` : "—"}</td>
      <td>${r._count}</td>
      <td>${r._lastDate || "—"}</td>
      <td>${r._lastStatus || "—"}</td>
      <td>${badge}</td>
    `;
        tbody.appendChild(tr);
    });

    summaryEl.style.display = "block";
    summaryEl.innerHTML = `<span class="pill new">جديد: ${newCount}</span> <span class="pill exist">موجود: ${existCount}</span>`;
    btnImport.disabled = (newCount === 0);
    btnSelectAll.disabled = (newCount === 0);
}

// --- العمليات الأساسية ---

btnFetch.onclick = async () => {
    btnFetch.disabled = true;
    setMsg("⏳ جاري التحقق من المخزون والبيانات...", true);
    try {
        existingSet = await fetchExistingInventoryKeys();
        const raw = await fetchPrintedRows();
        lastRows = dedup(raw);
        render(lastRows, existingSet);
        setMsg(`تم تحديث البيانات.`, true);
    } catch (e) {
        setMsg(e.message, false);
    } finally {
        btnFetch.disabled = false;
    }
};

btnSelectAll.onclick = () => {
    document.querySelectorAll(".pick").forEach(ch => {
        ch.checked = true;
        selectedKeys.add(ch.dataset.key);
    });
};

tbody.onchange = (e) => {
    if (e.target.classList.contains("pick")) {
        if (e.target.checked) selectedKeys.add(e.target.dataset.key);
        else selectedKeys.delete(e.target.dataset.key);
    }
};

btnImport.onclick = async () => {
    const main = normalizeStr(destMainEl.value);
    if (!main) return setMsg("⚠️ يرجى اختيار مجموعة أساسية", false);

    const pickedRows = lastRows.filter(r => selectedKeys.has(itemKeyCandidate(r)));
    setMsg(`⏳ جاري استيراد ${pickedRows.length} مادة...`, true);

    let ok = 0;
    for (const r of pickedRows) {
        try {
            const item = {
                main_category: main,
                sub_category: normalizeStr(destSubEl.value) || null,
                item_name: `${normalizeStr(r.quality)} مطبوع رسمة ${normalizeStr(r.designcode)}`,
                color_code: normalizeStr(r.mariagenumber),
                unit_type: destUnitEl.value,
                is_active: true
            };
            const { data, error } = await invSupabase.from("items").insert(item).select("id").single();
            if (!error) ok++;
        } catch (e) { console.error(e); }
    }
    setMsg(`✅ تم استيراد ${ok} مادة بنجاح`, true);
    btnFetch.click();
};

// تشغيل Autocomplete عند تحميل الصفحة
setupDatalists();
