const arabicDigitsMap = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" };

export function normalizeText(value){
  const s = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, d => arabicDigitsMap[d] || d)
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[\-_\/|]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

export function toNumber(value){
  if(value === null || value === undefined || value === "") return null;
  const raw = String(value).replace(/[٠-٩]/g, d => arabicDigitsMap[d] || d).replace(/,/g, "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function toInt(value){
  const n = toNumber(value);
  if(n === null) return null;
  return Math.round(n);
}

export function toISODate(value){
  if(!value) return null;
  if(value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  const txt = String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
  const d = new Date(txt);
  if(Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0,10);
}
