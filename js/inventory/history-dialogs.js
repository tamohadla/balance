import { sortItemMoves } from './model.js';

/** Own the asynchronous history dialog lifetime; late responses cannot reopen it. */
export function createInventoryHistory({
  getRows,
  getOrderDetails,
  readItemMoves,
  $,
  view,
  materialLabel,
  onError,
}) {
  let movesVersion = 0;
  return {
    invalidateMoves() {
      movesVersion++;
    },
    async openMoves(itemId) {
      const row = getRows().find((item) => String(item.id) === String(itemId));
      if (!row) return;
      const version = ++movesVersion;
      $('movesTitle').textContent = 'حركة المادة: ' + materialLabel(row);
      $('movesTbody').innerHTML = '<tr><td colspan="6">جارٍ تحميل الحركة…</td></tr>';
      $('movesModal').style.display = 'flex';
      try {
        const moves = await readItemMoves(itemId);
        if (version !== movesVersion) return;
        $('movesTbody').innerHTML = view.movesHtml(sortItemMoves(moves), row.unit_type);
      } catch (error) {
        if (version !== movesVersion) return;
        $('movesTbody').innerHTML =
          '<tr><td colspan="6">تعذر تحميل الحركة. أغلق النافذة وأعد المحاولة.</td></tr>';
        onError(error);
      }
    },
    openOrders(itemId) {
      const row = getRows().find((item) => String(item.id) === String(itemId));
      if (!row) return;
      $('ordersTitle').textContent = 'طلبات المادة: ' + materialLabel(row);
      $('ordersTbody').innerHTML = view.ordersHtml(getOrderDetails().get(String(itemId)) || []);
      $('ordersModal').style.display = 'flex';
    },
  };
}
