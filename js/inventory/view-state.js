/** Restore navigation state without depending on window or a storage global. */
export function restoreInventoryView(href, storage, key) {
  let saved;
  try {
    saved = JSON.parse(storage.getItem(key) || 'null');
  } catch {
    /* Storage is optional. */
  }
  const url = new URL(href);
  if (!url.search && typeof saved?.query === 'string' && saved.query.startsWith('?')) {
    url.search = saved.query;
  }
  const scroll = Number(saved?.scroll);
  return {
    url,
    scroll: saved?.query === url.search && Number.isFinite(scroll) && scroll > 0 ? scroll : 0,
  };
}

export function persistInventoryView(storage, key, query, scroll) {
  try {
    storage.setItem(key, JSON.stringify({ query, scroll }));
    return true;
  } catch {
    return false;
  }
}

export function inventoryViewUrl(href, filters) {
  const url = new URL(href);
  for (const [param, field] of Object.entries({
    unit: 'unit',
    scope: 'scope',
    filter: 'quickFilter',
    threshold: 'threshold',
    search: 'search',
    main: 'main',
    sub: 'sub',
    sort: 'preset',
  }))
    url.searchParams.set(param, filters[field] ?? '');
  return url;
}
