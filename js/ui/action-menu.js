/** A presentation-only row menu. Actions and permissions remain with the page. */
export function createActionMenu({
  root,
  onSelect,
  document = globalThis.document,
  window = globalThis.window,
}) {
  let current;
  const controls = () => [...current.menu.querySelectorAll('button:not(:disabled), a[href]')];

  function position() {
    if (!current) return;
    if (!current.trigger.isConnected) {
      close(false);
      return;
    }
    const anchor = current.trigger.getBoundingClientRect();
    const menu = current.menu.getBoundingClientRect();
    const edge = 12;
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    if (anchor.bottom < 0 || anchor.top > height || anchor.right < 0 || anchor.left > width) {
      close(false);
      return;
    }
    const left = Math.max(edge, Math.min(anchor.right - menu.width, width - menu.width - edge));
    const below = anchor.bottom + 6;
    const top =
      below + menu.height <= height - edge ? below : Math.max(edge, anchor.top - menu.height - 6);
    current.menu.style.inset = `${top}px auto auto ${left}px`;
  }
  function close(restoreFocus = true) {
    if (!current) return;
    const { menu, trigger, placeholder, native } = current;
    current = null;
    if (native && menu.matches(':popover-open')) menu.hidePopover();
    menu.removeAttribute('data-menu-open');
    menu.hidden = true;
    menu.style.removeProperty('inset');
    if (placeholder) {
      placeholder.replaceWith(menu);
    }
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function open(trigger, focusLast = false) {
    if (current?.trigger === trigger) {
      close();
      return;
    }
    close(false);
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!menu || !root.contains(menu)) return;
    const native = typeof menu.showPopover === 'function';
    const placeholder = native ? null : document.createComment('row actions');
    if (placeholder) {
      menu.replaceWith(placeholder);
      document.body.append(menu);
    }
    current = { trigger, menu, native, placeholder };
    menu.hidden = false;
    if (native) menu.showPopover();
    else menu.setAttribute('data-menu-open', '');
    trigger.setAttribute('aria-expanded', 'true');
    position();
    const items = controls();
    (focusLast ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }
  function click(event) {
    const trigger = event.target.closest('[data-action-menu]');
    if (trigger && root.contains(trigger)) {
      open(trigger);
      return;
    }
    if (!current) return;
    const selected = event.target.closest('[role="menuitem"]');
    if (selected && current.menu.contains(selected)) {
      if (selected.disabled) return;
      close();
      onSelect(selected);
    } else if (!current.menu.contains(event.target)) close(false);
  }
  function keydown(event) {
    const trigger = event.target.closest('[data-action-menu]');
    if (
      !current &&
      trigger &&
      root.contains(trigger) &&
      ['ArrowDown', 'ArrowUp'].includes(event.key)
    ) {
      event.preventDefault();
      open(trigger, event.key === 'ArrowUp');
      return;
    }
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = controls();
      const index = items.indexOf(document.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }
  document.addEventListener('click', click);
  document.addEventListener('keydown', keydown);
  window.addEventListener('resize', position);
  // Follow scrolling anchors; a queued scroll from tapping an offscreen row must not dismiss the menu.
  function scroll(event) {
    if (current && !current.menu.contains(event.target)) position();
  }
  document.addEventListener('scroll', scroll, true);
  return {
    close,
    destroy() {
      close(false);
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
    },
  };
}
