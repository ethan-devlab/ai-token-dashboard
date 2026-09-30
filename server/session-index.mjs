import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { Worker } from 'node:worker_threads';
import { addUsage, sessionKey, zeroUsage } from './usage.mjs';
import { reconcileSession, reconcileSessionFiles, selectObservationVersions, validUsage } from './usage-reconciliation.mjs';

const ZERO_USAGE = Object.freeze(zeroUsage());

function number(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0; }
function usage(raw = {}) {
  const inputTokens = number(raw.input_tokens ?? raw.inputTokens);
  const cachedInputTokens = number(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cachedInputTokens);
  const outputTokens = number(raw.output_tokens ?? raw.outputTokens);
  const cacheWriteTokens = number(raw.cache_write_tokens ?? raw.cacheWriteTokens);
  return { inputTokens, cachedInputTokens, cacheWriteTokens, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens), outputTokens, reasoningOutputTokens: number(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens), totalTokens: number(raw.total_tokens ?? raw.totalTokens) || inputTokens + outputTokens };
}
function add(left, right) { return addUsage({ ...left }, right); }
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

export async function parseSessionFile(filePath, relativePath) {
  const fileStat = await stat(filePath);
  const metadata = { id: null, cwd: null, model: null, modelProvider: null, originator: null, cliVersion: null };
  const observations = [];
  let currentModel = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let lineCount = 0;
  let invalidLineCount = 0;
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  input.on('data', (chunk) => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    lineCount += 1;
    let event;
    try { event = JSON.parse(line); } catch { invalidLineCount += 1; continue; }
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    if (event.type === 'session_meta' || event.type === 'thread.started') {
      metadata.id ||= payload.id ?? payload.session_id ?? payload.thread_id ?? event.thread_id ?? event.session_id ?? event.id ?? null;
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
    const turn = cumulativeValue ? null : turnUsage(event);
    if (!cumulativeValue && !turn) continue;
    // Session, turn, and context IDs group records; they are not unique usage IDs.
    const explicitId = event.event_id ?? payload.event_id ?? event.usage_id ?? payload.usage_id ?? (cumulativeValue ? event.id : null);
    const rawUsage = cumulativeValue ? (event.payload?.info?.total_token_usage ?? event.info?.total_token_usage) : (event.usage ?? payload.usage);
    const valid = validUsage(rawUsage, ['input_tokens', 'inputTokens', 'output_tokens', 'outputTokens', 'total_tokens', 'totalTokens', 'cached_input_tokens', 'cachedInputTokens', 'cache_read_input_tokens', 'cache_write_tokens', 'cacheWriteTokens', 'reasoning_output_tokens', 'reasoningOutputTokens']);
    observations.push({ valid, file: relativePath, identity: typeof explicitId === 'string' && explicitId ? explicitId : null, timestamp: observationTimestamp, timestampEstimated: !observedAt, model, source: cumulativeValue ? 'cumulative' : 'turn', sequence: lineCount, usage: cumulativeValue || turn });
  }
  const selected = selectObservationVersions(observations);
  selected.observations.sort((left, right) => left.sequence - right.sequence);
  return reconcileSession({ provider: 'codex', executionType: 'main', parentSessionKey: null, agentId: null, file: relativePath, sessionKey: sessionKey('codex', relativePath), sessionId: metadata.id || path.basename(filePath, path.extname(filePath)), ...metadata, sessionIdentity: typeof metadata.id === 'string' && metadata.id ? metadata.id : null, contentHash: hash.digest('hex'), usageObservations: observations, model: metadata.model || currentModel, firstTimestamp, lastTimestamp, modifiedAt: fileStat.mtime.toISOString(), sizeBytes: fileStat.size, lineCount, invalidLineCount, usageSource: observations.some((item) => item.source === 'cumulative') ? 'reconciled' : observations.length ? 'turn' : 'not_found' }, selected.observations, { duplicate: selected.duplicate, invalidUsage: selected.invalidUsage });
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
  let confirmedVersions = new Map();
  let canonicalOwners = new Set();
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
      const reconciled = reconcileSessionFiles([...next.values()].map((item) => item.session), confirmedVersions, canonicalOwners);
      const sessions = reconciled.sessions.sort((left, right) => (Date.parse(right.lastTimestamp || right.modifiedAt) || 0) - (Date.parse(left.lastTimestamp || left.modifiedAt) || 0) || left.file.localeCompare(right.file));
      const totals = sessions.reduce((sum, session) => add(sum, session.usage), { ...ZERO_USAGE });
      scan.aggregateDurationMs = Date.now() - aggregateStarted;
      index = next;
      confirmedVersions = reconciled.versions;
      canonicalOwners = new Set(sessions.map((session) => session.sessionKey));
      return { provider, generatedAt: now().toISOString(), durationMs: scan.discoveryDurationMs + scan.parseDurationMs + scan.aggregateDurationMs, sessionsDirectory, scannedFileCount: discovered.length, parsedSessionCount: sessions.length, maxFiles, truncated: discovered.length >= maxFiles, totals, pricing: currentPricing(), sessions, errors: parsed.filter((item) => item.error).map((item) => ({ file: item.entry.relativePath, message: item.error })), scan };
    },
  });
}
