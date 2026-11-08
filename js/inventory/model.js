import { comparePurchases } from '../purchase-sort.js';
import { stockMatches } from '../inventory-model.js';

/** Return a new array; filtering/sorting must not mutate the loaded snapshot. */
export function selectInventoryRows(rows, filters, materialLabel = () => '') {
  const search = String(filters.search || '')
    .trim()
    .toLowerCase();
  const selected = rows.filter((row) => {
    if (filters.scope === 'active' && !row.is_active) return false;
    if (filters.scope === 'inactive' && row.is_active) return false;
    if (filters.unit && row.unit_type !== filters.unit) return false;
    if (filters.item && row.id !== filters.item) return false;
    if (filters.main && (row.main_category || '').trim() !== filters.main) return false;
    if (filters.sub && (row.sub_category || '').trim() !== filters.sub) return false;
    if (!stockMatches(row, filters.quickFilter, filters.threshold)) return false;
    if (!search) return true;
    return [
      row.main_category,
      row.sub_category,
      row.item_name,
      row.color_code,
      row.color_name,
      row.description,
      row.unit_type,
      materialLabel(row),
      row.balance_main ?? '',
      row.balance_rolls ?? '',
      row.preorder_total_rolls ?? '',
      row.image_path || '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(search);
  });
  return sortInventoryRows(selected, filters.preset);
}

export function categoryOptions(rows, main = '') {
  const values = (field, input) =>
    [...new Set(input.map((row) => (row[field] || '').trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ar'),
    );
  return {
    mains: values('main_category', rows),
    subs: values(
      'sub_category',
      rows.filter((row) => !main || (row.main_category || '').trim() === main),
    ),
  };
}

/** Sort a copy so consumers can render a cumulative balance newest-first. */
export function sortItemMoves(moves) {
  return [...moves].sort(
    (a, b) =>
      String(b.move_date).localeCompare(String(a.move_date)) ||
      String(b.created_at).localeCompare(String(a.created_at)) ||
      String(b.id).localeCompare(String(a.id)),
  );
}

export function sortInventoryRows(input, preset) {
  const rows = [...input];
  if (['purchase_newest', 'purchase_oldest'].includes(preset)) {
    rows.sort((a, b) => comparePurchases(a, b, preset));
    return rows;
  }
  const byText = (a, b) => (a || '').localeCompare(b || '', 'ar');
  const byNum = (a, b) => (a ?? 0) - (b ?? 0);

  if (preset === 'default') {
    rows.sort(
      (x, y) =>
        byText(x.main_category, y.main_category) ||
        byText(x.sub_category, y.sub_category) ||
        byText(x.item_name, y.item_name) ||
        byText(x.color_code, y.color_code),
    );
    return rows;
  }

  if (preset === 'most_qty_in_item') {
    rows.sort(
      (x, y) =>
        byText(x.main_category, y.main_category) ||
        byText(x.sub_category, y.sub_category) ||
        byText(x.item_name, y.item_name) ||
        byNum(y.balance_main, x.balance_main) ||
        byText(x.color_code, y.color_code),
    );
    return rows;
  }

  if (preset === 'most_rolls') {
    rows.sort((x, y) => (y.balance_rolls ?? 0) - (x.balance_rolls ?? 0));
  }
  return rows;
}

export function buildPreordersState(lines) {
  const summary = new Map();
  const detailsMap = new Map();

  for (const l of lines) {
    const itemId = String(l.item_id);
    const order = Array.isArray(l.customer_orders) ? l.customer_orders[0] : l.customer_orders;
    const entry = summary.get(itemId) || {
      totalRolls: 0,
      count: 0,
      orderIds: new Set(),
    };

    entry.totalRolls += Number(l.qty_rolls || 0);
    if (order?.id && !entry.orderIds.has(order.id)) {
      entry.orderIds.add(order.id);
      entry.count += 1;
    }
    summary.set(itemId, entry);

    const rows = detailsMap.get(itemId) || [];
    rows.push({
      order_id: order?.id,
      created_at: order?.created_at,
      customer_name: order?.customer_name,
      status: order?.status,
      note: order?.note,
      qty_rolls: Number(l.qty_rolls || 0),
    });
    detailsMap.set(itemId, rows);
  }

  const preordersByItem = new Map(
    Array.from(summary.entries()).map(([id, val]) => [
      id,
      { totalRolls: val.totalRolls, count: val.count },
    ]),
  );
  const preorderDetailsByItem = new Map(
    Array.from(detailsMap.entries()).map(([id, rows]) => [
      id,
      rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    ]),
  );
  return { preordersByItem, preorderDetailsByItem };
}
