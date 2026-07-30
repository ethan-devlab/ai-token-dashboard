export function createProjectionCache(limit = 12) {
  const entries = new Map();
  return Object.freeze({
    get(key) {
      if (!entries.has(key)) return null;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return value;
    },
    clear() { entries.clear(); },
  });
}
