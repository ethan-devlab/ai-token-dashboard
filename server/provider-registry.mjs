import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createSessionIndex } from './session-index.mjs';
import { createSummaryCache } from './summary-cache.mjs';

const WATCHER_RETRY_MS = 1000;
async function directoryState(directory) {
  const value = await stat(directory).catch(() => null);
  return value?.isDirectory() ? `${value.dev}:${value.ino}` : null;
}
function createProvider({ id, label, sessionsDirectory, pricingService, config }) {
  const index = createSessionIndex({ provider: id, sessionsDirectory, maxFiles: config.maxFiles, parseConcurrency: config.parseConcurrency, pricing: () => pricingService.current() });
  const cache = createSummaryCache(() => index.prepareRefresh());
  let watcher = null; let watcherTimer = null; let recoveryTimer = null; let startPromise = null;
  let rootIdentity = null; let closed = false; let watcherStarted = false;
  let watcherStatus = config.autoRefresh ? 'starting' : 'disabled';
  function scheduleRefresh() {
    if (closed || !cache.initialized()) return;
    clearTimeout(watcherTimer);
    watcherTimer = setTimeout(() => {
      watcherTimer = null;
      if (!closed) cache.refresh().catch((error) => {
        if (error.reason === 'files-changed' || error.reason === 'files-changing') scheduleRefresh();
      });
    }, config.autoRefreshDebounceMs);
    watcherTimer.unref?.();
  }
  function changed() { if (!closed) { cache.invalidate(); scheduleRefresh(); } }
  function detach() { const previous = watcher; watcher = null; rootIdentity = null; previous?.close(); }
  function scheduleRecovery() {
    if (closed || !config.autoRefresh || !watcherStarted || recoveryTimer) return;
    recoveryTimer = setTimeout(() => { recoveryTimer = null; startWatcher().catch(() => undefined); }, WATCHER_RETRY_MS);
    recoveryTimer.unref?.();
  }
  async function startWatcher() {
    if (closed || !config.autoRefresh) return;
    watcherStarted = true;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const identity = await directoryState(sessionsDirectory);
      if (closed) return;
      if (watcher && identity === rootIdentity) return;
      const rebinding = Boolean(rootIdentity || watcherStatus === 'unavailable' || watcherStatus === 'failed');
      detach();
      if (!identity) { watcherStatus = 'unavailable'; return; }
      try {
        const next = watch(sessionsDirectory, { recursive: true }, changed);
        watcher = next; rootIdentity = identity;
        next.on('error', () => { if (closed || watcher !== next) return; detach(); watcherStatus = 'failed'; changed(); scheduleRecovery(); });
        next.on('close', () => { if (closed || watcher !== next) return; watcher = null; rootIdentity = null; watcherStatus = 'failed'; scheduleRecovery(); });
        watcherStatus = 'watching';
        if (rebinding) changed();
      } catch { watcherStatus = 'failed'; }
    })();
    try { return await startPromise; }
    finally { startPromise = null; scheduleRecovery(); }
  }
  async function availability() {
    const available = Boolean(await directoryState(sessionsDirectory));
    if (watcherStarted && config.autoRefresh && !closed) await startWatcher();
    return { id, label, available, ...(available ? {} : { reason: 'sessions-directory-missing' }) };
  }
  function stopWatcher() {
    closed = true; watcherStatus = 'closed';
    clearTimeout(watcherTimer); clearTimeout(recoveryTimer); watcherTimer = null; recoveryTimer = null;
    detach();
  }
  async function close() {
    stopWatcher(); const refreshing = cache.close();
    await Promise.all([startPromise, refreshing, index.close()]);
  }
  return Object.freeze({
    id, label, sessionsDirectory, pricingService, cache, availability, startWatcher, stopWatcher, close,
    watcher: () => ({ enabled: config.autoRefresh, status: watcherStatus, debounceMs: config.autoRefreshDebounceMs, retryMs: config.autoRefresh ? WATCHER_RETRY_MS : null }),
  });
}
export function createProviderRegistry({ config, pricingServices }) {
  const providers = new Map([
    ['codex', createProvider({ id: 'codex', label: 'Codex', sessionsDirectory: config.codexSessionsDirectory, pricingService: pricingServices.codex, config })],
    ['claude', createProvider({ id: 'claude', label: 'Claude', sessionsDirectory: config.claudeSessionsDirectory, pricingService: pricingServices.claude, config })],
  ]);
  return Object.freeze({
    get: (id) => providers.get(id) || null,
    list: async () => ({ defaultProvider: 'codex', providers: await Promise.all([...providers.values()].map((provider) => provider.availability())) }),
    startWatchers: () => Promise.all([...providers.values()].map((provider) => provider.startWatcher())),
    stopWatchers: () => { for (const provider of providers.values()) provider.stopWatcher(); },
    close: () => Promise.all([...providers.values()].map((provider) => provider.close())),
    diagnostics: async () => Promise.all([...providers.values()].map(async (provider) => ({ ...(await provider.availability()), snapshot: provider.cache.status(), watcher: provider.watcher(), pricing: provider.pricingService.status() }))),
  });
}
