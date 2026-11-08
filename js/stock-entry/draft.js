/** Capture raw field values so incomplete quantities stay blank, never zero. */
export function snapshotStockEntryDraft({ date, note, prefill, rows }) {
  return {
    version: 1,
    date,
    note,
    prefill,
    lines: [...rows].map((row) => ({
      item_id: row.dataset.item || null,
      search: row.querySelector('.itemSearch').value,
      qty_main: row.querySelector('.qtyMain').value,
      qty_rolls: row.querySelector('.qtyRolls').value,
      note: row.querySelector('.lineNote').value,
    })),
  };
}

/**
 * Local draft lifecycle. Storage, DOM and page state are explicit dependencies;
 * importing this module never starts authentication or touches browser globals.
 */
export function createStockEntryDraft({
  $,
  storage,
  key,
  getState,
  document,
  eventTarget,
  todayISO,
  clearPrefill,
  setPrefill,
  prefillKey,
  addRow,
  lock,
  ready = false,
}) {
  let status;
  const statusElement = () => status || $('draftStatus');

  function snapshot() {
    return snapshotStockEntryDraft({
      date: $('move_date').value,
      note: $('groupNote').value,
      prefill: getState().prefill,
      rows: $('rows').children,
    });
  }

  function persist() {
    const state = getState();
    if (!ready || state.busy || state.pending || !state.admin) return;
    const draft = snapshot();
    try {
      if (
        draft.prefill ||
        draft.note ||
        draft.lines.some(
          (line) => line.item_id || line.search || line.qty_main || line.qty_rolls || line.note,
        )
      ) {
        storage.setItem(key, JSON.stringify(draft));
        statusElement().textContent = 'تم حفظ المسودة على هذا الجهاز.';
      } else {
        storage.removeItem(key);
        statusElement().textContent = '';
      }
    } catch {
      statusElement().textContent =
        'تعذر حفظ المسودة على هذا الجهاز. لا تغلق الصفحة قبل حفظ العملية.';
    }
  }

  function mount() {
    const bar = document.createElement('div');
    bar.className = 'card';
    bar.hidden = true;
    const text = document.createElement('p');
    text.textContent = 'لديك مسودة سابقة. استكملها أو تجاهلها لمتابعة إدخال جديد.';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'secondary';
    restore.textContent = 'استكمال المسودة';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'secondary';
    discard.textContent = 'تجاهل المسودة';
    status = document.createElement('p');
    status.id = 'draftStatus';
    status.className = 'helper';
    status.setAttribute('role', 'status');
    // Keep notices outside the form/summary grid to preserve both columns.
    bar.append(text, restore, discard);
    $('moveForm').closest('.entry-layout').before(bar, status);
    $('moveForm').addEventListener('input', persist);
    eventTarget.addEventListener('pagehide', persist);

    let saved;
    try {
      saved = JSON.parse(storage.getItem(key) || 'null');
    } catch {
      status.textContent = 'تعذر قراءة المسودة المحفوظة.';
    }
    const state = getState();
    if (!state.admin || state.pending || !saved?.lines?.length) {
      ready = true;
      persist();
      return;
    }
    bar.hidden = false;
    for (const id of ['entryFields', 'saveEntry', 'btnCancel', 'btnBulkImport']) {
      $(id).disabled = true;
    }
    function unlock() {
      bar.hidden = true;
      ready = true;
      lock(false);
      persist();
    }
    restore.onclick = () => {
      try {
        ready = false;
        clearPrefill();
        const prefill = saved.prefill || null;
        setPrefill(prefill);
        if (prefill) storage.setItem(prefillKey, JSON.stringify(prefill));
        $('move_date').value = saved.date || todayISO();
        $('groupNote').value = saved.note || '';
        $('rows').replaceChildren();
        saved.lines.forEach(addRow);
        $('orderPrefillNotice').hidden = !prefill;
        if (prefill) {
          $('orderPrefillNotice').textContent =
            'مسودة مبيعات مرتبطة بطلب: ' + (prefill.customer_name || '');
        }
        unlock();
      } catch {
        status.textContent = 'تعذرت استعادة المسودة. جرّب مجددًا.';
        ready = false;
      }
    };
    discard.onclick = () => {
      try {
        storage.removeItem(key);
        unlock();
      } catch {
        status.textContent = 'تعذر حذف المسودة من المتصفح.';
      }
    };
  }

  return { snapshot, persist, mount };
}
