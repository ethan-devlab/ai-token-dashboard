import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import readline from 'node:readline';
import { fileURLToPath, URL } from 'node:url';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '3333', 10);
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const SESSIONS_DIR = path.resolve(process.env.CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_DIR);
const MAX_FILES = Number.parseInt(process.env.MAX_FILES || '10000', 10);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

// OpenAI API standard pricing in USD per 1M text tokens.
// Last checked against https://developers.openai.com/api/docs/pricing on 2026-07-26.
// This is an API-equivalent estimate; Codex subscriptions, regional processing,
// Batch/Flex/Priority tiers, tools, and negotiated pricing can differ.
const PRICING = Object.freeze({
  updatedAt: '2026-07-26',
  currency: 'USD',
  unitTokens: 1_000_000,
  source: 'https://developers.openai.com/api/docs/pricing',
  rates: Object.freeze({
    'gpt-5.6-sol': { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 30.00 },
    'gpt-5.6-terra': { input: 2.50, cachedInput: 0.25, cacheWrite: 3.125, output: 15.00 },
    'gpt-5.6-luna': { input: 1.00, cachedInput: 0.10, cacheWrite: 1.25, output: 6.00 },
    'gpt-5.5-pro': { input: 30.00, cachedInput: null, cacheWrite: null, output: 180.00 },
    'gpt-5.5': { input: 5.00, cachedInput: 0.50, cacheWrite: null, output: 30.00 },
    'gpt-5.4-pro': { input: 30.00, cachedInput: null, cacheWrite: null, output: 180.00 },
    'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, cacheWrite: null, output: 4.50 },
    'gpt-5.4-nano': { input: 0.20, cachedInput: 0.02, cacheWrite: null, output: 1.25 },
    'gpt-5.4': { input: 2.50, cachedInput: 0.25, cacheWrite: null, output: 15.00 },
    'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14.00 },
    'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14.00 },
    'gpt-5.2': { input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14.00 },
    'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, cacheWrite: null, output: 2.00 },
    'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10.00 },
    'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10.00 },
    'gpt-5.1': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10.00 },
    'gpt-5-codex': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10.00 },
    'gpt-5-mini': { input: 0.25, cachedInput: 0.025, cacheWrite: null, output: 2.00 },
    'gpt-5-nano': { input: 0.05, cachedInput: 0.005, cacheWrite: null, output: 0.40 },
    'gpt-5': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10.00 },
    'codex-mini-latest': { input: 1.50, cachedInput: 0.375, cacheWrite: null, output: 6.00 },
  }),
});

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeUsage(raw = {}) {
  const inputTokens = number(raw.input_tokens ?? raw.inputTokens);
  const cachedInputTokens = number(
    raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cachedInputTokens
  );
  const cacheWriteTokens = number(raw.cache_write_tokens ?? raw.cacheWriteTokens);
  const outputTokens = number(raw.output_tokens ?? raw.outputTokens);
  const reasoningOutputTokens = number(
    raw.reasoning_output_tokens ?? raw.reasoningOutputTokens
  );
  // cached_input_tokens is normally a subset of input_tokens; do not add it twice.
  const totalTokens = number(raw.total_tokens ?? raw.totalTokens) || inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

const ZERO_USAGE = Object.freeze(normalizeUsage());

function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function subtractUsage(current, previous) {
  const inputTokens = Math.max(0, current.inputTokens - previous.inputTokens);
  const cachedInputTokens = Math.max(0, current.cachedInputTokens - previous.cachedInputTokens);
  const cacheWriteTokens = Math.max(0, current.cacheWriteTokens - previous.cacheWriteTokens);
  const outputTokens = Math.max(0, current.outputTokens - previous.outputTokens);
  const reasoningOutputTokens = Math.max(
    0,
    current.reasoningOutputTokens - previous.reasoningOutputTokens
  );
  const reportedTotalDelta = Math.max(0, current.totalTokens - previous.totalTokens);

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    reasoningOutputTokens,
    totalTokens: reportedTotalDelta || inputTokens + outputTokens,
  };
}

function isZeroUsage(usage) {
  return usage.inputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens === 0 &&
    usage.cachedInputTokens === 0 && usage.cacheWriteTokens === 0;
}

function getTimestamp(event) {
  const value =
    event?.timestamp ??
    event?.created_at ??
    event?.createdAt ??
    event?.payload?.timestamp ??
    null;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getEventModel(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  return payload.model ?? payload.model_name ?? event?.model ?? event?.model_name ?? null;
}

function extractMetadata(event, metadata) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};

  if (event?.type === 'session_meta' || event?.type === 'thread.started') {
    metadata.id ||= payload.id ?? payload.session_id ?? payload.thread_id ?? event.id ?? null;
    metadata.cwd ||= payload.cwd ?? payload.working_directory ?? null;
    metadata.model ||= payload.model ?? payload.model_name ?? null;
    metadata.modelProvider ||= payload.model_provider ?? payload.provider ?? null;
    metadata.originator ||= payload.originator ?? payload.source ?? null;
    metadata.cliVersion ||= payload.cli_version ?? payload.version ?? null;
  }

  metadata.model ||= getEventModel(event);
}

function extractTokenCountTotal(event) {
  const payload = event?.payload;
  if (
    event?.type === 'event_msg' &&
    payload?.type === 'token_count' &&
    payload?.info?.total_token_usage
  ) {
    return normalizeUsage(payload.info.total_token_usage);
  }

  if (event?.type === 'token_count' && event?.info?.total_token_usage) {
    return normalizeUsage(event.info.total_token_usage);
  }

  return null;
}

function extractTurnUsage(event) {
  if (event?.type === 'turn.completed' && event?.usage) {
    return normalizeUsage(event.usage);
  }

  if (event?.type === 'turn_completed' && event?.payload?.usage) {
    return normalizeUsage(event.payload.usage);
  }

  return null;
}

