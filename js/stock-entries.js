import { supabase } from "./supabaseClient.js";
export async function allRows(makeQuery) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await makeQuery().range(start, start + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
export async function saveEntry(request) {
  const { data, error } = await supabase.rpc("create_stock_entry", request);
  if (error) throw error;
  return data;
}
export async function changeEntry(group, action, line = null, values = null) {
  const { error } = await supabase.rpc("change_stock_entry", {
    p_group: group.id,
    p_revision: group.revision,
    p_action: action,
    p_line: line,
    p_values: values,
  });
  if (error) throw error;
}
export function entryError(error) {
  const m = error?.message || "";
  if (m.includes("ENTRY_CHANGED"))
    return "عدّل مستخدم آخر هذه المجموعة. أعد تحميلها وراجع أحدث البيانات قبل المحاولة.";
  if (m.includes("ENTRY_REQUEST_CONFLICT"))
    return "تعذرت إعادة استخدام طلب الحفظ. راجع السجل للتأكد من نتيجة المحاولة السابقة.";
  if (m.includes("INVALID_ENTRY"))
    return "تحقق من المواد والتواريخ والكميات. لم تُحفظ أي بنود من هذه المحاولة.";
  if (m.includes("ACCESS_DENIED") || m.includes("row-level security"))
    return "هذا الإجراء متاح للمستخدم المخوّل بتعديل المخزون فقط.";
  return "تعذرت العملية. تحقق من الاتصال وأعد المحاولة. " + m;
}
export function quantities(lines, type) {
  const units = {};
  let rolls = 0;
  for (const l of lines) {
    const u = l.items?.unit_type || l.unit_type || "other";
    units[u] =
      (units[u] || 0) +
      Number(
        l.qty_main ??
          (type === "purchase" ? l.qty_main_in : l.qty_main_out) ??
          0,
      );
    rolls += Number(
      l.qty_rolls ??
        (type === "purchase" ? l.qty_rolls_in : l.qty_rolls_out) ??
        0,
    );
  }
  return { units, rolls };
}
