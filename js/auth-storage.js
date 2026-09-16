// Store session tokens, never passwords. The default keeps existing logins working.
export function createSessionStorage(local, tab) {
  const preferenceKey = 'balance.auth.persistence';
  return {
    remember(value) { tab.setItem(preferenceKey, value ? 'local' : 'tab'); },
    getItem(key) { return tab.getItem(key) ?? local.getItem(key); },
    setItem(key, value) {
      const temporary = tab.getItem(preferenceKey) === 'tab';
      const target = temporary ? tab : local;
      const other = temporary ? local : tab;
      target.setItem(key, value);
      other.removeItem(key);
    },
    removeItem(key) { tab.removeItem(key); local.removeItem(key); }
  };
}

