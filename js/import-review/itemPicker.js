import { escapeHtml, formatItemFullLabel, getThumbnailImageUrl, unitLabel } from '../shared.js';

export function createItemPicker({ items, onSelect }) {
  const root = document.createElement('div');
  root.className = 'comboRow';
  root.innerHTML = `
    <div class="itemPreview"><div class="ph">لا صورة</div></div>
    <div class="combo">
      <input class="comboInput" type="text" role="combobox" aria-label="اختيار مادة" aria-expanded="false" aria-autocomplete="list" placeholder="ابحث عن مادة..." autocomplete="off" />
      <div class="comboPanel" role="listbox"></div>
      <small class="muted unitHint"></small>
      <small class="comboError" role="alert" hidden></small>
    </div>`;
  const input = root.querySelector('.comboInput'),
    panel = root.querySelector('.comboPanel');
  const preview = root.querySelector('.itemPreview'),
    hint = root.querySelector('.unitHint');
  const error = root.querySelector('.comboError');
  panel.id = `item-picker-${crypto.randomUUID()}`;
  input.setAttribute('aria-controls', panel.id);
  let busy = false;

  function show(open) {
    panel.style.display = open ? 'block' : 'none';
    input.setAttribute('aria-expanded', String(open));
  }

  function filter() {
    const text = input.value.trim().toLowerCase();
    return items
      .filter(
        (item) =>
          !text ||
          `${formatItemFullLabel(item)} ${unitLabel(item.unit_type)}`.toLowerCase().includes(text),
      )
      .slice(0, 80);
  }

  function render() {
    const list = filter();
    panel.innerHTML = list.length
      ? list
          .map(
            (item) => `
      <button type="button" class="comboItem" role="option" data-id="${escapeHtml(item.id)}">
        <span style="flex:1;min-width:0;">
          <span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(formatItemFullLabel(item))}</span>
          <small class="comboMeta">${escapeHtml(unitLabel(item.unit_type))}</small>
        </span>
      </button>`,
          )
          .join('')
      : '<div class="comboEmpty">لا نتائج</div>';
  }

  async function select(item) {
    if (busy) return;
    busy = true;
    input.disabled = true;
    error.hidden = true;
    show(false);
    input.value = formatItemFullLabel(item);
    hint.textContent = `وحدة الكمية الرئيسية: ${unitLabel(item.unit_type)}`;
    const url = getThumbnailImageUrl(item.image_path);
    preview.replaceChildren();
    if (url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = formatItemFullLabel(item);
      preview.append(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'ph';
      placeholder.textContent = 'لا صورة';
      preview.append(placeholder);
    }
    try {
      await onSelect?.(item);
    } catch (cause) {
      error.textContent = cause.message || 'تعذر حفظ اختيار المادة. أعد المحاولة.';
      error.hidden = false;
    } finally {
      busy = false;
      input.disabled = false;
    }
  }

  input.addEventListener('focus', () => {
    if (!busy) {
      render();
      show(true);
    }
  });
  input.addEventListener('input', () => {
    render();
    show(true);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      render();
      show(true);
      panel.querySelector('button')?.focus();
    }
    if (event.key === 'Escape') show(false);
  });
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-id]');
    const item = items.find((candidate) => candidate.id === button?.dataset.id);
    if (item) void select(item);
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      show(false);
      input.focus();
      show(false);
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      (event.key === 'ArrowDown'
        ? event.target.nextElementSibling
        : event.target.previousElementSibling
      )?.focus();
    }
  });
  // A local listener is released with this picker; opening pickers repeatedly
  // no longer retains detached DOM trees through document-level listeners.
  root.addEventListener('focusout', () =>
    setTimeout(() => {
      if (!root.contains(document.activeElement)) show(false);
    }, 0),
  );
  return root;
}
