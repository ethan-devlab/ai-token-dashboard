import assert from 'node:assert/strict';
import test from 'node:test';

import { redactPath } from '../public/scripts/drawer.mjs';
import { buildModelBreakdown } from '../public/scripts/model-breakdown.mjs';
import { buildTrendSeries } from '../public/scripts/trend.mjs';
import {
  aggregateSessions,
  deriveSessions,
  filterEvents,
  queryStateFromSearch,
  queryStateToSearch,
  readViewPreferences,
  readViewState,
  resolveRange,
  saveViewPreferences,
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

test('drawer redacts home directories before rendering or copying', () => {
  assert.equal(redactPath('C:\\Users\\fixture\\secret-workspace'), '~/secret-workspace');
  assert.equal(redactPath('/Users/fixture/secret-workspace'), '~/secret-workspace');
  assert.equal(redactPath('2026/07/session.jsonl'), '2026/07/session.jsonl');
});

test('view state records table density and optional Explorer columns', () => {
  const control = (value, checked) => ({ value, checked });
  const view = readViewState({
    unit: control('M'),
    showExact: control('', false),
    showDetails: control('', true),
    trendMetric: control('tokens'),
    density: control('compact'),
    columnLastUsed: control('', false),
    columnModel: control('', true),
    columnInput: control('', false),
    columnOutput: control('', true),
    columnCost: control('', false),
  });

  assert.deepEqual(view, {
    unit: 'M',
    showExact: false,
    showDetails: true,
    trendMetric: 'tokens',
    density: 'compact',
    visibleColumns: { lastUsed: false, model: true, input: false, output: true, cost: false },
  });
});

test('shared query state round-trips through a URL while view preferences stay local', () => {
  const defaults = {
    rangeMode: 'month', weekValue: '2026-W27', monthValue: '2026-07', yearValue: '2026',
    customStart: '', customEnd: '', search: '', sort: 'recent',
  };
  const query = queryStateFromSearch(defaults, '?range=custom&start=2026-07-01T00%3A00&end=2026-07-02T00%3A00&q=alpha&sort=total');
  assert.equal(query.rangeMode, 'custom');
  assert.equal(query.search, 'alpha');
  assert.equal(new URLSearchParams(queryStateToSearch(query)).get('sort'), 'total');

  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(saveViewPreferences(storage, {
    unit: 'M', showExact: false, showDetails: true, trendMetric: 'tokens', density: 'compact',
    visibleColumns: { lastUsed: false, model: true, input: false, output: true, cost: false },
  }), true);
  assert.deepEqual(readViewPreferences(storage), {
    unit: 'M', showExact: false, showDetails: true, trendMetric: 'tokens', density: 'compact',
    visibleColumns: { lastUsed: false, model: true, input: false, output: true, cost: false },
  });
});

test('usage trend aggregates filtered sessions at the requested temporal grain', () => {
  const range = { mode: 'week', fromMs: Date.parse('2026-07-01T00:00:00Z'), toMs: Date.parse('2026-07-08T00:00:00Z') };
  const sessions = deriveSessions(source, { mode: 'all', fromMs: null, toMs: null });
  const trend = buildTrendSeries(sessions, source.pricing, range);

  assert.equal(trend.unit, 'day');
  assert.equal(trend.points.length, 7);
  assert.equal(trend.points.find((point) => point.label === '07/01')?.tokens, 130);
  assert.equal(trend.points.find((point) => point.label === '07/02')?.tokens, 160);
  assert.equal(trend.partialCost, true);
});

test('model breakdown preserves unpriced models as an incomplete cost group', () => {
  const sessions = deriveSessions(source, { mode: 'all', fromMs: null, toMs: null });
  const models = buildModelBreakdown(sessions, source.pricing);
  const known = models.find((item) => item.model === 'gpt-test');
  const unknown = models.find((item) => item.model === 'unknown-test');

  assert.equal(known?.tokens, 190);
  assert.ok((known?.cost || 0) > 0);
  assert.equal(unknown?.tokens, 100);
  assert.equal(unknown?.cost, 0);
  assert.equal(unknown?.partialCost, true);
});
