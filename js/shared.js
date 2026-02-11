import { supabase } from "./supabaseClient.js";

export function $(id){ return document.getElementById(id); }

export function cleanText(s){
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeArabicDigits(str){
  if (!str) return str;
  const map = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" };
  return String(str).replace(/[٠-٩]/g, d => map[d]);
}

export function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

export function setMsg(el, text, ok=true){
  if(!el) return;
  el.textContent = text || "";
  el.className = "msg " + (ok ? "ok":"err");
}

export function materialLabel(row){
  return `${row.main_category} - ${row.sub_category} - ${row.item_name}`;
}

export function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

export function unitLabel(unit_type){
  return unit_type === "kg" ? "كغ" : unit_type === "m" ? "متر" : "";
}

export function getPublicImageUrl(image_path){
  if(!image_path) return "";
  const { data } = supabase.storage.from("item-images").getPublicUrl(image_path);
  return data?.publicUrl || "";
}

export function daysSince(dateStr){
  if(!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.floor((now - d) / (1000*60*60*24));
}


export function keysLookUnchanged(url, key){
  return !url || !key || url.includes("PUT_YOUR_") || key.includes("PUT_YOUR_");
}

export function explainSupabaseError(error){
  if(!error) return "خطأ غير معروف";
  const parts = [];
  if(error.message) parts.push(error.message);
  if(error.details) parts.push(error.details);
  if(error.hint) parts.push(error.hint);
  if(error.code) parts.push(`code: ${error.code}`);
  return parts.join(" | ");
}

// اتصال سريع + تشخيص صلاحيات anon
export async function testSupabaseConnection(msgEl){
  try{
    const { error } = await supabase.from("items").select("id", { head: true, count: "exact" }).limit(1);
    if(error){
      const e = explainSupabaseError(error);
      setMsg(msgEl, `فشل الاتصال/الصلاحيات مع Supabase: ${e} — غالباً تحتاج GRANT للـ anon (شغّل SQL التصحيح).`, false);
      return false;
    }
    return true;
  }catch(ex){
    setMsg(msgEl, `تعذر الاتصال بـ Supabase: ${ex?.message || String(ex)}`, false);
    return false;
  }
}
