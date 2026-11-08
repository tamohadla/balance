import { supabase } from './supabaseClient.js';
export { readAllRows as allRows } from './core/pagination.js';
export async function saveEntry(request) {
  const { data, error } = await supabase.rpc('create_stock_entry', request);
  if (error) throw error;
  return data;
}
export async function changeEntry(group, action, line = null, values = null) {
  const { error } = await supabase.rpc('change_stock_entry', {
    p_group: group.id,
    p_revision: group.revision,
    p_action: action,
    p_line: line,
    p_values: values,
  });
  if (error) throw error;
}
export function entryError(error) {
  const m = error?.message || '';
  if (m.includes('ORDER_ALREADY_SOLD'))
    return 'هذا الطلب منفذ بالفعل. راجع الطلب والمبيعات المرتبطة به قبل تسجيل بيع آخر.';
  if (m.includes('ORDER_ITEMS_CHANGED'))
    return 'أصناف المبيعات لا تطابق الطلب. أعد فتح الطلب وراجع بنوده.';
  if (m.includes('ORDER_NOT_FOUND')) return 'الطلب لم يعد متاحًا. راجع صفحة الطلبات.';
  if (m.includes('ORDER_ACCESS_DENIED')) return 'تنفيذ الطلب يتطلب صلاحية إدارة الطلبات والمبيعات.';
  if (m.includes('ENTRY_CHANGED'))
    return 'عدّل مستخدم آخر هذه المجموعة. أعد تحميلها وراجع أحدث البيانات قبل المحاولة.';
  if (m.includes('ENTRY_REQUEST_CONFLICT'))
    return 'تعذرت إعادة استخدام طلب الحفظ. راجع السجل للتأكد من نتيجة المحاولة السابقة.';
  if (m.includes('INVALID_ENTRY'))
    return 'تحقق من المواد والتواريخ والكميات. لم تُحفظ أي بنود من هذه المحاولة.';
  if (m.includes('ACCESS_DENIED') || m.includes('row-level security'))
    return 'هذا الإجراء متاح للمستخدم المخوّل بتعديل المخزون فقط.';
  return 'تعذرت العملية. تحقق من الاتصال وأعد المحاولة. ' + m;
}
export function quantities(lines, type) {
  const units = {};
  let rolls = 0;
  for (const l of lines) {
    const u = l.items?.unit_type || l.unit_type || 'other';
    units[u] =
      (units[u] || 0) +
      Number(l.qty_main ?? (type === 'purchase' ? l.qty_main_in : l.qty_main_out) ?? 0);
    rolls += Number(l.qty_rolls ?? (type === 'purchase' ? l.qty_rolls_in : l.qty_rolls_out) ?? 0);
  }
  return { units, rolls };
}
