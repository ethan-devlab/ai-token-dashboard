import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import { buildDashboardPayload, buildExportPayload, buildSessionDetail, buildSessionsPayload } from './server/dashboard-data.mjs';
import { createExportPlan } from './server/export-format.mjs';
import { createExportService } from './server/export-service.mjs';
import { createAccountUsageService } from './server/account-usage.mjs';
import { createClaudePricingRefreshService } from './server/claude-pricing-refresh.mjs';
import { isLoopbackHost, readEnvFile, readRuntimeConfig } from './server/config.mjs';
import { validateRequest } from './server/request-policy.mjs';
import { CLAUDE_PRICING, PRICING } from './server/pricing.mjs';
import { createPricingRefreshService } from './server/pricing-refresh.mjs';
import { createProviderRegistry } from './server/provider-registry.mjs';
import { readSettings, saveSettings, settingsPayload } from './server/settings.mjs';
import { acquireSettingsOwner, unlockSettings } from './server/settings-owner.mjs';
import { acquirePricingOwner, unlockPricing } from './server/pricing-owner.mjs';
import { projectionIdentity, requireProjection } from './server/projection.mjs';
import { resolveRange } from './server/timezone.mjs';
import { createUpdateChecker } from './server/update-checker.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const ENV_PATH = path.join(APP_DIR, '.env');
const recoveryArguments = process.argv.slice(2);
if (recoveryArguments.some((argument) => argument.startsWith('--unlock-settings') || argument.startsWith('--unlock-pricing'))) {
  const pricingRecovery = recoveryArguments[0] === '--unlock-pricing';
  const label = pricingRecovery ? 'Pricing' : 'Settings';
  try {
    if (recoveryArguments.length !== 1 || !['--unlock-settings', '--unlock-pricing'].includes(recoveryArguments[0])) throw new Error('Invalid recovery command.');
    await (pricingRecovery ? unlockPricing(APP_DIR) : unlockSettings(ENV_PATH));
    console.log(`${label} ownership recovered. Restart the dashboard to acquire write access.`);
    process.exit(0);
  } catch (failure) {
    console.error(`${label} unlock refused: ${failure.reason || failure.code || 'unavailable'}. No force recovery is supported.`);
    process.exit(1);
  }
}
const localConfig = readEnvFile(ENV_PATH);
const CONFIG = readRuntimeConfig({ localConfig });
const require = createRequire(import.meta.url);
const { version: CURRENT_VERSION } = require('./package.json');
const pricingOwner = await acquirePricingOwner(APP_DIR);
const pricingServices = Object.freeze({
  codex: createPricingRefreshService({ baseline: PRICING, owner: pricingOwner, cachePath: path.join(APP_DIR, '.pricing-cache.json'), archiveDirectory: path.join(APP_DIR, '.pricing-archive', 'codex') }),
  claude: createClaudePricingRefreshService({ baseline: CLAUDE_PRICING, owner: pricingOwner, cachePath: path.join(APP_DIR, '.claude-pricing-cache.json'), archiveDirectory: path.join(APP_DIR, '.pricing-archive', 'claude') }),
});
await Promise.all(Object.values(pricingServices).map((service) => service.initialize()));
const providerRegistry = createProviderRegistry({ config: CONFIG, pricingServices });
const updateChecker = createUpdateChecker({ repository: CONFIG.updateRepository, currentVersion: CURRENT_VERSION });
const accountUsageService = createAccountUsageService();
const exportService = createExportService();
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const STATIC_TYPES = Object.freeze({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' });
const VALID_MODES = new Set(['all', 'last24h', 'today', 'week', 'month', 'year', 'custom']);
const VALID_SORTS = new Set(['recent', 'cost', 'total', 'input', 'cache', 'output']);
const VALID_EXPORTS = new Set(['csv-sessions', 'csv-trend', 'json-report', 'markdown-summary']);

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function requestId() { return randomUUID(); }
function parseInteger(value, name, fallback, maximum, minimum = 0) { if (value == null) return fallback; if (!/^\d+$/.test(value)) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); return parsed; }
function parseTimestamp(value, name) { if (value == null) return null; if (!/^-?\d+$/.test(value)) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); return parsed; }
function parseList(searchParams, name) { const values = searchParams.getAll(name).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean); if (values.length > 100 || values.some((value) => value.length > 128)) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); return [...new Set(values)]; }
function requestContext(requestUrl) {
  const mode = requestUrl.searchParams.get('mode') || 'all';
  if (!VALID_MODES.has(mode)) throw new ApiError(400, 'INVALID_QUERY', 'Invalid mode.');
  const fromMs = parseTimestamp(requestUrl.searchParams.get('from'), 'from');
  const toMs = parseTimestamp(requestUrl.searchParams.get('to'), 'to');
  const period = requestUrl.searchParams.get('period');
  const start = requestUrl.searchParams.get('start');
  const end = requestUrl.searchParams.get('end');
  if ((period != null && !/^\d{4}(?:-\d{1,2}|-W\d{2})?$/.test(period)) || (start != null && start.length > 32) || (end != null && end.length > 32) || (fromMs != null && toMs != null && fromMs >= toMs)) throw new ApiError(400, 'INVALID_RANGE', 'Invalid selected time range.');
  const q = requestUrl.searchParams.get('q') ?? requestUrl.searchParams.get('search') ?? '';
  if (q.length > 256) throw new ApiError(400, 'INVALID_QUERY', 'Search is too long.');
  const sort = requestUrl.searchParams.get('sort') || 'recent';
  if (!VALID_SORTS.has(sort)) throw new ApiError(400, 'INVALID_QUERY', 'Invalid sort.');
  let range;
  const projectionAt = requestUrl.searchParams.get('projectionAt');
  const nowMs = projectionAt == null ? Date.now() : parseTimestamp(projectionAt, 'projectionAt');
  if (Math.abs(nowMs) > 8.64e15) throw new ApiError(400, 'INVALID_QUERY', 'Invalid projection time.');
  try { range = resolveRange({ mode, fromMs, toMs, period, start, end, timezone: requestUrl.searchParams.get('timezone') || undefined, nowMs }); }
  catch (error) { if (error?.code === 'INVALID_TIMEZONE' || error?.code === 'INVALID_RANGE') throw new ApiError(400, error.code, error.message); throw error; }
  return { range, nowMs, q, sort, offset: parseInteger(requestUrl.searchParams.get('offset'), 'offset', 0, 1_000_000), limit: parseInteger(requestUrl.searchParams.get('limit'), 'limit', 100, 200, 1), filters: { models: parseList(requestUrl.searchParams, 'models'), workspaces: parseList(requestUrl.searchParams, 'workspaces'), pricingStatus: parseList(requestUrl.searchParams, 'pricingStatus'), usageSource: parseList(requestUrl.searchParams, 'usageSource'), cliVersion: parseList(requestUrl.searchParams, 'cliVersion'), originator: parseList(requestUrl.searchParams, 'originator'), executionType: parseList(requestUrl.searchParams, 'executionType'), quality: parseList(requestUrl.searchParams, 'quality') } };
}
function headers(contentType, length, csp, id, attachment = null) { return { 'Content-Type': contentType, 'Content-Length': length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp, 'X-Request-Id': id, ...(attachment ? { 'Content-Disposition': attachment } : {}) }; }
function json(res, status, value, id) { const body = JSON.stringify(value); res.writeHead(status, headers('application/json; charset=utf-8', Buffer.byteLength(body), API_CSP, id)); res.end(body); }
function exportHeaders(res, plan, id) {
  const metadata = plan.metadata;
  res.writeHead(200, { ...headers(plan.contentType, plan.byteLength, API_CSP, id, `attachment; filename="${plan.fileName}"`),
    'X-Export-Scope': encodeURIComponent(JSON.stringify({ projection: metadata.projection.key, snapshotVersion: metadata.projection.snapshotVersion, pricingRevision: metadata.projection.pricingRevision, range: metadata.range, matchedSessionCount: metadata.matchedSessionCount, scope: metadata.scope })) });
}
function error(res, failure, id) { json(res, failure.status || 500, { error: { code: failure.code || 'INTERNAL_ERROR', message: failure.status ? failure.message : 'Internal server error.', requestId: id, ...(failure.refreshStatus ? { reason: failure.refreshStatus.reason, failedFiles: failure.refreshStatus.failedFiles, retainedSnapshot: failure.refreshStatus.retainedSnapshot } : {}) } }, id); }
function verifyPost(req, { bodyLimit = 0 } = {}) {
  const length = Number(req.headers['content-length'] || 0);
  if (!Number.isSafeInteger(length) || length < 0 || length > bodyLimit) throw new ApiError(413, bodyLimit ? 'BODY_TOO_LARGE' : 'BODY_NOT_ALLOWED', bodyLimit ? 'Request body is too large.' : 'Request body is not allowed.');
}
async function readJsonBody(req, maximum) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'INVALID_CONTENT_TYPE', 'Expected application/json.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON request body.'); }
}
async function serveStatic(pathname, res, id) {
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!relative || target !== PUBLIC_DIR && !target.startsWith(`${PUBLIC_DIR}${path.sep}`)) return false;
  const contentType = STATIC_TYPES[path.extname(target).toLowerCase()];
  if (!contentType) return false;
  const fileStat = await stat(target).catch(() => null);
  if (!fileStat?.isFile()) return false;
  const body = await readFile(target);
  res.writeHead(200, headers(contentType, body.length, contentType.startsWith('text/html') ? PAGE_CSP : API_CSP, id)); res.end(body); return true;
}
function options() { return { exposeFullPaths: CONFIG.exposeFullPaths }; }
function providerId(requestUrl) {
  const id = requestUrl.searchParams.get('provider') || 'codex';
  if (!['codex', 'claude'].includes(id)) throw new ApiError(400, 'INVALID_PROVIDER', 'Invalid provider.');
  return id;
}
async function requireProvider(requestUrl, { pricingRefresh = true } = {}) {
  const provider = providerRegistry.get(providerId(requestUrl));
  const availability = await provider.availability();
  if (!availability.available) throw new ApiError(409, 'PROVIDER_UNAVAILABLE', `${provider.label} sessions directory is unavailable.`);
  if (pricingRefresh) startPricingRefresh(provider);
  return provider;
}
function projectedRequest(provider, cached, requestUrl) {
  const summary = currentSummary(provider, cached.summary);
  const context = requestContext(requestUrl);
  const projection = projectionIdentity(summary, context, cached.metadata);
  requireProjection(requestUrl.searchParams.get('projection'), projection);
  return { summary, context, projection };
}
function currentSummary(provider, summary) { const pricing = provider.pricingService.current(); return summary.pricing === pricing ? summary : { ...summary, pricing }; }
function withPricingStatus(provider, payload) { return { ...payload, provider: provider.id, pricing: { ...payload.pricing, refresh: provider.pricingService.status() } }; }
function dashboardPayload(provider, snapshot, context, scan = snapshot.metadata) { return withPricingStatus(provider, { ...buildDashboardPayload(currentSummary(provider, snapshot.summary), context, { provider: provider.id, ...scan }, options()), watcher: provider.watcher() }); }
function v1Summary(provider, summary, scan, context) { const current = currentSummary(provider, summary); const dashboard = buildDashboardPayload(current, context, { provider: provider.id, ...scan }, options()); return { provider: provider.id, deprecated: true, generatedAt: current.generatedAt, durationMs: current.durationMs, scannedFileCount: current.scannedFileCount, parsedSessionCount: current.parsedSessionCount, maxFiles: current.maxFiles, truncated: current.truncated, totals: current.totals, pricing: { ...dashboard.pricing, refresh: provider.pricingService.status() }, sessions: dashboard.sessions, errors: current.errors.map((item) => ({ file: path.basename(item.file), message: 'Session file could not be parsed.' })), scan: { provider: provider.id, ...scan } }; }
async function verifiedSnapshot(provider) {
  const snapshot = await provider.cache.get();
  await provider.pricingService.verify();
  return snapshot;
}
const startedAt = Date.now();
let cleanupPromise;
const pricingTimers = new Map();
const pricingStarted = new Set();
function schedulePricingRefresh(provider) {
  if (cleanupPromise || !pricingOwner.status().writable) return;
  const current = new Date();
  const nextUtcDay = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1, 0, 0, 1);
  const timer = setTimeout(() => { provider.pricingService.refresh().catch(() => undefined).finally(() => schedulePricingRefresh(provider)); }, Math.max(1_000, nextUtcDay - Date.now()));
  timer.unref?.();
  pricingTimers.set(provider.id, timer);
}
function startPricingRefresh(provider) {
  if (!pricingOwner.status().writable || pricingStarted.has(provider.id)) return;
  pricingStarted.add(provider.id);
  provider.pricingService.refresh().catch(() => undefined).finally(() => schedulePricingRefresh(provider));
}
const settingsOwner = isLoopbackHost(CONFIG.host) ? await acquireSettingsOwner(ENV_PATH) : null;
const server = http.createServer(async (req, res) => {
  if (req.aborted || res.destroyed) return;
  const id = requestId(); const started = Date.now();
  try {
    const requestUrl = validateRequest(req, CONFIG);
    if (!['GET', 'POST'].includes(req.method || '')) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    if (requestUrl.pathname === '/api/update' && req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to check for updates.'); }
    if (req.method === 'GET' && requestUrl.pathname === '/api/providers') { json(res, 200, await providerRegistry.list(), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/pricing/versions') {
      const service = pricingServices[providerId(requestUrl)];
      const offset = parseInteger(requestUrl.searchParams.get('offset'), 'offset', 0, 1_000_000);
      const limit = parseInteger(requestUrl.searchParams.get('limit'), 'limit', 100, 100, 1);
      await service.verify();
      json(res, 200, { ...await service.archive.list({ offset, limit }), current: service.status().archive }, id); return;
    }
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/pricing/versions/')) {
      const service = pricingServices[providerId(requestUrl)];
      json(res, 200, await service.archive.get(requestUrl.pathname.slice('/api/pricing/versions/'.length)), id); return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/account-usage') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'ACCOUNT_USAGE_DISABLED', 'Account usage is disabled in remote mode.'); json(res, 200, await accountUsageService.get(providerId(requestUrl)), id); return; }
    if (req.method === 'POST' && requestUrl.pathname === '/api/account-usage/refresh') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'ACCOUNT_USAGE_DISABLED', 'Account usage is disabled in remote mode.'); verifyPost(req); json(res, 200, await accountUsageService.get(providerId(requestUrl), { refresh: true }), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/summary') { const provider = await requireProvider(requestUrl); const cached = await verifiedSnapshot(provider); json(res, 200, v1Summary(provider, cached.summary, cached.metadata, requestContext(requestUrl)), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/dashboard') { const provider = await requireProvider(requestUrl); const cached = await verifiedSnapshot(provider); json(res, 200, dashboardPayload(provider, cached, requestContext(requestUrl)), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/sessions') { const provider = await requireProvider(requestUrl); const cached = await verifiedSnapshot(provider); const { summary, context } = projectedRequest(provider, cached, requestUrl); json(res, 200, withPricingStatus(provider, buildSessionsPayload(summary, context, { provider: provider.id, ...cached.metadata }, options())), id); return; }
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/sessions/')) { const sessionKey = requestUrl.pathname.slice('/api/sessions/'.length); if (!/^[A-Za-z0-9_-]{1,512}$/.test(sessionKey)) throw new ApiError(400, 'INVALID_SESSION_KEY', 'Invalid session key.'); const provider = await requireProvider(requestUrl); const cached = await verifiedSnapshot(provider); const { summary, context, projection } = projectedRequest(provider, cached, requestUrl); const detail = buildSessionDetail(summary, context, sessionKey, options()); if (!detail) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found.'); json(res, 200, { ...detail, projection, provider: provider.id, scan: { provider: provider.id, ...cached.metadata } }, id); return; }
    if (req.method === 'POST' && requestUrl.pathname === '/api/refresh') { verifyPost(req); const provider = await requireProvider(requestUrl); const snapshot = await provider.cache.refresh(); await provider.pricingService.verify(); json(res, 200, dashboardPayload(provider, snapshot, requestContext(requestUrl), provider.cache.status()), id); return; }
    if (req.method === 'POST' && ['/api/pricing/refresh', '/api/pricing/load', '/api/pricing/repair'].includes(requestUrl.pathname)) {
      verifyPost(req); const provider = await requireProvider(requestUrl, { pricingRefresh: false }); const action = requestUrl.pathname.split('/').at(-1);
      let result;
      try { result = await provider.pricingService[action](action === 'refresh' ? { manual: true } : undefined); }
      catch (failure) {
        if (failure.status) throw failure;
        const code = failure.code === 'publication' ? 'PRICING_PUBLICATION_FAILED' : failure.code === 'archive' ? 'PRICING_ARCHIVE_FAILED'
          : action === 'repair' ? 'PRICING_REPAIR_FAILED' : 'PRICING_REFRESH_FAILED';
        throw new ApiError(502, code, 'Pricing operation failed. Check the active verification status.');
      }
      const cached = await verifiedSnapshot(provider);
      json(res, 200, { ...dashboardPayload(provider, cached, requestContext(requestUrl)), pricingUpdate: { action, changedModels: result.changedModels || [] } }, id); return;
    }
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/export/download/')) {
      if (req.headers.range) throw new ApiError(416, 'RANGE_NOT_SUPPORTED', 'Resume is not supported. Start a new download.');
      const lease = exportService.claim(requestUrl.pathname.slice('/api/export/download/'.length));
      await exportService.send(lease, res, (plan) => exportHeaders(res, plan, id)); return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/export' || req.method === 'POST' && requestUrl.pathname === '/api/export/prepare') {
      const preparing = req.method === 'POST';
      if (preparing) { verifyPost(req); if (!requestUrl.searchParams.has('projection') || !requestUrl.searchParams.has('projectionAt')) throw new ApiError(400, 'INVALID_QUERY', 'A displayed projection is required.'); }
      if (req.headers.range) throw new ApiError(416, 'RANGE_NOT_SUPPORTED', 'Resume is not supported. Start a new download.');
      const format = requestUrl.searchParams.get('format') || 'csv-sessions';
      if (!VALID_EXPORTS.has(format)) throw new ApiError(400, 'INVALID_EXPORT_FORMAT', 'Invalid export format.');
      const lease = exportService.reserve();
      const abandoned = () => { if (!res.writableFinished) exportService.release(lease); };
      res.once('close', abandoned);
      try {
        const provider = await requireProvider(requestUrl); const cached = await verifiedSnapshot(provider);
        const { summary, context } = projectedRequest(provider, cached, requestUrl);
        const plan = { ...createExportPlan(format, buildExportPayload(summary, context, { provider: provider.id, ...cached.metadata }, format, options())),
          fileName: `local-ai-token-dashboard-${provider.id}-${format}.${({ 'csv-sessions': 'csv', 'csv-trend': 'csv', 'json-report': 'json', 'markdown-summary': 'md' })[format]}` };
        const ready = exportService.prepare(lease, plan);
        if (preparing) json(res, 200, ready, id);
        else await exportService.send(lease, res, (output) => exportHeaders(res, output, id));
      } catch (failure) { exportService.release(lease); throw failure; }
      finally { if (!preparing) res.removeListener('close', abandoned); }
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/diagnostics') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'DIAGNOSTICS_DISABLED', 'Diagnostics are disabled in remote mode.'); const selectedProvider = providerId(requestUrl); json(res, 200, { version: CURRENT_VERSION, provider: selectedProvider, uptimeMs: Date.now() - startedAt, node: process.version, platform: process.platform, config: { host: CONFIG.host, port: CONFIG.port, maxFiles: CONFIG.maxFiles, parseConcurrency: CONFIG.parseConcurrency, autoRefresh: CONFIG.autoRefresh, exposeFullPaths: CONFIG.exposeFullPaths }, providers: await providerRegistry.diagnostics(), requestDurationMs: Date.now() - started, memory: process.memoryUsage() }, id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/settings') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'SETTINGS_DISABLED', 'Settings are disabled in remote mode.'); json(res, 200, { ...await readSettings(ENV_PATH, CONFIG), ...await settingsOwner.check() }, id); return; }
    if (req.method === 'POST' && requestUrl.pathname === '/api/settings') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'SETTINGS_DISABLED', 'Settings are disabled in remote mode.'); verifyPost(req, { bodyLimit: 16 * 1024 }); const input = await readJsonBody(req, 16 * 1024); await settingsOwner.assertWritable(); const saved = await saveSettings(ENV_PATH, input, { revision: /^"([a-f0-9]{64})"$/.exec(req.headers['if-match'] || '')?.[1], beforeWrite: settingsOwner.assertWritable }); json(res, 200, { ...settingsPayload(saved.localConfig, CONFIG, saved.revision), ...settingsOwner.status() }, id); return; }
    if (req.method === 'POST' && requestUrl.pathname === '/api/update') { verifyPost(req); if (req.headers['transfer-encoding'] !== undefined) throw new ApiError(413, 'BODY_NOT_ALLOWED', 'Request body is not allowed.'); json(res, 200, await updateChecker.check(), id); return; }
    if (req.method === 'GET' && await serveStatic(requestUrl.pathname, res, id)) return;
    throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  } catch (failure) { if (res.headersSent || res.destroyed) res.destroy(); else error(res, failure, id); }
});
function cleanup() {
  if (!cleanupPromise) {
    for (const timer of pricingTimers.values()) clearTimeout(timer);
    exportService.close(); providerRegistry.close();
    cleanupPromise = (async () => {
      await Promise.all(Object.values(pricingServices).map((service) => service.close()));
      await Promise.all([
        pricingOwner.release().catch(() => { console.error('Pricing ownership cleanup failed; explicit recovery may be required.'); }),
        settingsOwner?.release().catch(() => { console.error('Settings ownership cleanup failed; explicit recovery may be required.'); }),
      ]);
    })();
  }
  return cleanupPromise;
}
server.on('close', () => { void cleanup(); });
server.on('error', () => { process.exitCode = 1; void cleanup(); console.error('Dashboard could not listen. Check the configured host and port.'); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { exportService.close(); server.close(); server.closeIdleConnections?.(); });
try {
  server.listen(CONFIG.port, CONFIG.host, () => {
    providerRegistry.startWatchers().catch(() => undefined);
    startPricingRefresh(providerRegistry.get('codex'));
    console.log(`Local AI Token Dashboard: http://${CONFIG.host}:${CONFIG.port}`);
  });
} catch { process.exitCode = 1; await cleanup(); console.error('Dashboard could not listen. Check the configured host and port.'); }