async function parseJsonlFile(filePath, relativePath) {
  const fileStat = await stat(filePath);
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let lineCount = 0;
  let invalidLineCount = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let previousCumulativeUsage = { ...ZERO_USAGE };
  let latestCumulativeUsage = null;
  let cumulativeResetCount = 0;
  let tokenCountEventCount = 0;
  let duplicateTokenCountEventCount = 0;
  let turnUsageEventCount = 0;
  let currentModel = null;
  const cumulativeEvents = [];
  const turnEvents = [];
  const metadata = {
    id: null,
    cwd: null,
    model: null,
    modelProvider: null,
    originator: null,
    cliVersion: null,
  };

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    lineCount += 1;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      invalidLineCount += 1;
      continue;
    }

    extractMetadata(event, metadata);
    currentModel = getEventModel(event) || currentModel || metadata.model;

    const timestamp = getTimestamp(event);
    if (timestamp) {
      firstTimestamp ||= timestamp;
      lastTimestamp = timestamp;
    }

    const cumulative = extractTokenCountTotal(event);
    if (cumulative) {
      tokenCountEventCount += 1;
      const decreased =
        cumulative.inputTokens < previousCumulativeUsage.inputTokens ||
        cumulative.outputTokens < previousCumulativeUsage.outputTokens ||
        cumulative.totalTokens < previousCumulativeUsage.totalTokens;
      if (decreased) {
        cumulativeResetCount += 1;
        previousCumulativeUsage = { ...ZERO_USAGE };
      }

      const delta = subtractUsage(cumulative, previousCumulativeUsage);
      if (isZeroUsage(delta)) {
        duplicateTokenCountEventCount += 1;
      } else {
        cumulativeEvents.push({
          timestamp: timestamp || lastTimestamp || fileStat.mtime.toISOString(),
          timestampEstimated: !timestamp,
          model: currentModel || metadata.model || null,
          usage: delta,
        });
      }

      previousCumulativeUsage = cumulative;
      latestCumulativeUsage = cumulative;
      continue;
    }

    const turnUsage = extractTurnUsage(event);
    if (turnUsage) {
      turnUsageEventCount += 1;
      turnEvents.push({
        timestamp: timestamp || lastTimestamp || fileStat.mtime.toISOString(),
        timestampEstimated: !timestamp,
        model: currentModel || metadata.model || null,
        usage: turnUsage,
      });
    }
  }

  const usageEvents = cumulativeEvents.length > 0 ? cumulativeEvents : turnEvents;
  const usage = usageEvents.reduce((sum, item) => addUsage(sum, item.usage), { ...ZERO_USAGE });
  const usageSource = cumulativeEvents.length > 0
    ? 'delta(token_count.total_token_usage)'
    : turnEvents.length > 0
      ? 'sum(turn.completed.usage)'
      : latestCumulativeUsage
        ? 'token_count.without_positive_delta'
        : 'not_found';

  return {
    file: relativePath.split(path.sep).join('/'),
    sessionId: metadata.id || path.basename(filePath, path.extname(filePath)),
    ...metadata,
    model: metadata.model || currentModel,
    firstTimestamp,
    lastTimestamp,
    modifiedAt: fileStat.mtime.toISOString(),
    sizeBytes: fileStat.size,
    lineCount,
    invalidLineCount,
    tokenCountEventCount,
    duplicateTokenCountEventCount,
    cumulativeResetCount,
    turnUsageEventCount,
    usageSource,
    usage,
    usageEvents,
  };
}

async function findJsonlFiles(rootDir) {
  const files = [];

  async function walk(currentDir) {
    if (files.length >= MAX_FILES) return;
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

async function buildSummary() {
  const startedAt = Date.now();
  let rootStat;
  try {
    rootStat = await stat(SESSIONS_DIR);
  } catch {
    const hint = process.platform === 'win32'
      ? 'Expected a directory such as C:\\Users\\<name>\\.codex\\sessions.'
      : 'Expected ~/.codex/sessions.';
    throw new Error(`Sessions directory does not exist: ${SESSIONS_DIR}. ${hint}`);
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Sessions path is not a directory: ${SESSIONS_DIR}`);
  }

  const filePaths = await findJsonlFiles(SESSIONS_DIR);
  const sessions = [];
  const errors = [];

  for (const filePath of filePaths) {
    const relativePath = path.relative(SESSIONS_DIR, filePath);
    try {
      sessions.push(await parseJsonlFile(filePath, relativePath));
    } catch (error) {
      errors.push({
        file: relativePath.split(path.sep).join('/'),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  sessions.sort((a, b) => {
    const aTime = Date.parse(a.lastTimestamp || a.modifiedAt) || 0;
    const bTime = Date.parse(b.lastTimestamp || b.modifiedAt) || 0;
    return bTime - aTime;
  });

  const totals = sessions.reduce((sum, session) => addUsage(sum, session.usage), { ...ZERO_USAGE });

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sessionsDirectory: SESSIONS_DIR,
    scannedFileCount: filePaths.length,
    parsedSessionCount: sessions.length,
    maxFiles: MAX_FILES,
    truncated: filePaths.length >= MAX_FILES,
    totals,
    pricing: PRICING,
    sessions,
    errors,
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

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
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
      jsonResponse(res, 200, await buildSummary());
      return;
    }

    if (req.method === 'GET' && await serveStatic(requestUrl.pathname, res)) {
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (error) {
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Token Dashboard: http://${HOST}:${PORT}`);
  console.log(`Reading sessions from: ${SESSIONS_DIR}`);
  console.log(`Pricing table checked: ${PRICING.updatedAt}`);
});
