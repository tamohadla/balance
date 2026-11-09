import { requireAccess } from './auth-guard.js';
import { createOrderService } from './orders/service.js';
import { orderDetails, sortOrderLines } from './orders/views.js';
import { getThumbnailImageUrl } from './shared.js';
import { supabase } from './supabaseClient.js';

await requireAccess();

const status = document.getElementById('previewStatus');
const id = new URLSearchParams(location.search).get('id');

if (!id) {
  status.textContent = 'لم يُحدد طلب للعرض.';
} else {
  const { freshOrder, fetchLines, itemsByIds } = createOrderService(supabase);
  try {
    const order = await freshOrder(id);
    const lines = await fetchLines(id);
    const items = await itemsByIds(lines.map((line) => line.item_id));
    document.getElementById('orderPreview').innerHTML = orderDetails(
      order,
      sortOrderLines(lines, items),
      items,
      getThumbnailImageUrl,
      { customerView: true },
    );
    status.hidden = true;
  } catch {
    status.textContent = 'تعذر عرض الطلب. تحقق من الاتصال ومن صلاحية عرض هذا الطلب.';
  }
}
