import { escapeHtml as esc, materialLabel } from '../core/text-utils.js';
import { statusOf } from '../orders-model.js';

export function mountOrderLineEditor({
  $,
  service,
  canWrite,
  getCurrent,
  getCurrentLines,
  getCurrentItems,
  getBusy,
  setBusy,
  friendly,
  openOrder,
  message,
  setDetailActions,
}) {
  let editLines = [],
    expectedLines = [],
    lineItems = [],
    editingOrderId = null;
  function drawEditableLines() {
    $('editableLines').innerHTML = editLines
      .map((l, index) => {
        const it =
          lineItems.find((i) => i.id === l.item_id) || getCurrentItems().get(String(l.item_id));
        return (
          '<div class="editable-order-line"><span>' +
          esc(
            it
              ? materialLabel(it) + ' / ' + it.color_code + ' ' + (it.color_name || '')
              : 'مادة غير متاحة',
          ) +
          '</span><label>أثواب<input aria-label="عدد الأثواب" data-line="' +
          index +
          '" type="number" required min="1" max="100000" step="1" value="' +
          l.qty_rolls +
          '"></label><button class="o-button" type="button" data-remove="' +
          index +
          '">حذف</button></div>'
        );
      })
      .join('');
    updateLinesTotal();
  }
  function updateLinesTotal() {
    $('linesTotal').textContent =
      editLines.length +
      ' صنف / ' +
      editLines.reduce((sum, l) => sum + (Number(l.qty_rolls) || 0), 0) +
      ' ثوب';
  }
  function drawLineChoices() {
    const query = $('lineSearch').value.trim().toLocaleLowerCase();
    const choices = lineItems
      .filter(
        (i) =>
          i.is_active &&
          !editLines.some((l) => l.item_id === i.id) &&
          [i.main_category, i.sub_category, i.item_name, i.color_code, i.color_name]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query),
      )
      .slice(0, 100);
    $('lineMaterial').innerHTML =
      '<option value="">اختر مادة (ابحث لتضييق النتائج)</option>' +
      choices
        .map(
          (i) =>
            '<option value="' +
            esc(i.id) +
            '">' +
            esc(materialLabel(i) + ' / ' + i.color_code + ' ' + (i.color_name || '')) +
            '</option>',
        )
        .join('');
  }
  $('btnEditLines').onclick = async () => {
    if (
      !canWrite ||
      getBusy() ||
      !getCurrent() ||
      !['draft', 'confirmed'].includes(statusOf(getCurrent()))
    )
      return;
    editingOrderId = getCurrent().id;
    expectedLines = getCurrentLines().map((l) => ({ item_id: l.item_id, qty_rolls: l.qty_rolls }));
    editLines = expectedLines.map((l) => ({ ...l }));
    $('linesMsg').textContent = 'تحميل المواد…';
    $('saveLines').disabled = true;
    $('lineSearch').value = '';
    lineItems = [];
    drawLineChoices();
    drawEditableLines();
    $('linesDialog').showModal();
    try {
      lineItems = await service.fetchActiveItems();
      drawLineChoices();
      drawEditableLines();
      $('linesMsg').textContent = '';
      $('saveLines').disabled = false;
    } catch (e) {
      $('linesMsg').textContent = friendly(e);
    }
  };
  $('lineSearch').oninput = drawLineChoices;
  $('addLine').onclick = () => {
    const id = $('lineMaterial').value;
    if (getBusy() || !id || editLines.some((l) => l.item_id === id)) return;
    editLines.push({ item_id: id, qty_rolls: 1 });
    drawEditableLines();
    drawLineChoices();
  };
  $('editableLines').oninput = (e) => {
    if (e.target.dataset.line === undefined) return;
    editLines[Number(e.target.dataset.line)].qty_rolls = Number(e.target.value);
    updateLinesTotal();
  };
  $('editableLines').onclick = (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b || getBusy()) return;
    editLines.splice(Number(b.dataset.remove), 1);
    drawEditableLines();
    drawLineChoices();
  };
  $('cancelLines').onclick = () => {
    if (!getBusy()) $('linesDialog').close();
  };
  $('linesDialog').addEventListener('cancel', (e) => {
    if (getBusy()) e.preventDefault();
  });
  $('linesForm').onsubmit = async (e) => {
    e.preventDefault();
    if (getBusy()) return;
    if (
      !editLines.length ||
      editLines.some(
        (l) => !Number.isInteger(l.qty_rolls) || l.qty_rolls < 1 || l.qty_rolls > 100000,
      )
    ) {
      $('linesMsg').textContent = 'أضف مادة واحدة على الأقل وأدخل عدداً صحيحاً موجباً للأثواب.';
      return;
    }
    setBusy(true);
    for (const el of $('linesForm').querySelectorAll('input,select,button')) el.disabled = true;
    try {
      await service.updateLines(editingOrderId, expectedLines, editLines);
      $('linesDialog').close();
      await openOrder(editingOrderId);
      message('تم حفظ الأصناف والكميات.', false, 'detailMsg');
    } catch (error) {
      const code = error.message || '';
      $('linesMsg').textContent = code.includes('ORDER_LINES_CHANGED')
        ? 'تغيّرت الأصناف بواسطة مستخدم آخر. أغلق النافذة وافتح الطلب من جديد.'
        : code.includes('ORDER_NOT_EDITABLE')
          ? 'تم تحويل الطلب للمبيعات أو لم يعد متاحاً للتعديل.'
          : code.includes('INVALID_LINES')
            ? 'راجع المواد والكميات؛ قد تكون إحدى المواد موقوفة.'
            : friendly(error);
    } finally {
      setBusy(false);
      for (const el of $('linesForm').querySelectorAll('input,select,button')) el.disabled = false;
      setDetailActions(!!getCurrent());
    }
  };
}
