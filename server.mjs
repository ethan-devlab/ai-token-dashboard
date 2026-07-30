import http from 'node:http';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import { buildDashboardPayload, buildExport, buildSessionDetail, buildSessionsPayload } from './server/dashboard-data.mjs';
import { isLoopbackHost, readEnvFile, readRuntimeConfig } from './server/config.mjs';
import { PRICING } from './server/pricing.mjs';
import { createSessionIndex } from './server/session-index.mjs';
import { createSummaryCache } from './server/summary-cache.mjs';
import { saveSettings, settingsPayload } from './server/settings.mjs';
import { resolveRange } from './server/timezone.mjs';
import { createUpdateChecker } from './server/update-checker.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const ENV_PATH = path.join(APP_DIR, '.env');
let localConfig = readEnvFile(ENV_PATH);
const CONFIG = readRuntimeConfig({ localConfig });
const require = createRequire(import.meta.url);
const { version: CURRENT_VERSION } = require('./package.json');
const index = createSessionIndex({ sessionsDirectory: CONFIG.sessionsDirectory, maxFiles: CONFIG.maxFiles, parseConcurrency: CONFIG.parseConcurrency, pricing: PRICING });
const summaryCache = createSummaryCache(() => index.refresh());
const updateChecker = createUpdateChecker({ repository: CONFIG.updateRepository, currentVersion: CURRENT_VERSION });
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const STATIC_TYPES = Object.freeze({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' });
const VALID_MODES = new Set(['all', 'last24h', 'today', 'week', 'month', 'year', 'custom']);
const VALID_SORTS = new Set(['recent', 'cost', 'total', 'input', 'cache', 'output']);
const VALID_EXPORTS = new Set(['csv-sessions', 'csv-trend', 'json-report', 'markdown-summary']);

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function requestId() { return randomUUID(); }
function parseInteger(value, name, fallback, maximum) { if (value == null) return fallback; if (!/^\d+$/.test(value)) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}.`); return parsed; }
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
  if ((period != null && !/^\d{4}(?:-\d{2}|-W\d{2})?$/.test(period)) || (start != null && start.length > 32) || (end != null && end.length > 32) || (fromMs != null && toMs != null && fromMs >= toMs)) throw new ApiError(400, 'INVALID_RANGE', 'Invalid selected time range.');
  const q = requestUrl.searchParams.get('q') ?? requestUrl.searchParams.get('search') ?? '';
  if (q.length > 256) throw new ApiError(400, 'INVALID_QUERY', 'Search is too long.');
  const sort = requestUrl.searchParams.get('sort') || 'recent';
  if (!VALID_SORTS.has(sort)) throw new ApiError(400, 'INVALID_QUERY', 'Invalid sort.');
  let range;
  try { range = resolveRange({ mode, fromMs, toMs, period, start, end, timezone: requestUrl.searchParams.get('timezone') || undefined }); }
  catch (error) { if (error?.code === 'INVALID_TIMEZONE' || error?.code === 'INVALID_RANGE') throw new ApiError(400, error.code, error.message); throw error; }
  return { range, q, sort, offset: parseInteger(requestUrl.searchParams.get('offset'), 'offset', 0, 1_000_000), limit: parseInteger(requestUrl.searchParams.get('limit'), 'limit', 100, 200), filters: { models: parseList(requestUrl.searchParams, 'models'), workspaces: parseList(requestUrl.searchParams, 'workspaces'), pricingStatus: parseList(requestUrl.searchParams, 'pricingStatus'), usageSource: parseList(requestUrl.searchParams, 'usageSource'), cliVersion: parseList(requestUrl.searchParams, 'cliVersion'), originator: parseList(requestUrl.searchParams, 'originator'), quality: parseList(requestUrl.searchParams, 'quality') } };
}
function headers(contentType, length, csp, id, attachment = null) { return { 'Content-Type': contentType, 'Content-Length': length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp, 'X-Request-Id': id, ...(attachment ? { 'Content-Disposition': attachment } : {}) }; }
function json(res, status, value, id) { const body = JSON.stringify(value); res.writeHead(status, headers('application/json; charset=utf-8', Buffer.byteLength(body), API_CSP, id)); res.end(body); }
function error(res, failure, id) { json(res, failure.status || 500, { error: { code: failure.code || 'INTERNAL_ERROR', message: failure.status ? failure.message : 'Internal server error.', requestId: id } }, id); }
function allowedHost(host) {
  const configured = `${CONFIG.host.includes(':') && !CONFIG.host.startsWith('[') ? `[${CONFIG.host}]` : CONFIG.host}:${CONFIG.port}`.toLowerCase();
  if (String(host || '').toLowerCase() === configured) return true;
  return isLoopbackHost(CONFIG.host) && new Set([`127.0.0.1:${CONFIG.port}`, `localhost:${CONFIG.port}`, `[::1]:${CONFIG.port}`]).has(String(host || '').toLowerCase());
}
function verifyPost(req, { bodyLimit = 0 } = {}) {
  if (!allowedHost(req.headers.host)) throw new ApiError(400, 'INVALID_HOST', 'Invalid Host header.');
  const origin = req.headers.origin;
  if (!origin || origin !== `http://${req.headers.host}`) throw new ApiError(403, 'INVALID_ORIGIN', 'Same-origin Origin is required.');
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
function watcherMetadata() { return { enabled: CONFIG.autoRefresh, status: watcherState, debounceMs: CONFIG.autoRefreshDebounceMs }; }
function dashboardPayload(snapshot, context, scan = snapshot.metadata) { return { ...buildDashboardPayload(snapshot.summary, context, scan, options()), watcher: watcherMetadata() }; }
function v1Summary(summary, scan, context) { const dashboard = buildDashboardPayload(summary, context, scan, options()); return { deprecated: true, generatedAt: summary.generatedAt, durationMs: summary.durationMs, scannedFileCount: summary.scannedFileCount, parsedSessionCount: summary.parsedSessionCount, maxFiles: summary.maxFiles, truncated: summary.truncated, totals: summary.totals, pricing: dashboard.pricing, sessions: dashboard.sessions, errors: summary.errors.map((item) => ({ file: path.basename(item.file), message: 'Session file could not be parsed.' })), scan }; }
const startedAt = Date.now();
let watcher = null;
let watcherTimer = null;
let watcherState = CONFIG.autoRefresh ? 'starting' : 'disabled';
function startWatcher() {
  if (!CONFIG.autoRefresh) return;
  try { watcher = watch(CONFIG.sessionsDirectory, { recursive: false }, () => { clearTimeout(watcherTimer); watcherTimer = setTimeout(() => { summaryCache.refresh().catch(() => undefined); }, CONFIG.autoRefreshDebounceMs); }); watcher.on('error', () => { watcherState = 'failed'; }); watcherState = 'watching'; }
  catch { watcherState = 'failed'; }
}
const server = http.createServer(async (req, res) => {
  const id = requestId(); const started = Date.now();
  try {
    if (!allowedHost(req.headers.host)) throw new ApiError(400, 'INVALID_HOST', 'Invalid Host header.');
    if (!['GET', 'POST'].includes(req.method || '')) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    const requestUrl = new URL(req.url || '/', `http://${CONFIG.host}:${CONFIG.port}`);
    if (req.method === 'GET' && requestUrl.pathname === '/api/summary') { const cached = await summaryCache.get(); json(res, 200, v1Summary(cached.summary, cached.metadata, requestContext(requestUrl)), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/dashboard') { const cached = await summaryCache.get(); json(res, 200, dashboardPayload(cached, requestContext(requestUrl)), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/sessions') { const cached = await summaryCache.get(); json(res, 200, buildSessionsPayload(cached.summary, requestContext(requestUrl), cached.metadata, options()), id); return; }
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/sessions/')) { const sessionKey = requestUrl.pathname.slice('/api/sessions/'.length); if (!/^[A-Za-z0-9_-]{1,512}$/.test(sessionKey)) throw new ApiError(400, 'INVALID_SESSION_KEY', 'Invalid session key.'); const cached = await summaryCache.get(); const detail = buildSessionDetail(cached.summary, requestContext(requestUrl), sessionKey, options()); if (!detail) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found.'); json(res, 200, { ...detail, scan: cached.metadata }, id); return; }
    if (req.method === 'POST' && requestUrl.pathname === '/api/refresh') { verifyPost(req); const snapshot = await summaryCache.refresh(); json(res, 200, dashboardPayload(snapshot, requestContext(requestUrl), summaryCache.status()), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/export') { const format = requestUrl.searchParams.get('format') || 'csv-sessions'; if (!VALID_EXPORTS.has(format)) throw new ApiError(400, 'INVALID_EXPORT_FORMAT', 'Invalid export format.'); const cached = await summaryCache.get(); const output = buildExport(format, buildDashboardPayload(cached.summary, { ...requestContext(requestUrl), limit: 200 }, cached.metadata, options())); const fileName = `codex-token-dashboard-${format}.${output.extension}`; res.writeHead(200, headers(output.contentType, Buffer.byteLength(output.body), API_CSP, id, `attachment; filename="${fileName}"`)); res.end(output.body); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/diagnostics') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'DIAGNOSTICS_DISABLED', 'Diagnostics are disabled in remote mode.'); const scan = summaryCache.status(); json(res, 200, { version: CURRENT_VERSION, uptimeMs: Date.now() - startedAt, node: process.version, platform: process.platform, config: { host: CONFIG.host, port: CONFIG.port, maxFiles: CONFIG.maxFiles, parseConcurrency: CONFIG.parseConcurrency, autoRefresh: CONFIG.autoRefresh, exposeFullPaths: CONFIG.exposeFullPaths }, snapshot: scan, watcher: watcherState, requestDurationMs: Date.now() - started, memory: process.memoryUsage() }, id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/settings') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'SETTINGS_DISABLED', 'Settings are disabled in remote mode.'); json(res, 200, settingsPayload(localConfig, CONFIG), id); return; }
    if (req.method === 'POST' && requestUrl.pathname === '/api/settings') { if (!isLoopbackHost(CONFIG.host)) throw new ApiError(403, 'SETTINGS_DISABLED', 'Settings are disabled in remote mode.'); verifyPost(req, { bodyLimit: 16 * 1024 }); localConfig = await saveSettings(ENV_PATH, await readJsonBody(req, 16 * 1024)); json(res, 200, settingsPayload(localConfig, CONFIG), id); return; }
    if (req.method === 'GET' && requestUrl.pathname === '/api/update') { json(res, 200, await updateChecker.check(), id); return; }
    if (req.method === 'GET' && await serveStatic(requestUrl.pathname, res, id)) return;
    throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  } catch (failure) { error(res, failure, id); }
});
server.on('close', () => { clearTimeout(watcherTimer); watcher?.close(); });
server.listen(CONFIG.port, CONFIG.host, () => { startWatcher(); console.log(`Codex Token Dashboard: http://${CONFIG.host}:${CONFIG.port}`); console.log(`Reading sessions from: ${CONFIG.sessionsDirectory}`); });
