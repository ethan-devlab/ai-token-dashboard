function scanMetadata(snapshot, refreshing) {
  return {
    scannedAt: snapshot.scannedAt,
    snapshotVersion: snapshot.version,
    refreshing,
  };
}

export function createSummaryCache(loader, now = () => new Date()) {
  let snapshot = null;
  let refreshPromise = null;
  let version = 0;

  async function refresh() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      const summary = await loader();
      const nextSnapshot = {
        summary,
        scannedAt: now().toISOString(),
        version: version + 1,
      };
      snapshot = nextSnapshot;
      version = nextSnapshot.version;
      return nextSnapshot;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function get() {
    if (!snapshot) await refresh();
    return {
      summary: snapshot.summary,
      metadata: scanMetadata(snapshot, Boolean(refreshPromise)),
    };
  }

  return Object.freeze({
    get,
    refresh,
    status: () => snapshot ? scanMetadata(snapshot, Boolean(refreshPromise)) : {
      scannedAt: null,
      snapshotVersion: 0,
      refreshing: Boolean(refreshPromise),
    },
  });
}
