import { ITEM_FIELDS, itemPayload } from './model.js';

export function createItemEditor({ getElement, save, onSaved, onError }) {
  const modal = getElement('editItemModal');
  const form = getElement('editItemForm');
  let saving = false;

  function open(item) {
    if (!modal || !item || saving) return;
    getElement('editModalId').value = item.id;
    for (const field of ITEM_FIELDS) {
      getElement('edit_' + field).value = item[field] || (field === 'unit_type' ? 'kg' : '');
    }
    modal.style.display = 'flex';
  }

  function close() {
    if (!modal || saving) return;
    modal.style.display = 'none';
    form?.reset();
    getElement('editModalId').value = '';
  }

  async function submit(event) {
    event.preventDefault();
    const id = getElement('editModalId').value;
    if (!id || saving) return;
    const payload = itemPayload(
      Object.fromEntries(ITEM_FIELDS.map((field) => [field, getElement('edit_' + field).value])),
    );
    const buttons = [...form.querySelectorAll('[type="submit"]')].map((button) => [
      button,
      button.disabled,
    ]);
    saving = true;
    for (const [button] of buttons) button.disabled = true;
    try {
      const item = await save(payload, id);
      await onSaved(item, id);
      saving = false;
      close();
    } catch (error) {
      onError(error);
    } finally {
      saving = false;
      for (const [button, disabled] of buttons) button.disabled = disabled;
    }
  }

  form?.addEventListener('submit', submit);
  getElement('editItemModalClose')?.addEventListener('click', close);
  getElement('editItemModalCancel')?.addEventListener('click', close);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  modal?.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.style.display === 'flex') close();
  });

  return { open, close };
}
