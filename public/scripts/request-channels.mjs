function errorMessage(payload, fallback) {
  if (payload && typeof payload === 'object' && typeof payload.error === 'object') return payload.error.message || payload.error.code || fallback;
  return payload?.error || fallback;
}

export function createRequestChannels(fetchImpl = fetch) {
  const channels = new Map();
  async function request(name, url, options = {}) {
    channels.get(name)?.abort();
    const controller = new AbortController(); channels.set(name, controller);
    const superseded = () => channels.get(name) !== controller || controller.signal.aborted;
    let response;
    try {
      const { responseType, ...fetchOptions } = options;
      response = await fetchImpl(url, { cache: 'no-store', ...fetchOptions, signal: controller.signal });
      if (superseded()) return { stale: true, payload: null, response };
      const contentType = response.headers?.get?.('content-type') || '';
      const payload = contentType.includes('application/json') && (!response.ok || responseType !== 'blob') ? await response.json() : await response.blob();
      if (superseded()) return { stale: true, payload: null, response };
      if (!response.ok) { const error = new Error(errorMessage(payload, `Request failed (${response.status})`)); error.code = payload?.error?.code; error.reason = payload?.error?.reason; error.failedFiles = payload?.error?.failedFiles; error.retainedSnapshot = payload?.error?.retainedSnapshot; throw error; }
      return { stale: false, payload, response };
    } catch (error) {
      // Fetch and body failures must obey the same ownership rule as HTTP responses.
      if (superseded()) return { stale: true, payload: null, response };
      throw error;
    } finally {
      if (channels.get(name) === controller) channels.delete(name);
    }
  }
  return { request, abort: (name) => { channels.get(name)?.abort(); channels.delete(name); }, destroy: () => { channels.forEach((controller) => controller.abort()); channels.clear(); } };
}
