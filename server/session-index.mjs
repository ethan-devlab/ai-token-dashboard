import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { Worker } from 'node:worker_threads';
import { addUsage, sessionKey, USAGE_KEYS, zeroUsage } from './usage.mjs';

const ZERO_USAGE = Object.freeze(zeroUsage());

function number(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0; }
function usage(raw = {}) {
  const inputTokens = number(raw.input_tokens ?? raw.inputTokens);
  const cachedInputTokens = number(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cachedInputTokens);
  const outputTokens = number(raw.output_tokens ?? raw.outputTokens);
  return { inputTokens, cachedInputTokens, cacheWriteTokens: number(raw.cache_write_tokens ?? raw.cacheWriteTokens), cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens), outputTokens, reasoningOutputTokens: number(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens), totalTokens: number(raw.total_tokens ?? raw.totalTokens) || inputTokens + outputTokens };
}
function add(left, right) { return addUsage({ ...left }, right); }
function delta(current, previous) {
  const inputTokens = Math.max(0, current.inputTokens - previous.inputTokens);
  const cachedInputTokens = Math.max(0, current.cachedInputTokens - previous.cachedInputTokens);
  const outputTokens = Math.max(0, current.outputTokens - previous.outputTokens);
  const reported = current.totalTokens - previous.totalTokens;
  return { inputTokens, cachedInputTokens, cacheWriteTokens: Math.max(0, current.cacheWriteTokens - previous.cacheWriteTokens), cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens), outputTokens, reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens), totalTokens: reported > 0 ? reported : inputTokens + outputTokens, reportedTotalInvalid: reported < 0 };
}
function zero(value) { return USAGE_KEYS.every((key) => value[key] === 0); }
function timestamp(event) {
  const value = event?.timestamp ?? event?.created_at ?? event?.createdAt ?? event?.payload?.timestamp;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function eventModel(event) { return event?.payload?.model ?? event?.payload?.model_name ?? event?.model ?? event?.model_name ?? null; }
function cumulativeUsage(event) {
  if (event?.type === 'event_msg' && event.payload?.type === 'token_count') return event.payload?.info?.total_token_usage ? usage(event.payload.info.total_token_usage) : null;
  return event?.type === 'token_count' && event.info?.total_token_usage ? usage(event.info.total_token_usage) : null;
}
function turnUsage(event) {
  if (event?.type === 'turn.completed') return event.usage ? usage(event.usage) : null;
  return event?.type === 'turn_completed' && event.payload?.usage ? usage(event.payload.usage) : null;
}
function covers(left, right) { return ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens'].every((key) => left[key] >= right[key]); }

export async function parseSessionFile(filePath, relativePath) {
  const fileStat = await stat(filePath);
  const metadata = { id: null, cwd: null, model: null, modelProvider: null, originator: null, cliVersion: null };
  const diagnostics = { cumulativeSeen: 0, turnSeen: 0, accepted: 0, duplicate: 0, covered: 0, fullReset: 0, partialReset: 0, ambiguous: 0, negativeDelta: 0 };
  const accepted = [];
  const cumulative = [];
  const turns = [];
  let currentModel = null;
  let previous = { ...ZERO_USAGE };
  let firstTimestamp = null;
  let lastTimestamp = null;
  let lineCount = 0;
  let invalidLineCount = 0;
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    lineCount += 1;
    let event;
    try { event = JSON.parse(line); } catch { invalidLineCount += 1; continue; }
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    if (event.type === 'session_meta' || event.type === 'thread.started') {
      metadata.id ||= payload.id ?? payload.session_id ?? payload.thread_id ?? event.id ?? null;
      metadata.cwd ||= payload.cwd ?? payload.working_directory ?? null;
      metadata.model ||= payload.model ?? payload.model_name ?? null;
      metadata.modelProvider ||= payload.model_provider ?? payload.provider ?? null;
      metadata.originator ||= payload.originator ?? payload.source ?? null;
      metadata.cliVersion ||= payload.cli_version ?? payload.version ?? null;
    }
    currentModel = eventModel(event) || currentModel || metadata.model;
    const observedAt = timestamp(event);
    if (observedAt) { firstTimestamp ||= observedAt; lastTimestamp = observedAt; }
    const observationTimestamp = observedAt || lastTimestamp || fileStat.mtime.toISOString();
    const model = currentModel || metadata.model || null;
    const cumulativeValue = cumulativeUsage(event);
    if (cumulativeValue) {
      diagnostics.cumulativeSeen += 1;
      const decreased = ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens'].filter((key) => cumulativeValue[key] < previous[key]);
      if (decreased.length) {
        if (decreased.length === 5) diagnostics.fullReset += 1; else diagnostics.partialReset += 1;
        previous = { ...ZERO_USAGE };
      }
      const next = delta(cumulativeValue, previous);
      if (next.reportedTotalInvalid) diagnostics.negativeDelta += 1;
      delete next.reportedTotalInvalid;
      if (zero(next)) diagnostics.duplicate += 1;
      else {
        const item = { timestamp: observationTimestamp, timestampEstimated: !observedAt, model, source: 'cumulative', sequence: lineCount, usage: next };
        cumulative.push(item); accepted.push(item); diagnostics.accepted += 1;
      }
      previous = cumulativeValue;
      continue;
    }
    const turn = turnUsage(event);
    if (!turn) continue;
    diagnostics.turnSeen += 1;
    turns.push({ timestamp: observationTimestamp, timestampEstimated: !observedAt, model, source: 'turn', sequence: lineCount, usage: turn });
  }
  for (const turn of turns) {
    if (cumulative.some((item) => covers(item.usage, turn.usage))) { diagnostics.covered += 1; continue; }
    if (cumulative.some((item) => item.usage.totalTokens >= turn.usage.totalTokens || turn.usage.totalTokens === 0)) diagnostics.ambiguous += 1;
    accepted.push(turn); diagnostics.accepted += 1;
  }
  accepted.sort((left, right) => left.sequence - right.sequence);
  const total = accepted.reduce((sum, item) => add(sum, item.usage), { ...ZERO_USAGE });
  return { provider: 'codex', executionType: 'main', parentSessionKey: null, agentId: null, file: relativePath, sessionKey: sessionKey('codex', relativePath), sessionId: metadata.id || path.basename(filePath, path.extname(filePath)), ...metadata, model: metadata.model || currentModel, firstTimestamp, lastTimestamp, modifiedAt: fileStat.mtime.toISOString(), sizeBytes: fileStat.size, lineCount, invalidLineCount, tokenCountEventCount: diagnostics.cumulativeSeen, duplicateTokenCountEventCount: diagnostics.duplicate, cumulativeResetCount: diagnostics.fullReset + diagnostics.partialReset, turnUsageEventCount: diagnostics.turnSeen, usageSource: diagnostics.cumulativeSeen ? 'reconciled' : diagnostics.turnSeen ? 'turn' : 'not_found', usage: total, usageEvents: accepted, reconciliation: diagnostics };
}

async function discover(root, maxFiles) {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`Sessions directory does not exist: ${root}.`);
  const files = [];
  async function walk(directory) {
    if (files.length >= maxFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= maxFiles || entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        const fileStat = await stat(fullPath);
        files.push({ filePath: fullPath, relativePath: path.relative(root, fullPath).split(path.sep).join('/'), fingerprint: `${fileStat.size}:${fileStat.mtimeMs}` });
      }
    }
  }
  await walk(root);
  return files;
}

