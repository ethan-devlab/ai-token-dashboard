import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createSessionIndex } from './session-index.mjs';
import { createSummaryCache } from './summary-cache.mjs';

async function directoryAvailable(directory) {
  const value = await stat(directory).catch(() => null);
  return Boolean(value?.isDirectory());
}

function createProvider({ id, label, sessionsDirectory, pricingService, config }) {
  const index = createSessionIndex({ provider: id, sessionsDirectory, maxFiles: config.maxFiles, parseConcurrency: config.parseConcurrency, pricing: () => pricingService.current() });
  const cache = createSummaryCache(() => index.refresh());
  let watcher = null;
  let watcherTimer = null;
  let watcherStatus = config.autoRefresh ? 'starting' : 'disabled';

  async function availability() {
    const available = await directoryAvailable(sessionsDirectory);
    return { id, label, available, ...(available ? {} : { reason: 'sessions-directory-missing' }) };
  }

  async function startWatcher() {
    if (!config.autoRefresh) return;
    if (!(await directoryAvailable(sessionsDirectory))) { watcherStatus = 'unavailable'; return; }
    try {
      watcher = watch(sessionsDirectory, { recursive: true }, () => {
        if (!cache.initialized()) return;
        clearTimeout(watcherTimer);
        watcherTimer = setTimeout(() => cache.refresh().catch(() => undefined), config.autoRefreshDebounceMs);
      });
      watcher.on('error', () => { watcherStatus = 'failed'; });
      watcherStatus = 'watching';
    } catch {
      watcherStatus = 'failed';
    }
  }

  function close() {
    clearTimeout(watcherTimer);
    watcher?.close();
  }

  return Object.freeze({
    id,
    label,
    sessionsDirectory,
    pricingService,
    cache,
    availability,
    startWatcher,
    close,
    watcher: () => ({ enabled: config.autoRefresh, status: watcherStatus, debounceMs: config.autoRefreshDebounceMs }),
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
    close: () => providers.forEach((provider) => provider.close()),
    diagnostics: async () => Promise.all([...providers.values()].map(async (provider) => ({ ...(await provider.availability()), snapshot: provider.cache.status(), watcher: provider.watcher(), pricing: provider.pricingService.status() }))),
  });
}
