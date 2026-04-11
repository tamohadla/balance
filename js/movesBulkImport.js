import { supabase } from "./supabaseClient.js";
import { cleanText, normalizeArabicDigits, setMsg } from "./shared.js";

const REQUIRED_HEADERS = ["item_name", "color_code", "qty_main", "qty_rolls"];

const HEADER_ALIASES = {
  date: ["date", "التاريخ"],
  item_name: ["item_name", "اسم المادة", "المادة"],
  color_code: ["color_code", "رقم اللون", "اللون"],
  qty_main: ["qty_main", "الكمية الرئيسية"],
  qty_rolls: ["qty_rolls", "الكمية الفرعية", "عدد الاثواب", "عدد الأثواب"],
  note: ["note", "ملاحظات", "ملاحظة"]
};

function toISODate(value, fallbackDate){
  if(value === null || value === undefined || value === "") return fallbackDate;

  if(typeof value === "number" && window.XLSX?.SSF?.parse_date_code){
    const p = window.XLSX.SSF.parse_date_code(value);
    if(p){
      const mm = String(p.m).padStart(2, "0");
      const dd = String(p.d).padStart(2, "0");
      return `${p.y}-${mm}-${dd}`;
    }
  }

  const text = normalizeArabicDigits(String(value).trim());
  if(!text) return fallbackDate;

  const m = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(m){
    return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if(!Number.isNaN(parsed.getTime())){
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function normalizeHeader(value){
  return String(value || "").trim().toLowerCase();
}

function resolveHeaderIndexes(headerRow){
  const normalized = headerRow.map(normalizeHeader);
  const indexes = {};

  for(const [key, aliases] of Object.entries(HEADER_ALIASES)){
    indexes[key] = normalized.findIndex(h => aliases.some(a => normalizeHeader(a) === h));
  }
  return indexes;
}

async function fetchItemsByNames(names){
  const rows = [];
  for(let i = 0; i < names.length; i += 200){
    const chunk = names.slice(i, i + 200);
    const { data, error } = await supabase
      .from("items")
      .select("id, item_name, color_code, is_active")
      .eq("is_active", true)
      .in("item_name", chunk);
    if(error) throw error;
    rows.push(...(data || []));
  }
  const map = new Map();
  for(const it of rows){
    const key = `${cleanText(it.item_name).toLowerCase()}||${normalizeArabicDigits(cleanText(it.color_code)).toLowerCase()}`;
    map.set(key, it.id);
  }
  return map;
}

export function initMovesBulkImport({ moveType, msgEl, dateInput, onDone }){
  const bulkFileInput = document.getElementById("bulkFileInput");
  const btnBulkImport = document.getElementById("btnBulkImport");
  const btnDownloadTemplate = document.getElementById("btnDownloadTemplate");

  if(!bulkFileInput || !btnBulkImport || !btnDownloadTemplate) return;

  btnDownloadTemplate.addEventListener("click", () => {
    if(!window.XLSX){
      setMsg(msgEl, "تعذر إنشاء القالب: مكتبة Excel غير متاحة", false);
      return;
    }

    const sample = [
      ["date", "item_name", "color_code", "qty_main", "qty_rolls", "note"],
      ["2026-04-11", "اسم المادة كما هو بالنظام", "101", 12.5, 3, "ملاحظة اختيارية"]
    ];

    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(sample);
    window.XLSX.utils.book_append_sheet(wb, ws, "template");
    window.XLSX.writeFile(wb, `bulk-${moveType}-template.xlsx`);
  });

  btnBulkImport.addEventListener("click", () => bulkFileInput.click());

  bulkFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;

    if(!window.XLSX){
      setMsg(msgEl, "تعذر قراءة الملف: مكتبة Excel غير متاحة", false);
      bulkFileInput.value = "";
      return;
    }

    try{
      setMsg(msgEl, "جارٍ قراءة ملف الإكسل...", true);

      const buffer = await file.arrayBuffer();
      const wb = window.XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

      if(rows.length < 2){
        setMsg(msgEl, "الملف فارغ أو لا يحتوي صفوف بيانات", false);
        return;
      }

      const headerIndexes = resolveHeaderIndexes(rows[0]);
      const missing = REQUIRED_HEADERS.filter(k => headerIndexes[k] === -1);
      if(missing.length){
        setMsg(msgEl, `الأعمدة المطلوبة غير موجودة: ${missing.join(", ")}`, false);
        return;
      }

      const defaultDate = dateInput?.value || new Date().toISOString().slice(0, 10);
      const parsedRows = [];
      const validationErrors = [];

      for(let i = 1; i < rows.length; i++){
        const row = rows[i];
        if(!row || row.every(v => cleanText(v) === "")) continue;

        const lineNo = i + 1;
        const itemName = cleanText(row[headerIndexes.item_name]);
        const colorCode = normalizeArabicDigits(cleanText(row[headerIndexes.color_code]));
        const qtyMain = Number(normalizeArabicDigits(cleanText(row[headerIndexes.qty_main])));
        const qtyRolls = Number(normalizeArabicDigits(cleanText(row[headerIndexes.qty_rolls])));
        const note = cleanText(row[headerIndexes.note]) || null;
        const moveDate = toISODate(row[headerIndexes.date], defaultDate);

        if(!itemName || !colorCode){
          validationErrors.push(`السطر ${lineNo}: اسم المادة/رقم اللون مطلوب.`);
          continue;
        }
        if(!(qtyMain > 0)){
          validationErrors.push(`السطر ${lineNo}: الكمية الرئيسية يجب أن تكون أكبر من صفر.`);
          continue;
        }
        if(!Number.isInteger(qtyRolls) || qtyRolls <= 0){
          validationErrors.push(`السطر ${lineNo}: الكمية الفرعية يجب أن تكون عددًا صحيحًا أكبر من صفر.`);
          continue;
        }
        if(!moveDate){
          validationErrors.push(`السطر ${lineNo}: التاريخ غير صالح.`);
          continue;
        }

        parsedRows.push({ lineNo, itemName, colorCode, qtyMain, qtyRolls, note, moveDate });
      }

      if(validationErrors.length){
        setMsg(msgEl, `يوجد أخطاء في الملف (${validationErrors.length}): ${validationErrors.slice(0, 3).join(" | ")}`, false);
        return;
      }

      if(!parsedRows.length){
        setMsg(msgEl, "لا توجد صفوف صالحة للاستيراد", false);
        return;
      }

      const uniqueNames = [...new Set(parsedRows.map(r => r.itemName))];
      const itemMap = await fetchItemsByNames(uniqueNames);

      const unresolved = [];
      const payloads = parsedRows.map(r => {
        const key = `${r.itemName.toLowerCase()}||${r.colorCode.toLowerCase()}`;
        const itemId = itemMap.get(key);
        if(!itemId){
          unresolved.push(`السطر ${r.lineNo}: المادة غير موجودة (${r.itemName} / ${r.colorCode}).`);
          return null;
        }

        const payload = {
          type: moveType,
          move_date: r.moveDate,
          item_id: itemId,
          note: r.note,
          qty_main_in: 0,
          qty_main_out: 0,
          qty_rolls_in: 0,
          qty_rolls_out: 0
        };

        if(moveType === "purchase"){
          payload.qty_main_in = r.qtyMain;
          payload.qty_rolls_in = r.qtyRolls;
        }else{
          payload.qty_main_out = r.qtyMain;
          payload.qty_rolls_out = r.qtyRolls;
        }

        return payload;
      }).filter(Boolean);

      if(unresolved.length){
        setMsg(msgEl, `تعذر مطابقة بعض المواد (${unresolved.length}): ${unresolved.slice(0, 3).join(" | ")}`, false);
        return;
      }

      setMsg(msgEl, `جارٍ استيراد ${payloads.length} سطر...`, true);
      for(let i = 0; i < payloads.length; i += 200){
        const chunk = payloads.slice(i, i + 200);
        const { error } = await supabase.from("stock_moves").insert(chunk);
        if(error) throw error;
      }

      setMsg(msgEl, `تم استيراد ${payloads.length} سطر بنجاح`, true);
      if(typeof onDone === "function") await onDone();
    }catch(ex){
      setMsg(msgEl, ex?.message || "حدث خطأ أثناء الاستيراد", false);
    } finally {
      bulkFileInput.value = "";
    }
  });
}
