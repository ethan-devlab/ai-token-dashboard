import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { buildDashboardPayload, buildSessionsPayload } from './server/dashboard-data.mjs';
import { PRICING } from './server/pricing.mjs';
import { buildSessionSummary } from './server/session-reader.mjs';
import { createSummaryCache } from './server/summary-cache.mjs';
import { createUpdateChecker } from './server/update-checker.mjs';
import { readEnvFile } from './server/config.mjs';
import { createRequire } from 'node:module';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '3333', 10);
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const SESSIONS_DIR = path.resolve(process.env.CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_DIR);
const MAX_FILES = Number.parseInt(process.env.MAX_FILES || '10000', 10);
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const require = createRequire(import.meta.url);
const { version: CURRENT_VERSION } = require('./package.json');
const LOCAL_CONFIG = readEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

async function buildSummary() {
  return buildSessionSummary({
    sessionsDirectory: SESSIONS_DIR,
    maxFiles: MAX_FILES,
    pricing: PRICING,
  });
}

const summaryCache = createSummaryCache(buildSummary);
const updateChecker = createUpdateChecker({
  repository: LOCAL_CONFIG.UPDATE_REPOSITORY,
  currentVersion: CURRENT_VERSION,
});

class RequestValidationError extends Error {}

function parseNonNegativeInteger(value, name, fallback, maximum) {
  if (value == null) return fallback;
  if (!/^\d+$/.test(value)) throw new RequestValidationError(`Invalid ${name}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new RequestValidationError(`Invalid ${name}.`);
  }
  return parsed;
}

function parseTimestamp(value, name) {
  if (value == null) return null;
  if (!/^-?\d+$/.test(value)) throw new RequestValidationError(`Invalid ${name}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RequestValidationError(`Invalid ${name}.`);
  return parsed;
}

function readDashboardRequest(requestUrl) {
  const mode = requestUrl.searchParams.get('mode') || 'all';
  if (!['all', 'last24h', 'today', 'week', 'month', 'year', 'custom'].includes(mode)) {
    throw new RequestValidationError('Invalid mode.');
  }
  const fromMs = parseTimestamp(requestUrl.searchParams.get('from'), 'from');
  const toMs = parseTimestamp(requestUrl.searchParams.get('to'), 'to');
  if (fromMs != null && toMs != null && fromMs >= toMs) {
    throw new RequestValidationError('The from timestamp must be earlier than to.');
  }
  const search = requestUrl.searchParams.get('search') || '';
  if (search.length > 256) throw new RequestValidationError('Search is too long.');
  const sort = requestUrl.searchParams.get('sort') || 'recent';
  if (!['recent', 'cost', 'total', 'input', 'cache', 'output'].includes(sort)) {
    throw new RequestValidationError('Invalid sort.');
  }
  return {
    range: { mode, fromMs, toMs },
    search,
    sort,
    offset: parseNonNegativeInteger(requestUrl.searchParams.get('offset'), 'offset', 0, 1_000_000),
    limit: parseNonNegativeInteger(requestUrl.searchParams.get('limit'), 'limit', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

function jsonResponse(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const STATIC_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
});

async function serveStatic(pathname, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\\\]+/, '');
  const targetPath = path.resolve(PUBLIC_DIR, relativePath);
  if (
    !relativePath ||
    (targetPath !== PUBLIC_DIR && !targetPath.startsWith(`${PUBLIC_DIR}${path.sep}`))
  ) {
    return false;
  }

  const contentType = STATIC_TYPES[path.extname(targetPath).toLowerCase()];
  if (!contentType) return false;

  let fileStat;
  try {
    fileStat = await stat(targetPath);
  } catch {
    return false;
  }
  if (!fileStat.isFile()) return false;

  const body = await readFile(targetPath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': contentType.startsWith('text/html')
      ? PAGE_CSP
      : "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(body);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === '/api/summary') {
      const cached = await summaryCache.get();
      jsonResponse(res, 200, { ...cached.summary, scan: cached.metadata });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/dashboard') {
      const cached = await summaryCache.get();
      jsonResponse(res, 200, buildDashboardPayload(cached.summary, readDashboardRequest(requestUrl), cached.metadata));
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/sessions') {
      const cached = await summaryCache.get();
      jsonResponse(res, 200, buildSessionsPayload(cached.summary, readDashboardRequest(requestUrl), cached.metadata));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/refresh') {
      const snapshot = await summaryCache.refresh();
      jsonResponse(res, 200, buildDashboardPayload(
        snapshot.summary,
        readDashboardRequest(requestUrl),
        summaryCache.status()
      ));
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/update') {
      jsonResponse(res, 200, await updateChecker.check());
      return;
    }

    if (req.method === 'GET' && await serveStatic(requestUrl.pathname, res)) {
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (error) {
    jsonResponse(res, error instanceof RequestValidationError ? 400 : 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Token Dashboard: http://${HOST}:${PORT}`);
  console.log(`Reading sessions from: ${SESSIONS_DIR}`);
  console.log(`Pricing table checked: ${PRICING.updatedAt}`);
});
