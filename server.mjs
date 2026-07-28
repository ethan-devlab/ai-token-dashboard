import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import readline from 'node:readline';
import { URL } from 'node:url';

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

const HTML = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Token Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #090b10;
      color: #eef2ff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #172033 0, #090b10 42rem); }
    main { width: min(1600px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 60px; }
    header { display: flex; gap: 20px; align-items: end; justify-content: space-between; margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: clamp(28px, 4vw, 44px); letter-spacing: -0.04em; }
    .subtitle, .muted { color: #98a2b8; }
    .controls { display: grid; gap: 10px; margin-bottom: 14px; padding: 14px; border: 1px solid #242d40; border-radius: 15px; background: rgba(17,22,34,.80); }
    .control-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .control-row.secondary { padding-top: 10px; border-top: 1px solid #242d40; }
    label.control { display: inline-flex; gap: 7px; align-items: center; color: #aeb8cc; font-size: 13px; }
    button, input, select {
      border: 1px solid #2a3243; border-radius: 10px; background: #111622; color: inherit;
      min-height: 40px; padding: 0 12px; font: inherit;
    }
    input[type="search"] { min-width: min(330px, 70vw); }
    input[type="checkbox"] { min-height: auto; width: 17px; height: 17px; padding: 0; }
    button { cursor: pointer; font-weight: 700; }
    button:hover { background: #182034; }
    button:disabled { opacity: .55; cursor: wait; }
    .range-control[hidden] { display: none !important; }
    .cards { display: grid; grid-template-columns: repeat(6, minmax(145px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .card { min-width: 0; padding: 17px; border-radius: 16px; background: rgba(17,22,34,.88); border: 1px solid #242d40; box-shadow: 0 14px 34px rgba(0,0,0,.18); }
    .card.cost { border-color: #365d52; background: rgba(16,38,34,.88); }
    .card .label { color: #98a2b8; font-size: 13px; }
    .card .value { margin-top: 8px; font-size: clamp(22px, 2.7vw, 33px); font-weight: 800; letter-spacing: -.04em; overflow-wrap: anywhere; }
    .card .exact { margin-top: 5px; color: #7f8ba2; font-size: 11px; font-variant-numeric: tabular-nums; }
    .info { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0 0 14px; padding: 12px 14px; border: 1px solid #242d40; border-radius: 12px; background: rgba(17,22,34,.72); font-size: 13px; }
    .info code { color: #c6d4ff; overflow-wrap: anywhere; }
    .status-error { color: #ffb4b4; border-color: #713d46; background: #24141a; }
    .table-wrap { overflow: auto; border: 1px solid #242d40; border-radius: 15px; background: rgba(12,16,25,.92); }
    table { width: 100%; border-collapse: collapse; min-width: 1280px; }
    th, td { padding: 11px 13px; border-bottom: 1px solid #20283a; text-align: right; white-space: nowrap; }
    th { position: sticky; top: 0; z-index: 1; background: #141a28; color: #adb7ca; font-size: 11px; text-transform: uppercase; letter-spacing: .055em; }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3) { text-align: left; }
    tbody tr:hover { background: #121928; }
    .session { max-width: 350px; overflow: hidden; text-overflow: ellipsis; }
    .usage-source { font-size: 11px; color: #75819a; }
    .pill { display: inline-flex; align-items: center; min-height: 25px; padding: 2px 8px; border-radius: 999px; background: #202a42; color: #cad7ff; font-size: 12px; }
    .pill.unknown { background: #44361d; color: #ffe0a1; }
    .warning { color: #ffd48a; }
    .good { color: #9fdfbf; }
    .empty { padding: 42px; text-align: center; color: #98a2b8; }
    .cell-exact { display: block; margin-top: 2px; color: #69758c; font-size: 10px; }
    body:not(.show-exact) .exact, body:not(.show-exact) .cell-exact { display: none; }
    body:not(.show-details) .detail-col { display: none; }
    footer { margin-top: 14px; color: #78839a; font-size: 12px; line-height: 1.65; }
    details.pricing { margin-top: 14px; padding: 12px 14px; border: 1px solid #242d40; border-radius: 12px; background: rgba(17,22,34,.6); }
    details.pricing summary { cursor: pointer; color: #bac7df; }
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-top: 12px; }
    .rate { padding: 10px; border-radius: 10px; background: #101622; color: #8f9bb1; font-size: 11px; line-height: 1.55; }
    .rate strong { color: #d8e1f5; }
    @media (max-width: 1180px) { .cards { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 760px) { header { align-items: flex-start; flex-direction: column; } .cards { grid-template-columns: repeat(2, 1fr); } .control-row { align-items: stretch; } input[type="search"] { min-width: 100%; } }
    @media (max-width: 480px) { main { width: min(100% - 20px, 1600px); padding-top: 20px; } .cards { grid-template-columns: 1fr; } }
  </style>
</head>
<body class="show-details show-exact">
  <main>
    <header>
      <div>
        <h1>Codex Token Dashboard</h1>
        <div class="subtitle">依 JSONL 事件時間統計 token 與 API 等值費用。</div>
      </div>
      <button id="refresh" type="button">重新解析 JSONL</button>
    </header>

    <section class="controls" aria-label="Dashboard controls">
      <div class="control-row">
        <input id="search" type="search" placeholder="搜尋 session、模型、cwd…" autocomplete="off" />
        <label class="control">時間範圍
          <select id="rangeMode">
            <option value="all">全部時間</option>
            <option value="last24h">最近 24 小時</option>
            <option value="today">當日使用</option>
            <option value="week">週使用</option>
            <option value="month" selected>月使用</option>
            <option value="year">年度使用</option>
            <option value="custom">自訂範圍</option>
          </select>
        </label>
        <label class="control range-control" data-range="week">週 <input id="weekInput" type="week" /></label>
        <label class="control range-control" data-range="month">月 <input id="monthInput" type="month" /></label>
        <label class="control range-control" data-range="year">年 <input id="yearInput" type="number" min="2000" max="2200" step="1" /></label>
        <label class="control range-control" data-range="custom">起 <input id="customStart" type="datetime-local" /></label>
        <label class="control range-control" data-range="custom">迄 <input id="customEnd" type="datetime-local" /></label>
      </div>
      <div class="control-row secondary">
        <label class="control">顯示單位
          <select id="unit">
            <option value="auto" selected>自動</option>
            <option value="exact">完整數字</option>
            <option value="K">K（千）</option>
            <option value="M">M（百萬）</option>
            <option value="B">B（十億）</option>
          </select>
        </label>
        <label class="control"><input id="showExact" type="checkbox" checked /> 顯示精確值</label>
        <label class="control"><input id="showDetails" type="checkbox" checked /> 顯示 token／費用明細</label>
        <label class="control">排序
          <select id="sort">
            <option value="recent">最近活動</option>
            <option value="cost">費用</option>
            <option value="total">Total tokens</option>
            <option value="input">Input tokens</option>
            <option value="cache">Cached input</option>
            <option value="output">Output tokens</option>
          </select>
        </label>
        <span id="rangeLabel" class="muted"></span>
      </div>
    </section>

    <section class="cards" aria-label="Filtered totals">
      <article class="card cost"><div class="label">API 等值費用（USD）</div><div class="value" id="cost">—</div><div class="exact" id="costDetail"></div></article>
      <article class="card"><div class="label">Total tokens</div><div class="value" id="total">—</div><div class="exact" data-exact-for="total"></div></article>
      <article class="card"><div class="label">Input tokens</div><div class="value" id="input">—</div><div class="exact" data-exact-for="input"></div></article>
      <article class="card"><div class="label">Cached input</div><div class="value" id="cache">—</div><div class="exact" data-exact-for="cache"></div></article>
      <article class="card"><div class="label">Output tokens</div><div class="value" id="output">—</div><div class="exact" data-exact-for="output"></div></article>
      <article class="card detail-col"><div class="label">Reasoning output</div><div class="value" id="reasoning">—</div><div class="exact" data-exact-for="reasoning"></div></article>
    </section>

    <section id="info" class="info"><span>載入中…</span></section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>最後使用</th>
            <th>Session / JSONL</th>
            <th>模型 / CWD</th>
            <th>Input</th>
            <th class="detail-col">Cached</th>
            <th class="detail-col">Uncached</th>
            <th class="detail-col">Cache write</th>
            <th>Output</th>
            <th class="detail-col">Reasoning</th>
            <th>Total</th>
            <th>費用 USD</th>
            <th class="detail-col">費用明細</th>
            <th class="detail-col">JSONL</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="empty" class="empty" hidden>此範圍沒有 token 使用紀錄。</div>
    </section>

    <details class="pricing">
      <summary>查看內建模型定價</summary>
      <div id="pricingGrid" class="pricing-grid"></div>
    </details>

    <footer>
      費用是依 OpenAI API Standard 公開單價估算，不是 Codex／ChatGPT 訂閱帳單。服務層級、區域處理、工具費用、Batch/Flex/Priority 或企業折扣均可能使實際費用不同。<br />
      Cached input 已包含在 Input tokens；計價時以 Uncached input × Input rate，加上 Cached input × Cached rate，再加 Output × Output rate。Reasoning 通常包含於 Output，不重複收費。
    </footer>
  </main>

  <script>
    const state = { data: null, filtered: null };
    const integerFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
    const dateFmt = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
    const moneyFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 });
    const $ = (id) => document.getElementById(id);

    function zeroUsage() {
      return { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
    }

    function addUsage(a, b) {
      for (const key of Object.keys(a)) a[key] += Number(b?.[key] || 0);
      return a;
    }

    function text(value) { return value == null || value === '' ? '—' : String(value); }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    }

    function formatDate(value) {
      if (!value) return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
    }

    function compactNumber(value) {
      const unit = $('unit').value;
      const number = Number(value || 0);
      if (unit === 'exact') return integerFmt.format(number);
      const table = unit === 'auto'
        ? (Math.abs(number) >= 1e9 ? ['B', 1e9] : Math.abs(number) >= 1e6 ? ['M', 1e6] : Math.abs(number) >= 1e3 ? ['K', 1e3] : ['', 1])
        : [unit, unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : 1e3];
      const [suffix, divisor] = table;
      if (!suffix) return integerFmt.format(number);
      const scaled = number / divisor;
      const digits = Math.abs(scaled) >= 100 ? 1 : Math.abs(scaled) >= 10 ? 2 : 3;
      return scaled.toLocaleString('zh-TW', { maximumFractionDigits: digits }) + suffix;
    }

    function tokenCell(value, strong = false) {
      const main = strong ? '<strong>' + compactNumber(value) + '</strong>' : compactNumber(value);
      return main + '<span class="cell-exact">' + integerFmt.format(value || 0) + '</span>';
    }

    function localDateTimeValue(date) {
      const pad = (n) => String(n).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function isoWeekValue(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    }

    function isoWeekStart(value) {
      const match = /^([0-9]{4})-W([0-9]{2})$/.exec(value || '');
      if (!match) return null;
      const year = Number(match[1]);
      const week = Number(match[2]);
      const jan4 = new Date(year, 0, 4);
      const jan4Day = jan4.getDay() || 7;
      const monday = new Date(year, 0, 4 - jan4Day + 1 + (week - 1) * 7);
      monday.setHours(0, 0, 0, 0);
      return monday;
    }

    function getRange() {
      const mode = $('rangeMode').value;
      const now = new Date();
      let from = null;
      let to = null;
      let label = '全部時間';

      if (mode === 'last24h') {
        from = new Date(now.getTime() - 24 * 3600_000); to = now; label = '最近 24 小時';
      } else if (mode === 'today') {
        from = new Date(now); from.setHours(0, 0, 0, 0); to = now; label = '今天 ' + formatDate(from) + ' 起';
      } else if (mode === 'week') {
        from = isoWeekStart($('weekInput').value);
        if (from) { to = new Date(from); to.setDate(to.getDate() + 7); label = $('weekInput').value; }
      } else if (mode === 'month') {
        const match = /^([0-9]{4})-([0-9]{2})$/.exec($('monthInput').value || '');
        if (match) {
          from = new Date(Number(match[1]), Number(match[2]) - 1, 1);
          to = new Date(Number(match[1]), Number(match[2]), 1);
          label = match[1] + ' 年 ' + Number(match[2]) + ' 月';
        }
      } else if (mode === 'year') {
        const year = Number($('yearInput').value);
        if (Number.isInteger(year)) { from = new Date(year, 0, 1); to = new Date(year + 1, 0, 1); label = year + ' 年'; }
      } else if (mode === 'custom') {
        from = $('customStart').value ? new Date($('customStart').value) : null;
        to = $('customEnd').value ? new Date($('customEnd').value) : null;
        label = (from ? formatDate(from) : '最早') + ' ～ ' + (to ? formatDate(to) : '現在');
      }

      return {
        mode,
        fromMs: from && !Number.isNaN(from.getTime()) ? from.getTime() : null,
        toMs: to && !Number.isNaN(to.getTime()) ? to.getTime() : null,
        label,
      };
    }

    function normalizeModel(model) {
      return String(model || '').trim().toLowerCase();
    }

    function findRate(model) {
      const normalized = normalizeModel(model);
      const rates = state.data?.pricing?.rates || {};
      return Object.keys(rates)
        .sort((a, b) => b.length - a.length)
        .find((key) => normalized === key || normalized.startsWith(key + '-')) || null;
    }

    function calculateCost(events) {
      const result = { total: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, unknownModels: new Set(), unavailableComponents: new Set(), pricedTokens: 0 };
      const unit = state.data.pricing.unitTokens;

      for (const event of events) {
        const matchedModel = findRate(event.model);
        if (!matchedModel) {
          result.unknownModels.add(event.model || 'unknown');
          continue;
        }
        const rate = state.data.pricing.rates[matchedModel];
        const usage = event.usage;
        const components = [
          ['input', usage.uncachedInputTokens, rate.input],
          ['cached', usage.cachedInputTokens, rate.cachedInput],
          ['cacheWrite', usage.cacheWriteTokens, rate.cacheWrite],
          ['output', usage.outputTokens, rate.output],
        ];
        for (const [name, tokens, price] of components) {
          if (!tokens) continue;
          if (price == null) {
            result.unavailableComponents.add(matchedModel + ':' + name);
            continue;
          }
          const amount = tokens / unit * price;
          result[name] += amount;
          result.total += amount;
          result.pricedTokens += tokens;
        }
      }
      return result;
    }

    function filterEvents(session, range) {
      return session.usageEvents.filter((event) => {
        const timestamp = Date.parse(event.timestamp);
        if (!Number.isFinite(timestamp)) return range.mode === 'all';
        if (range.fromMs != null && timestamp < range.fromMs) return false;
        if (range.toMs != null && timestamp >= range.toMs) return false;
        return true;
      });
    }

    function costText(cost) {
      if (cost.pricedTokens === 0) return '—';
      const prefix = cost.unknownModels.size || cost.unavailableComponents.size ? '≥ ' : '';
      return prefix + moneyFmt.format(cost.total);
    }

    function renderPricing() {
      const rates = state.data?.pricing?.rates || {};
      $('pricingGrid').innerHTML = Object.entries(rates).map(([model, rate]) => {
        const show = (value) => value == null ? '—' : '$' + value + ' / 1M';
        return '<div class="rate"><strong>' + escapeHtml(model) + '</strong><br />' +
          'Input ' + show(rate.input) + ' · Cached ' + show(rate.cachedInput) + '<br />' +
          'Cache write ' + show(rate.cacheWrite) + ' · Output ' + show(rate.output) + '</div>';
      }).join('');
    }

    function render() {
      if (!state.data) return;
      const range = getRange();
      $('rangeLabel').textContent = range.label;
      const query = $('search').value.trim().toLowerCase();
      const sort = $('sort').value;

      let sessions = state.data.sessions.map((session) => {
        const events = filterEvents(session, range);
        const usage = events.reduce((sum, event) => addUsage(sum, event.usage), zeroUsage());
        const cost = calculateCost(events);
        const lastEvent = events.reduce((latest, event) => Date.parse(event.timestamp) > Date.parse(latest?.timestamp || 0) ? event : latest, null);
        return { ...session, filteredEvents: events, filteredUsage: usage, filteredCost: cost, filteredLastTimestamp: lastEvent?.timestamp || null };
      }).filter((session) => {
        if (session.filteredEvents.length === 0) return false;
        if (!query) return true;
        return [session.sessionId, session.file, session.model, session.cwd, session.originator]
          .filter(Boolean).join(' ').toLowerCase().includes(query);
      });

      sessions.sort((a, b) => {
        if (sort === 'cost') return b.filteredCost.total - a.filteredCost.total;
        if (sort === 'total') return b.filteredUsage.totalTokens - a.filteredUsage.totalTokens;
        if (sort === 'input') return b.filteredUsage.inputTokens - a.filteredUsage.inputTokens;
        if (sort === 'cache') return b.filteredUsage.cachedInputTokens - a.filteredUsage.cachedInputTokens;
        if (sort === 'output') return b.filteredUsage.outputTokens - a.filteredUsage.outputTokens;
        return (Date.parse(b.filteredLastTimestamp || b.lastTimestamp || b.modifiedAt) || 0) - (Date.parse(a.filteredLastTimestamp || a.lastTimestamp || a.modifiedAt) || 0);
      });

      const totals = sessions.reduce((sum, session) => addUsage(sum, session.filteredUsage), zeroUsage());
      const totalCost = sessions.reduce((sum, session) => {
        sum.total += session.filteredCost.total;
        sum.input += session.filteredCost.input;
        sum.cached += session.filteredCost.cached;
        sum.cacheWrite += session.filteredCost.cacheWrite;
        sum.output += session.filteredCost.output;
        sum.pricedTokens += session.filteredCost.pricedTokens;
        for (const model of session.filteredCost.unknownModels) sum.unknownModels.add(model);
        for (const component of session.filteredCost.unavailableComponents) sum.unavailableComponents.add(component);
        return sum;
      }, { total: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, pricedTokens: 0, unknownModels: new Set(), unavailableComponents: new Set() });

      const cardValues = { total: totals.totalTokens, input: totals.inputTokens, cache: totals.cachedInputTokens, output: totals.outputTokens, reasoning: totals.reasoningOutputTokens };
      for (const [id, value] of Object.entries(cardValues)) {
        $(id).textContent = compactNumber(value);
        const detail = document.querySelector('[data-exact-for="' + id + '"]');
        if (detail) detail.textContent = integerFmt.format(value) + ' tokens';
      }
      $('cost').textContent = costText(totalCost);
      $('costDetail').textContent =
        'Input ' + moneyFmt.format(totalCost.input) + ' · Cached ' + moneyFmt.format(totalCost.cached) +
        ' · Cache write ' + moneyFmt.format(totalCost.cacheWrite) + ' · Output ' + moneyFmt.format(totalCost.output);

      const errorText = state.data.errors.length
        ? '<span class="warning">' + integerFmt.format(state.data.errors.length) + ' 個檔案解析失敗</span>'
        : '<span>無檔案錯誤</span>';
      const unknownText = totalCost.unknownModels.size
        ? '<span class="warning">未定價模型：' + escapeHtml([...totalCost.unknownModels].join(', ')) + '</span>'
        : '<span class="good">已識別全部使用中的模型</span>';
      const truncationText = state.data.truncated
        ? '<span class="warning">已達 MAX_FILES=' + integerFmt.format(state.data.maxFiles) + '</span>' : '';
      $('info').classList.remove('status-error');
      $('info').innerHTML =
        '<span>目錄：<code>' + escapeHtml(state.data.sessionsDirectory) + '</code></span>' +
        '<span>範圍內 sessions：' + integerFmt.format(sessions.length) + '</span>' +
        '<span>JSONL：' + integerFmt.format(state.data.scannedFileCount) + '</span>' +
        '<span>解析：' + integerFmt.format(state.data.durationMs) + ' ms</span>' +
        '<span>定價版本：' + escapeHtml(state.data.pricing.updatedAt) + '</span>' +
        unknownText + errorText + truncationText;

      $('rows').innerHTML = sessions.map((session) => {
        const usage = session.filteredUsage;
        const cost = session.filteredCost;
        const matchedRate = findRate(session.model);
        const modelClass = matchedRate ? 'pill' : 'pill unknown';
        const invalid = session.invalidLineCount ? ' · invalid ' + integerFmt.format(session.invalidLineCount) : '';
        const duplicate = session.duplicateTokenCountEventCount ? ' · duplicate ' + integerFmt.format(session.duplicateTokenCountEventCount) : '';
        const costDetail = 'Input ' + moneyFmt.format(cost.input) + '<br />Cached ' + moneyFmt.format(cost.cached) + '<br />Output ' + moneyFmt.format(cost.output);
        return '<tr>' +
          '<td>' + escapeHtml(formatDate(session.filteredLastTimestamp || session.lastTimestamp || session.modifiedAt)) + '</td>' +
          '<td class="session" title="' + escapeHtml(session.file) + '"><strong>' + escapeHtml(text(session.sessionId)) + '</strong><br />' +
            '<span class="muted">' + escapeHtml(session.file) + '</span><br /><span class="usage-source">' + escapeHtml(session.usageSource) + '</span></td>' +
          '<td class="session" title="' + escapeHtml(session.cwd || '') + '"><span class="' + modelClass + '">' + escapeHtml(text(session.model)) + '</span><br />' +
            '<span class="muted">' + escapeHtml(text(session.cwd)) + '</span></td>' +
          '<td>' + tokenCell(usage.inputTokens) + '</td>' +
          '<td class="detail-col">' + tokenCell(usage.cachedInputTokens) + '</td>' +
          '<td class="detail-col">' + tokenCell(usage.uncachedInputTokens) + '</td>' +
          '<td class="detail-col">' + tokenCell(usage.cacheWriteTokens) + '</td>' +
          '<td>' + tokenCell(usage.outputTokens) + '</td>' +
          '<td class="detail-col">' + tokenCell(usage.reasoningOutputTokens) + '</td>' +
          '<td>' + tokenCell(usage.totalTokens, true) + '</td>' +
          '<td><strong>' + escapeHtml(costText(cost)) + '</strong></td>' +
          '<td class="detail-col usage-source">' + costDetail + (cost.unknownModels.size ? '<br /><span class="warning">部分未定價</span>' : '') + '</td>' +
          '<td class="detail-col">' + integerFmt.format(session.lineCount) + '<span class="usage-source">' + invalid + duplicate + '</span></td>' +
        '</tr>';
      }).join('');

      $('empty').hidden = sessions.length !== 0;
      state.filtered = { sessions, totals, totalCost, range };
    }

    function updateRangeControls() {
      const mode = $('rangeMode').value;
      document.querySelectorAll('.range-control').forEach((element) => {
        element.hidden = element.dataset.range !== mode;
      });
      render();
    }

    function initialiseInputs() {
      const now = new Date();
      $('monthInput').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      $('weekInput').value = isoWeekValue(now);
      $('yearInput').value = String(now.getFullYear());
      const start = new Date(now); start.setDate(start.getDate() - 7);
      $('customStart').value = localDateTimeValue(start);
      $('customEnd').value = localDateTimeValue(now);
      updateRangeControls();
    }

    async function load() {
      const button = $('refresh');
      button.disabled = true;
      button.textContent = '解析中…';
      try {
        const response = await fetch('/api/summary', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Request failed');
        state.data = payload;
        renderPricing();
        render();
      } catch (error) {
        $('info').classList.add('status-error');
        $('info').textContent = error instanceof Error ? error.message : String(error);
        $('rows').innerHTML = '';
        $('empty').hidden = false;
        $('empty').textContent = '無法載入 Codex sessions。';
      } finally {
        button.disabled = false;
        button.textContent = '重新解析 JSONL';
      }
    }

    $('search').addEventListener('input', render);
    $('sort').addEventListener('change', render);
    $('unit').addEventListener('change', render);
    $('rangeMode').addEventListener('change', updateRangeControls);
    for (const id of ['weekInput', 'monthInput', 'yearInput', 'customStart', 'customEnd']) $(id).addEventListener('change', render);
    $('showExact').addEventListener('change', () => document.body.classList.toggle('show-exact', $('showExact').checked));
    $('showDetails').addEventListener('change', () => document.body.classList.toggle('show-details', $('showDetails').checked));
    $('refresh').addEventListener('click', load);
    initialiseInputs();
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(HTML),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(HTML);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/summary') {
      jsonResponse(res, 200, await buildSummary());
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
