import { createReconciliationClient as createClient } from './core/reconciliation-client.js';
import { supabase } from './supabaseClient.js';
export function reconciliationError(error) {
  const message = error?.message || '';
  if (message.includes('RECON_STOCK_CHANGED'))
    return 'تغيّر الرصيد منذ تحميل الجرد. حدّث الأرصدة وراجع الكميات الفعلية ثم أعد الاعتماد.';
  if (message.includes('RECON_REQUEST_CONFLICT'))
    return 'تعارضت محاولة الحفظ. راجع سجل التسويات قبل المحاولة مجددًا.';
  if (message.includes('INVALID_RECON')) return 'راجع الكميات: الفعلي غير سالب، والأثواب عدد صحيح.';
  if (message.includes('RECON_ACCESS_DENIED')) return 'لا تملك صلاحية اعتماد التسويات.';
  return message || 'لم نتأكد من الحفظ. استخدم استكمال التسوية للتحقق دون تكرار.';
}
export function createReconciliationClient({
  storage = localStorage,
  rpc = (request) => supabase.rpc('save_reconciliation', request),
  ...options
}) {
  return createClient({ ...options, storage, rpc });
}
export function mountReconciliationRecovery(client, msg, afterSave) {
  const bar = document.createElement('div');
  bar.className = 'card';
  const text = document.createElement('span');
  text.textContent = 'توجد محاولة تسوية لم نتأكد من حفظها. ';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = 'استكمال التسوية';
  bar.append(text, button);
  msg.before(bar);
  function refresh() {
    try {
      bar.hidden = !client.pending();
    } catch {
      bar.hidden = true;
      msg.textContent = 'تعذر قراءة محاولة التسوية المحفوظة في المتصفح.';
    }
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      await client.recover();
      await afterSave();
      msg.textContent = 'تم التحقق من حفظ التسوية بنجاح.';
    } catch (e) {
      msg.textContent = reconciliationError(e);
    } finally {
      button.disabled = false;
      refresh();
    }
  };
  refresh();
  return refresh;
}
