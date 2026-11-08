import { readAllRows } from '../core/pagination.js';

/** Combine catalog summaries with pending quantities without mutating responses. */
export function catalogFromSummaries(materials, pendingLines) {
  const map = new Map(
    materials.map((item) => [
      item.id,
      {
        ...item,
        main_category: item.main_category?.trim() || 'غير مصنف',
        sub_category: item.sub_category?.trim() || '',
        balance_rolls: Number(item.balance_rolls || 0),
        pending_rolls: 0,
      },
    ]),
  );
  for (const line of pendingLines) {
    const item = map.get(line.item_id);
    if (item) item.pending_rolls += Number(line.qty_rolls || 0);
  }
  return map;
}

export function createCatalogService(supabase) {
  async function loadCatalog() {
    const [materials, pending] = await Promise.all([
      readAllRows(() =>
        supabase
          .from('inventory_balances')
          .select(
            'id, main_category, sub_category, item_name, color_code, color_name, image_path, is_active, balance_rolls, last_purchase_date, last_purchase_key',
          )
          .order('id'),
      ),
      readAllRows(() =>
        supabase
          .from('customer_order_lines')
          .select('id, item_id, qty_rolls, customer_orders!inner(status)')
          .in('customer_orders.status', ['draft', 'confirmed', 'pending_sale'])
          .order('id'),
      ),
    ]);
    return catalogFromSummaries(materials, pending);
  }
  return { loadCatalog };
}
