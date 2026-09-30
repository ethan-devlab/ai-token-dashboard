export function projectionLoadState({ hasData, cached, refresh }) {
  return Object.freeze({
    projectionStale: Boolean(hasData && !refresh && !cached),
    status: refresh && hasData ? 'refreshing' : cached ? 'ready' : 'loading',
  });
}

export function emptyExplorerKey(query, scan = {}, providerAvailable = true) {
  if (!providerAvailable) return 'provider.unavailable';
  if (query?.search || Object.values(query?.filters || {}).some((values) => values.length)) return 'explorer.noMatches';
  const counts = ['added', 'changed', 'reused', 'failed'].map((key) => scan[key]);
  if (counts.every((value) => Number.isFinite(value) && value === 0)) return 'explorer.noSessions';
  return 'explorer.noRange';
}
