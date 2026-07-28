import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateSessions,
  deriveSessions,
  filterEvents,
  resolveRange,
  selectExplorerSessions,
} from '../public/scripts/state.mjs';

function usage(inputTokens, cachedInputTokens, outputTokens) {
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens: 0,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + outputTokens,
  };
}

const source = {
  pricing: {
    unitTokens: 1_000_000,
    rates: { 'gpt-test': { input: 1, cachedInput: 0.1, cacheWrite: null, output: 2 } },
  },
  sessions: [
    {
      sessionId: 'alpha', file: 'alpha.jsonl', model: 'gpt-test', usageEvents: [
        { timestamp: '2026-07-01T00:00:00Z', model: 'gpt-test', usage: usage(100, 20, 30) },
        { timestamp: '2026-07-02T00:00:00Z', model: 'gpt-test', usage: usage(50, 0, 10) },
      ],
    },
    {
      sessionId: 'beta', file: 'beta.jsonl', model: 'unknown-test', usageEvents: [
        { timestamp: '2026-07-02T00:00:00Z', model: 'unknown-test', usage: usage(80, 0, 20) },
      ],
    },
  ],
};

test('custom range validation keeps invalid bounds out of filtering', () => {
  const invalid = resolveRange({ rangeMode: 'custom', customStart: '2026-07-03T00:00', customEnd: '2026-07-02T00:00' });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.end, /晚於/);

  const range = { mode: 'custom', fromMs: Date.parse('2026-07-01T00:00:00Z'), toMs: Date.parse('2026-07-02T00:00:00Z') };
  assert.equal(filterEvents(source.sessions[0], range).length, 1);
});

test('explorer search does not change range totals or pricing completeness', () => {
  const range = { mode: 'all', fromMs: null, toMs: null };
  const sessions = deriveSessions(source, range);
  const aggregate = aggregateSessions(sessions);
  const explorer = selectExplorerSessions(sessions, { search: 'alpha', sort: 'recent' });

  assert.equal(aggregate.usage.totalTokens, 290);
  assert.equal(aggregate.cost.unknownModels.has('unknown-test'), true);
  assert.equal(explorer.length, 1);
  assert.equal(explorer[0].sessionId, 'alpha');
});