function parseBatchInWorker(entries, provider) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./session-parser-worker.mjs', import.meta.url), { workerData: { entries, provider } });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    worker.once('message', (message) => {
      if (settled) return;
      settled = true;
      resolve(message.results);
    });
    worker.once('error', fail);
    worker.once('exit', (code) => { if (!settled && code !== 0) fail(new Error(`Session parser worker exited with code ${code}.`)); });
  });
}

async function parseChangedEntries(entries, concurrency, provider) {
  if (!entries.length) return [];
  const batches = Array.from({ length: Math.min(concurrency, entries.length) }, () => []);
  entries.forEach((entry, index) => batches[index % batches.length].push({ entry, index }));
  return (await Promise.all(batches.map((batch) => parseBatchInWorker(batch, provider)))).flat().sort((left, right) => left.index - right.index);
}

export function createSessionIndex({ provider = 'codex', sessionsDirectory, maxFiles, parseConcurrency, pricing, now = () => new Date() }) {
  let index = new Map();
  const currentPricing = () => typeof pricing === 'function' ? pricing() : pricing;
  return Object.freeze({
    async refresh() {
      const discoveryStarted = Date.now();
      const discovered = await discover(sessionsDirectory, maxFiles);
      const next = new Map();
      const scan = { added: 0, changed: 0, reused: 0, deleted: 0, failed: 0, discoveryDurationMs: Date.now() - discoveryStarted, parseDurationMs: 0, aggregateDurationMs: 0 };
      const changed = [];
      for (const entry of discovered) {
        const previous = index.get(entry.relativePath);
        if (previous?.fingerprint === entry.fingerprint) { next.set(entry.relativePath, previous); scan.reused += 1; }
        else { changed.push(entry); previous ? scan.changed += 1 : scan.added += 1; }
      }
      scan.deleted = [...index.keys()].filter((key) => !next.has(key) && !changed.some((entry) => entry.relativePath === key)).length;
      const parsingStarted = Date.now();
      let parsed;
      try { parsed = await parseChangedEntries(changed, parseConcurrency, provider); }
      catch (error) { throw new Error(`Session parser worker failed: ${error instanceof Error ? error.message : String(error)}`); }
      scan.parseDurationMs = Date.now() - parsingStarted;
      scan.failed = parsed.filter((item) => item.error).length;
      for (const item of parsed) if (item.session) next.set(item.entry.relativePath, { fingerprint: item.entry.fingerprint, session: item.session });
      const aggregateStarted = Date.now();
      const sessions = [...next.values()].map((item) => item.session).sort((left, right) => (Date.parse(right.lastTimestamp || right.modifiedAt) || 0) - (Date.parse(left.lastTimestamp || left.modifiedAt) || 0) || left.file.localeCompare(right.file));
      const totals = sessions.reduce((sum, session) => add(sum, session.usage), { ...ZERO_USAGE });
      scan.aggregateDurationMs = Date.now() - aggregateStarted;
      index = next;
      return { provider, generatedAt: now().toISOString(), durationMs: scan.discoveryDurationMs + scan.parseDurationMs + scan.aggregateDurationMs, sessionsDirectory, scannedFileCount: discovered.length, parsedSessionCount: sessions.length, maxFiles, truncated: discovered.length >= maxFiles, totals, pricing: currentPricing(), sessions, errors: parsed.filter((item) => item.error).map((item) => ({ file: item.entry.relativePath, message: item.error })), scan };
    },
  });
}
