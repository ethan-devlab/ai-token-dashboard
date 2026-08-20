import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { addUsage, sessionKey, zeroUsage } from './usage.mjs';

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function timestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function usage(raw = {}) {
  const cacheWrite5mTokens = number(raw.cache_creation?.ephemeral_5m_input_tokens);
  const cacheWrite1hTokens = number(raw.cache_creation?.ephemeral_1h_input_tokens);
  const uncachedInputTokens = number(raw.input_tokens);
  const cachedInputTokens = number(raw.cache_read_input_tokens);
  const cacheWriteTokens = cacheWrite5mTokens + cacheWrite1hTokens;
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheWriteTokens;
  const outputTokens = number(raw.output_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    uncachedInputTokens,
    outputTokens,
    reasoningOutputTokens: number(raw.output_tokens_details?.thinking_tokens),
    totalTokens: inputTokens + outputTokens,
  };
}

function toolUse(raw = {}) {
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
  const diagnostics = { accepted: 0, duplicate: 0, missingIdentity: 0, ambiguous: 0 };
  const observations = new Map();
  let firstTimestamp = null;
  let lastTimestamp = null;
  let lineCount = 0;
  let invalidLineCount = 0;
  const lines = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });

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
    const identity = event.message.id || event.requestId || null;
    if (!identity) diagnostics.missingIdentity += 1;
    const key = identity ? `response:${identity}` : `line:${lineCount}`;
    if (observations.has(key)) diagnostics.duplicate += 1;
    observations.set(key, {
      timestamp: observedAt || lastTimestamp || fileStat.mtime.toISOString(),
      timestampEstimated: !observedAt,
      model,
      source: 'assistant',
      sequence: lineCount,
      usage: usage(event.message.usage),
      pricingModifiers: {
        inferenceGeo: event.message.usage.inference_geo ?? null,
        speed: event.message.usage.speed ?? null,
        serviceTier: event.message.usage.service_tier ?? null,
      },
      serverToolUse: toolUse(event.message.usage.server_tool_use),
    });
  }

  const usageEvents = [...observations.values()].sort((left, right) => left.sequence - right.sequence);
  diagnostics.accepted = usageEvents.length;
  const total = usageEvents.reduce((sum, item) => addUsage(sum, item.usage), zeroUsage());
  const shape = sessionShape(relativePath);
  return {
    provider: 'claude',
    file: relativePath,
    sessionKey: sessionKey('claude', relativePath),
    sessionId: metadata.sessionId || path.basename(filePath, path.extname(filePath)),
    id: metadata.sessionId,
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
    tokenCountEventCount: usageEvents.length,
    duplicateTokenCountEventCount: diagnostics.duplicate,
    cumulativeResetCount: 0,
    turnUsageEventCount: usageEvents.length,
    usageSource: 'assistant',
    usage: total,
    usageEvents,
    reconciliation: diagnostics,
  };
}
