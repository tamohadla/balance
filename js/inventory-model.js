import { recordPurchase } from './purchase-sort.js';
export const STOCK_FILTERS = [
  'all',
  'has_orders',
  'positive_rolls',
  'zero_rolls',
  'low_stock',
  'negative',
  'shortage',
  'inactive_stock',
  'idle_30',
  'idle_60',
  'idle_90',
];
export function stockMatches(row, filter, threshold = 10) {
  const rolls = Number(row.balance_rolls) || 0;
  if (filter === 'inactive_stock')
    return !row.is_active && (rolls > 0 || Number(row.balance_main) > 0);
  if (/^idle_(30|60|90)$/.test(filter)) {
    const stamp = row.last_move_date || String(row.created_at || '').slice(0, 10);
    const elapsed = (Date.now() - new Date(stamp + 'T00:00:00').getTime()) / 86400000;
    return (rolls > 0 || Number(row.balance_main) > 0) && elapsed >= Number(filter.split('_')[1]);
  }
  if (filter === 'has_orders') return row.preorder_total_rolls > 0;
  if (filter === 'positive_rolls') return rolls > 0;
  if (filter === 'zero_rolls') return rolls === 0;
  if (filter === 'low_stock') return rolls > 0 && rolls < threshold;
  if (filter === 'negative') return rolls < 0 || row.balance_main < -0.000001;
  if (filter === 'shortage') return row.preorder_total_rolls > 0 && row.balance_after_orders < 0;
  return true;
}
export function buildStock(items, moves, lines) {
  const map = new Map(
    items.map((i) => [i.id, { ...i, balance_main: 0, balance_rolls: 0, preorder_total_rolls: 0 }]),
  );
  for (const m of moves) {
    const r = map.get(m.item_id);
    if (r) {
      recordPurchase(r, m);
      if (m.move_date && (!r.last_move_date || m.move_date > r.last_move_date))
        r.last_move_date = m.move_date;
      r.balance_main += Number(m.qty_main_in || 0) - Number(m.qty_main_out || 0);
      r.balance_rolls += Number(m.qty_rolls_in || 0) - Number(m.qty_rolls_out || 0);
    }
  }
  for (const l of lines) {
    const o = Array.isArray(l.customer_orders) ? l.customer_orders[0] : l.customer_orders;
    if (!o || !['draft', 'confirmed', 'pending_sale'].includes(o.status)) continue;
    const r = map.get(l.item_id);
    if (r) r.preorder_total_rolls += Number(l.qty_rolls || 0);
  }
  return [...map.values()].map((r) => ({
    ...r,
    balance_main: Math.round(r.balance_main * 1000) / 1000,
    balance_after_orders: r.balance_rolls - r.preorder_total_rolls,
  }));
}
export function stockTotals(rows) {
  return rows.reduce(
    (t, r) => {
      t.items++;
      t.rolls += r.balance_rolls;
      t.reserved += r.preorder_total_rolls;
      t[r.unit_type === 'kg' ? 'kg' : r.unit_type === 'm' ? 'm' : 'other'] += r.balance_main;
      return t;
    },
    { items: 0, rolls: 0, reserved: 0, kg: 0, m: 0, other: 0 },
  );
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
