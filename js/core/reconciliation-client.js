// Transport and persistence are injected so recovery behavior is testable without browser or auth setup.
export function createReconciliationClient({
  userId,
  scope,
  storage,
  rpc,
  uuid = () => globalThis.crypto.randomUUID(),
}) {
  const key = 'reconciliation-pending:' + userId + ':' + scope;
  let busy = false;
  function pending() {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : null;
  }
  async function send(request) {
    if (busy) throw new Error('جارٍ اعتماد التسوية بالفعل.');
    busy = true;
    try {
      const { data, error } = await rpc(request);
      if (error) throw error;
      if (data !== request.p_id)
        throw new Error('لم نتأكد من نتيجة الحفظ. استخدم استكمال التسوية.');
      storage.removeItem(key);
      return data;
    } catch (error) {
      if (
        /RECON_STOCK_CHANGED|INVALID_RECON|RECON_ACCESS_DENIED/.test(error?.message || '') ||
        ['22P02', '22003', '23503', '23514', '42501'].includes(error?.code)
      )
        storage.removeItem(key);
      throw error;
    } finally {
      busy = false;
    }
  }
  return {
    pending,
    async save(date, lines) {
      const request = { p_date: date, p_lines: lines };
      const previous = pending();
      if (
        previous &&
        (previous.p_date !== date || JSON.stringify(previous.p_lines) !== JSON.stringify(lines))
      )
        throw new Error('توجد محاولة تسوية سابقة لم تُحسم. اضغط استكمال التسوية أولًا.');
      const saved = previous || { p_id: uuid(), ...request };
      storage.setItem(key, JSON.stringify(saved));
      return send(saved);
    },
    async recover() {
      const saved = pending();
      if (!saved) throw new Error('لا توجد تسوية معلقة.');
      return send(saved);
    },
  };
}
