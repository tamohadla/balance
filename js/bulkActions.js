import { supabase } from "./supabaseClient.js";
import { $, cleanText, normalizeArabicDigits, setMsg, materialLabel, explainSupabaseError } from "./shared.js";

// 1. تعريف العناصر داخل المودال
const bulkModal = $("bulkModal");
const bulkTbody = $("bulkTbody");
const bulkMsg = $("bulkMsg");
const bulkText = $("bulkText");
const bulkFile = $("bulkFile");
const btnApply = $("bulkApply");

// 2. دالة تحويل النص إلى بيانات (صنف|فرعي|اسم|كود|لون|وحدة|وصف)
function parseBulkLines(text) {
    const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return lines.map((raw, i) => {
        const parts = raw.split("|").map(p => p.trim());
        if (parts.length < 6) return { idx: i + 1, ok: false, reason: "بيانات ناقصة (تحتاج 6 أعمدة)" };
        
        const unit = parts[5].toLowerCase();
        return {
            idx: i + 1, ok: true,
            data: {
                main_category: cleanText(parts[0]),
                sub_category: cleanText(parts[1]),
                item_name: cleanText(parts[2]),
                color_code: normalizeArabicDigits(cleanText(parts[3])),
                color_name: cleanText(parts[4]),
                unit_type: (unit === 'm' || unit === 'kg') ? unit : 'kg',
                description: parts[6] || null,
                is_active: true
            }
        };
    });
}

// 3. دالة فحص إذا كانت المادة موجودة مسبقاً في قاعدة البيانات
const keyOf = (d) => `${(d.item_name||"").trim()}||${(d.color_code||"").trim()}`.toLowerCase();

async function fetchExistingKeys(candidates) {
    const names = [...new Set(candidates.map(x => (x.item_name||"").trim()).filter(Boolean))];
    if(names.length === 0) return new Set();
    const all = [];
    const chunkSize = 200;
    for(let i=0;i<names.length;i+=chunkSize){
        const chunk = names.slice(i,i+chunkSize);
        const { data, error } = await supabase.from("items")
          .select("item_name, color_code")
          .in("item_name", chunk);
        if(error) throw error;
        all.push(...(data||[]));
    }
    return new Set(all.map(r => keyOf(r)));
}

// 4. دالة المعاينة (Preview) ورسم الجدول الملون
async function handlePreview() {
    setMsg(bulkMsg, "⏳ جارٍ فحص البيانات ومطابقتها مع المخزن...", true);
    btnApply.style.display = "none";
    
    const parsed = parseBulkLines(bulkText.value);
    const okOnes = parsed.filter(x => x.ok).map(x => x.data);
    
    if (!okOnes.length) return setMsg(bulkMsg, "⚠️ لا توجد بيانات صالحة للفحص", false);

    let existingSet = new Set();
    try {
        existingSet = await fetchExistingKeys(okOnes);
    } catch(e) { console.error(e); }
    
    // رسم الجدول داخل المودال
    bulkTbody.innerHTML = parsed.map(p => {
        if (!p.ok) return `<tr class="status-error"><td>${p.idx}</td><td>❌ خطأ</td><td colspan="5">${p.reason}</td></tr>`;
        
        const isDup = existingSet.has(keyOf(p.data));
        const statusClass = isDup ? 'status-exists' : 'status-new';
        const statusText = isDup ? 'موجود مسبقاً' : 'جديد (جاهز)';
        
        return `<tr class="${statusClass}">
            <td>${p.idx}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${materialLabel(p.data)}</td>
            <td>${p.data.color_code}</td>
            <td>${p.data.color_name}</td>
            <td>${p.data.unit_type}</td>
            <td>${p.data.description || "-"}</td>
        </tr>`;
    }).join("");

    const newItems = okOnes.filter(d => !existingSet.has(keyOf(d)));
    if (newItems.length > 0) {
        btnApply.style.display = "inline-block";
        setMsg(bulkMsg, `✅ فحص مكتمل: تم العثور على ${newItems.length} صنف جديد.`, true);
    } else {
        setMsg(bulkMsg, "ℹ️ جميع البيانات المدخلة موجودة مسبقاً في النظام.", false);
    }
}

// 5. دالة حفظ البيانات الجديدة فقط
async function handleApply() {
    const parsed = parseBulkLines(bulkText.value);
    const okOnes = parsed.filter(x => x.ok).map(x => x.data);
    const existingSet = await fetchExistingKeys(okOnes);
    const toInsert = okOnes.filter(d => !existingSet.has(keyOf(d)));

    if (!toInsert.length) return;

    setMsg(bulkMsg, `🚀 جارٍ الحفظ في قاعدة البيانات (${toInsert.length} صنف)...`, true);
    const { error } = await supabase.from("items").insert(toInsert);
    
    if (error) return setMsg(bulkMsg, explainSupabaseError(error), false);
    
    setMsg(bulkMsg, "🎉 تم حفظ البيانات بنجاح! سيتم تحديث الصفحة...", true);
    setTimeout(() => { location.reload(); }, 1500);
}

// 6. قراءة ملف Excel وتحويله لنص
bulkFile.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const wb = XLSX.read(evt.target.result, { type: 'binary' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            // تحويل ورقة الإكسل إلى مصفوفة بيانات
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
            
            // تحويل الصفوف (بعد تجاهل الهيدر) إلى صيغة النص المفصول بـ |
            const textContent = rows.slice(1)
                .filter(r => r.length > 0)
                .map(row => row.map(cell => String(cell || "").trim()).join("|"))
                .join("\n");
            
            bulkText.value = textContent;
            setMsg(bulkMsg, "✅ تم قراءة ملف الإكسل. اضغط 'فحص ومعاينة' الآن.", true);
        } catch (err) {
            setMsg(bulkMsg, "❌ خطأ في قراءة ملف الإكسل", false);
        }
    };
    reader.readAsBinaryString(file);
};

// 7. ربط الأزرار بالدوال
$("bulkPreview").onclick = handlePreview;
$("bulkApply").onclick = handleApply;
$("bulkClear").onclick = () => { 
    bulkText.value = ""; bulkFile.value = ""; bulkTbody.innerHTML = ""; btnApply.style.display="none"; 
    setMsg(bulkMsg, "", true);
};
$("bulkClose").onclick = () => bulkModal.style.display = "none";
