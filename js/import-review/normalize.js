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
  if(value === null || value === undefined || value === "") return null;

  const fromParts = (y, m, d) => {
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if(!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if(month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const fromDateObj = (dateObj) => {
    if(!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
    return fromParts(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate());
  };

  if(typeof value === "number" && window.XLSX?.SSF?.parse_date_code){
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if(parsed) return fromParts(parsed.y, parsed.m, parsed.d);
  }

  if(value instanceof Date){
    return fromDateObj(value);
  }

  const txt = String(value).trim().replace(/[٠-٩]/g, d => arabicDigitsMap[d] || d);
  if(!txt) return null;

  if(/^\d+$/.test(txt) && window.XLSX?.SSF?.parse_date_code){
    const parsed = window.XLSX.SSF.parse_date_code(Number(txt));
    if(parsed) return fromParts(parsed.y, parsed.m, parsed.d);
  }

  const isoMatch = txt.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(isoMatch){
    return fromParts(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const dmyMatch = txt.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if(dmyMatch){
    return fromParts(dmyMatch[3], dmyMatch[2], dmyMatch[1]);
  }

  const parsed = new Date(txt);
  return fromDateObj(parsed);
}
