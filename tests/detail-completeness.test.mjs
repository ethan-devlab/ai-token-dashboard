import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionDetail } from '../server/dashboard-data.mjs';
import { PRICING } from '../server/pricing.mjs';
import { zeroUsage } from '../server/usage.mjs';
import { renderSessionDrawer } from '../public/scripts/drawer.mjs';
import { setLocale } from '../public/scripts/i18n.mjs';

const start = Date.parse('2026-09-01T00:00:00Z');
const request = { nowMs: start + 3600000, range: { mode: 'all', timezone: 'UTC', fromMs: null, toMs: null }, q: '', sort: 'recent', filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], quality: [] } };
function summary(size, mixed = false) {
  return { provider: 'codex', pricing: PRICING, sessions: [{ provider: 'codex', sessionKey: 'detail', sessionId: 'detail', model: 'gpt-5.5', file: '/TEST_ONLY/detail.jsonl', cwd: '/TEST_ONLY/workspace', lineCount: size + 1, invalidLineCount: 0, reconciliation: {}, ...(size === 0 ? { usageObservations: [{ timestamp: new Date(start).toISOString(), model: 'gpt-5.5' }] } : {}), usageEvents: Array.from({ length: size }, (_, index) => ({ timestamp: new Date(start + index * 1000).toISOString(), model: mixed && index % 2 ? 'gpt-5.6-terra' : 'gpt-5.5', source: 'turn', sequence: index, usage: { ...zeroUsage(), inputTokens: 1, uncachedInputTokens: 1, totalTokens: 1 } })) }] };
}

test('detail reports exact zero, limit, and over-limit counts while preserving complete totals and order', () => {
  for (const size of [0, 2000, 2001]) {
    const detail = buildSessionDetail(summary(size), request, 'detail');
    assert.equal(detail.observationCount, size); assert.equal(detail.returnedObservationCount, Math.min(size, 2000)); assert.equal(detail.observationLimit, 2000); assert.equal(detail.observationsTruncated, size > 2000); assert.equal(detail.usage.totalTokens, size);
    if (size) { assert.equal(detail.observations[0].sequence, 0); assert.equal(detail.observations.at(-1).sequence, Math.min(size, 2000) - 1); }
    assert.ok(Math.abs(detail.cost.total - size * 0.000005) < 1e-12);
  }
});

test('detail counts only adopted observations selected by model and exact time bounds', () => {
  const full = summary(2001, true);
  const filtered = { ...request, filters: { ...request.filters, models: ['gpt-5.6-terra'] } };
  const model = buildSessionDetail(full, filtered, 'detail'); assert.equal(model.observationCount, 1000); assert.equal(model.returnedObservationCount, 1000); assert.equal(model.observationsTruncated, false); assert.equal(model.usage.totalTokens, 1000);
  const range = buildSessionDetail(full, { ...filtered, range: { mode: 'custom', timezone: 'UTC', fromMs: start + 1000000, toMs: start + 2000000 } }, 'detail');
  assert.equal(range.observationCount, 500); assert.equal(range.usage.totalTokens, 500); assert.equal(range.observations[0].sequence, 1001); assert.equal(range.observations.at(-1).sequence, 1999);
});

test('drawer distinguishes complete accepted count from clipped response in both languages', () => {
  const detail = buildSessionDetail(summary(2001), request, 'detail');
  setLocale('en'); const english = renderSessionDrawer({ detail, status: 'ready', timezone: 'UTC' });
  assert.match(english, /2,001 accepted observations/); assert.match(english, /contains 2,000 observations \(limit 2,000\)/); assert.match(english, /response is truncated/); assert.match(english, /totals include every accepted observation/);
  setLocale('zh-Hant'); const chinese = renderSessionDrawer({ detail, status: 'ready', timezone: 'UTC' });
  assert.match(chinese, /共 2,001 筆已採納觀測值/); assert.match(chinese, /包含 2,000 筆觀測值（上限 2,000）/); assert.match(chinese, /回應已截斷/);
  setLocale('en'); const complete = renderSessionDrawer({ detail: buildSessionDetail(summary(2000), request, 'detail'), status: 'ready', timezone: 'UTC' }); assert.doesNotMatch(complete, /response is truncated/);
});

test('missing and unsupported total counts remain unknown even when response length is known', () => {
  setLocale('en');
  for (const value of [undefined, null, '', false, '2001', -1, 0.5, Infinity]) {
    const html = renderSessionDrawer({ detail: { observationCount: value, observations: [{}, {}] }, status: 'ready', timezone: 'UTC' });
    assert.match(html, /— accepted observations/); assert.match(html, /contains 2 observations \(limit —\)/); assert.doesNotMatch(html, /response is truncated/);
  }
});
