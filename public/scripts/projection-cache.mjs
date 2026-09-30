export function projectionParameters(params, projection) {
  const result = new URLSearchParams(params);
  if (projection) { result.set('projection', projection.key); result.set('projectionAt', String(projection.at)); }
  return result;
}

export function mergeSessionPage(dashboard, response) {
  if (!dashboard?.projection?.key || dashboard.projection.key !== response?.projection?.key) throw Object.assign(new Error('Projection conflict.'), { code: 'PROJECTION_CONFLICT' });
  return { ...dashboard, ...Object.fromEntries(['sessions', 'matchedSessionCount', 'offset', 'limit', 'hasPrevious', 'hasNext'].map((key) => [key, response[key]])) };
}

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
      if (value?.projection) for (const [storedKey, stored] of entries) {
        if (stored.projection?.provider === value.projection.provider && (stored.projection.epoch !== value.projection.epoch || stored.projection.snapshotVersion !== value.projection.snapshotVersion || stored.projection.pricingRevision !== value.projection.pricingRevision)) entries.delete(storedKey);
      }
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return value;
    },
    clear() { entries.clear(); },
  });
}
