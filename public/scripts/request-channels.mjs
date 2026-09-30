function errorMessage(payload, fallback) {
  if (payload && typeof payload === 'object' && typeof payload.error === 'object') return payload.error.message || payload.error.code || fallback;
  return payload?.error || fallback;
}

export function createRequestChannels(fetchImpl = fetch) {
  const channels = new Map();
  async function request(name, url, options = {}) {
    channels.get(name)?.abort();
    const controller = new AbortController(); channels.set(name, controller);
    try {
      const response = await fetchImpl(url, { cache: 'no-store', ...options, signal: controller.signal });
      const contentType = response.headers?.get?.('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : await response.blob();
      if (!response.ok) { const error = new Error(errorMessage(payload, `Request failed (${response.status})`)); error.code = payload?.error?.code; error.reason = payload?.error?.reason; error.failedFiles = payload?.error?.failedFiles; error.retainedSnapshot = payload?.error?.retainedSnapshot; throw error; }
      if (channels.get(name) !== controller) return { stale: true, payload: null, response };
      return { stale: false, payload, response };
    } finally {
      if (channels.get(name) === controller) channels.delete(name);
    }
  }
  return { request, abort: (name) => channels.get(name)?.abort(), destroy: () => channels.forEach((controller) => controller.abort()) };
}
