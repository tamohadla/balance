import { toISODate } from "./normalize.js";

const CANDIDATE_KEYS = {
  raw_item_name: ["item", "item_name", "المادة", "اسم المادة", "اسم الصنف"],
  raw_color_code: ["color_code", "كود اللون", "رقم اللون"],
  raw_color_name: ["color_name", "اسم اللون"],
  raw_qty_primary: ["qty", "qty_main", "quantity", "الكمية", "الكمية الرئيسية"],
  raw_rolls: ["rolls", "qty_rolls", "عدد الاثواب", "عدد الأثواب", "الاثواب"],
  raw_date: ["date", "التاريخ"],
  raw_notes: ["note", "notes", "ملاحظات"],
};

function pickValue(row, keys){
  for(const k of keys){
    if(row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
}

export function parseSheetRows(sheetRows){
  return (sheetRows || []).map((r, idx) => ({
    row_index: idx + 1,
    raw_item_name: pickValue(r, CANDIDATE_KEYS.raw_item_name),
    raw_color_code: pickValue(r, CANDIDATE_KEYS.raw_color_code),
    raw_color_name: pickValue(r, CANDIDATE_KEYS.raw_color_name),
    raw_qty_primary: pickValue(r, CANDIDATE_KEYS.raw_qty_primary),
    raw_rolls: pickValue(r, CANDIDATE_KEYS.raw_rolls),
    raw_date: toISODate(pickValue(r, CANDIDATE_KEYS.raw_date)),
    raw_notes: pickValue(r, CANDIDATE_KEYS.raw_notes),
  })).filter(x => x.raw_item_name || x.raw_color_code || x.raw_qty_primary || x.raw_rolls);
}

export function readXlsxFile(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const wb = window.XLSX.read(reader.result, { type: "array" });
        const first = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(first, { defval: "" });
        resolve(parseSheetRows(rows));
      }catch(err){ reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
