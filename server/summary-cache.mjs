function scanMetadata(snapshot, refreshing, lastFailure) {
  return { scannedAt: snapshot?.scannedAt || null, snapshotVersion: snapshot?.version || 0, refreshing, ...(snapshot?.summary.scan || {}), refreshFailure: lastFailure, retainedSnapshot: Boolean(snapshot && lastFailure) };
}
export function createSummaryCache(loader, now = () => new Date()) {
  let snapshot = null; let refreshPromise = null; let version = 0;
  let generation = 0; let lastFailure = null; let closed = false;
  function failure(reason) { const error = new Error('Session refresh failed; the previous snapshot was retained.'); Object.assign(error, { code: 'SESSION_REFRESH_FAILED', status: 503, reason }); return error; }
  async function refresh() {
    if (closed) throw failure('closed');
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const target = generation;
          let transaction;
          try { transaction = await loader(); }
          catch (error) {
            if (error.reason === 'files-changed' && attempt < 2 && !closed) continue;
            throw error;
          }
          if (closed) throw failure('closed');
          if (target !== generation) { if (attempt < 2) continue; throw failure('files-changing'); }
          const summary = typeof transaction?.commit === 'function' ? transaction.summary : transaction;
          const scannedAt = now().toISOString();
          transaction?.commit?.();
          snapshot = { summary, scannedAt, version: ++version }; lastFailure = null;
          return snapshot;
        }
      } catch (error) {
        const allowed = new Set(['directory-unavailable', 'directory-read', 'files-changed', 'files-changing', 'file-parse', 'worker-failed', 'closed']);
        lastFailure = { code: 'SESSION_REFRESH_FAILED', reason: allowed.has(error.reason) ? error.reason : 'refresh-failed', failedFiles: error.failedFiles || 0, checkedAt: now().toISOString() };
        if (error.code === 'SESSION_REFRESH_FAILED') { error.message = snapshot ? 'Session refresh failed; the previous snapshot was retained.' : 'Session refresh failed; no successful snapshot is available.'; error.refreshStatus = { ...lastFailure, retainedSnapshot: Boolean(snapshot) }; }
        throw error;
      }
    })();
    try { return await refreshPromise; }
    finally { refreshPromise = null; }
  }
  async function get() {
    if (!snapshot) await refresh();
    return { summary: snapshot.summary, metadata: scanMetadata(snapshot, Boolean(refreshPromise), lastFailure) };
  }
  return Object.freeze({
    get, refresh,
    invalidate: () => { if (!closed) generation += 1; },
    close: () => { closed = true; },
    initialized: () => Boolean(snapshot),
    status: () => scanMetadata(snapshot, Boolean(refreshPromise), lastFailure),
  });
}
