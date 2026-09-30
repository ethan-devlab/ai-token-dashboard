import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { sessionKey } from './usage.mjs';
import { reconcileSession, selectObservationVersions, validUsage } from './usage-reconciliation.mjs';

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function timestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validCacheDuration(raw) {
  const value = raw.cache_creation;
  return value == null || typeof value === 'object' && !Array.isArray(value) && ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'].every((key) => value[key] === undefined || typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0);
}

function usage(raw = {}) {
  const cacheWrite5mTokens = number(raw.cache_creation?.ephemeral_5m_input_tokens);
  const cacheWrite1hTokens = number(raw.cache_creation?.ephemeral_1h_input_tokens);
  const uncachedInputTokens = number(raw.input_tokens);
  const cachedInputTokens = number(raw.cache_read_input_tokens);
  const detailed = cacheWrite5mTokens + cacheWrite1hTokens;
  const cacheWriteTokens = typeof raw.cache_creation_input_tokens === 'number' && Number.isFinite(raw.cache_creation_input_tokens)
    ? number(raw.cache_creation_input_tokens) : detailed;
  const inconsistent = !validCacheDuration(raw) || detailed > cacheWriteTokens;
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheWriteTokens;
  const outputTokens = number(raw.output_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    cacheWrite5mTokens: inconsistent ? 0 : cacheWrite5mTokens,
    cacheWrite1hTokens: inconsistent ? 0 : cacheWrite1hTokens,
    uncachedInputTokens,
    outputTokens,
    reasoningOutputTokens: number(raw.output_tokens_details?.thinking_tokens),
    totalTokens: inputTokens + outputTokens,
  };
}

function toolUse(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .map(([key, value]) => [key, value]));
}

function sessionShape(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const marker = '/subagents/';
  const position = normalized.indexOf(marker);
  if (position < 0) return { executionType: 'main', parentSessionKey: null, agentId: null };
  const parentStem = normalized.slice(0, position);
  return {
    executionType: 'subagent',
    parentSessionKey: sessionKey('claude', `${parentStem}.jsonl`),
    agentId: path.posix.basename(normalized, '.jsonl'),
  };
}

export async function parseClaudeSessionFile(filePath, relativePath) {
  const fileStat = await stat(filePath);
  const metadata = { sessionId: null, cwd: null, model: null, cliVersion: null, gitBranch: null, entrypoint: null };
  const observations = [];
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
    const observedAt = timestamp(event?.timestamp);
    if (observedAt) { firstTimestamp ||= observedAt; lastTimestamp = observedAt; }
    metadata.sessionId ||= event?.sessionId ?? null;
    metadata.cwd ||= event?.cwd ?? null;
    metadata.cliVersion ||= event?.version ?? null;
    metadata.gitBranch ||= event?.gitBranch ?? null;
    metadata.entrypoint ||= event?.entrypoint ?? null;
    if (event?.type !== 'assistant' || !event?.message?.usage) continue;
    const model = typeof event.message.model === 'string' ? event.message.model : null;
    metadata.model = model || metadata.model;
    const identity = typeof event.message.id === 'string' && event.message.id ? event.message.id : null;
    const rawUsage = event.message.usage;
    observations.push({
      valid: validUsage(rawUsage, ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) && (validCacheDuration(rawUsage) || typeof rawUsage.cache_creation_input_tokens === 'number'),
      file: relativePath,
      identity,
      timestamp: observedAt || lastTimestamp || fileStat.mtime.toISOString(),
      timestampEstimated: !observedAt,
      model,
      source: 'assistant',
      sequence: lineCount,
      usage: usage(rawUsage),
      cacheWriteInconsistent: !validCacheDuration(rawUsage) || Boolean(typeof rawUsage.cache_creation_input_tokens === 'number' && rawUsage.cache_creation && number(rawUsage.cache_creation_input_tokens) !== number(rawUsage.cache_creation.ephemeral_5m_input_tokens) + number(rawUsage.cache_creation.ephemeral_1h_input_tokens)),
      pricingModifiers: {
        inferenceGeo: event.message.usage.inference_geo ?? null,
        speed: event.message.usage.speed ?? null,
        serviceTier: event.message.usage.service_tier ?? null,
      },
      serverToolUse: toolUse(event.message.usage.server_tool_use),
    });
  }

  const selected = selectObservationVersions(observations);
  selected.observations.sort((left, right) => left.sequence - right.sequence);
  const shape = sessionShape(relativePath);
  return reconcileSession({
    provider: 'claude',
    file: relativePath,
    sessionKey: sessionKey('claude', relativePath),
    sessionId: metadata.sessionId || path.basename(filePath, path.extname(filePath)),
    id: metadata.sessionId,
    sessionIdentity: typeof metadata.sessionId === 'string' && metadata.sessionId ? metadata.sessionId : null,
    contentHash: hash.digest('hex'),
    usageObservations: observations,
    cwd: metadata.cwd,
    model: metadata.model,
    modelProvider: 'anthropic',
    originator: metadata.entrypoint,
    cliVersion: metadata.cliVersion,
    gitBranch: metadata.gitBranch,
    entrypoint: metadata.entrypoint,
    ...shape,
    firstTimestamp,
    lastTimestamp,
    modifiedAt: fileStat.mtime.toISOString(),
    sizeBytes: fileStat.size,
    lineCount,
    invalidLineCount,
    usageSource: 'assistant',
  }, selected.observations, { duplicate: selected.duplicate, invalidUsage: selected.invalidUsage });
}
