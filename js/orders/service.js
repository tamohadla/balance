import { readAllRows } from '../core/pagination.js';
export const ORDER_FIELDS =
  'id, created_at, customer_name, customer_phone, status, note, sales_group_id';
export const ITEM_FIELDS =
  'id, main_category, sub_category, item_name, color_code, color_name, image_path, is_active';

export function createOrderService(supabase) {
  const itemCache = new Map();
  async function itemsByIds(ids) {
    const missing = [...new Set(ids.map(String))].filter((id) => !itemCache.has(id));
    for (let i = 0; i < missing.length; i += 150) {
      const chunk = missing.slice(i, i + 150);
      const { data, error } = await supabase.from('items').select(ITEM_FIELDS).in('id', chunk);
      if (error) throw error;
      for (const id of chunk) itemCache.set(id, null);
      for (const it of data || []) itemCache.set(String(it.id), it);
    }
    return new Map(ids.map((id) => [String(id), itemCache.get(String(id))]));
  }
  function fetchAllOrders() {
    return readAllRows(() =>
      supabase
        .from('customer_orders')
        .select(`${ORDER_FIELDS}, customer_order_lines(item_id, qty_rolls)`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }),
    );
  }
  function fetchLines(id) {
    return readAllRows(() =>
      supabase
        .from('customer_order_lines')
        .select('id, item_id, qty_rolls')
        .eq('order_id', id)
        .order('id'),
    );
  }
  async function freshOrder(id) {
    const { data, error } = await supabase
      .from('customer_orders')
      .select(ORDER_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('الطلب غير موجود أو لم يعد متاحًا.');
    return data;
  }
  function matchStatus(query, order) {
    return order.status == null ? query.is('status', null) : query.eq('status', order.status);
  }
  async function mutate(order, values, remove = false) {
    let query = remove
      ? supabase.from('customer_orders').delete()
      : supabase.from('customer_orders').update(values);
    query = matchStatus(query.eq('id', order.id), order);
    if (values?.customer_name !== undefined) {
      for (const field of ['customer_name', 'customer_phone', 'note'])
        query = order[field] == null ? query.is(field, null) : query.eq(field, order[field]);
    }
    const { data, error } = await query.select(ORDER_FIELDS).maybeSingle();
    if (error) throw error;
    if (!data)
      throw new Error(
        'تغيّر الطلب بواسطة مستخدم آخر أو لا تملك صلاحية تعديله. أغلق التفاصيل وافتح الطلب مجددًا.',
      );
    return data;
  }
  function fetchActiveItems() {
    return readAllRows(() =>
      supabase.from('items').select(ITEM_FIELDS).eq('is_active', true).order('id'),
    );
  }
  async function updateLines(orderId, expected, lines) {
    const { error } = await supabase.rpc('update_order_lines', {
      p_order_id: orderId,
      p_expected: expected,
      p_lines: lines,
    });
    if (error) throw error;
  }
  return {
    itemCache,
    itemsByIds,
    fetchAllOrders,
    fetchLines,
    freshOrder,
    mutate,
    fetchActiveItems,
    updateLines,
  };
}
