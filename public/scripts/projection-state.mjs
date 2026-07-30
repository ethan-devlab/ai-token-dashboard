export function projectionLoadState({ hasData, cached, refresh }) {
  return Object.freeze({
    projectionStale: Boolean(hasData && !refresh && !cached),
    status: refresh && hasData ? 'refreshing' : cached ? 'ready' : 'loading',
  });
}
