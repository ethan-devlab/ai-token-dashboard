import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketFor, comparisonRanges, nextBucketFor, resolveRange } from '../server/timezone.mjs';
import { buildDashboardPayload } from '../server/dashboard-data.mjs';
import { PRICING } from '../server/pricing.mjs';
import { zeroUsage } from '../server/usage.mjs';
import { createDashboardState, customRangeError, queryStateFromSearch, queryStateToSearch, requestParameters } from '../public/scripts/state.mjs';
import { createRequestChannels } from '../public/scripts/request-channels.mjs';

const ms = Date.parse;
const utc = (input) => resolveRange({ timezone: 'UTC', ...input });
const rejects = (input) => assert.throws(() => utc(input), { code: 'INVALID_RANGE' });
const bounds = (range, from, to) => assert.deepEqual([range.fromMs, range.toMs], [ms(from), ms(to)]);
const filters = { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] };

test('historical ISO weeks use their week year, including year rollover and valid W53', () => {
  bounds(utc({ mode: 'week', period: '2026-W01' }), '2025-12-29T00:00Z', '2026-01-05T00:00Z');
  bounds(utc({ mode: 'week', period: '2026-W53' }), '2026-12-28T00:00Z', '2027-01-04T00:00Z');
  for (const period of ['2025-W53', '2026-W00', '2026-W54', '2026-01', '0000-W01']) rejects({ mode: 'week', period });
  bounds(resolveRange({ mode: 'week', period: '2026-W01', timezone: 'Asia/Taipei' }), '2025-12-28T16:00Z', '2026-01-04T16:00Z');
});
test('period formats are mode-specific; impossible months and dates do not normalize', () => {
  for (const [mode, period] of [['month', '2026-13'], ['month', '2026'], ['year', '2026-01'], ['today', '2026'], ['all', '2026-W01']]) rejects({ mode, period });
  for (const start of ['2026-02-31T00:00', '2025-02-29T00:00', '2026-04-31T00:00', '2026-00-01T00:00', '2026-01-01T24:00', '0000-01-01T00:00']) rejects({ mode: 'custom', start, end: '2027-01-01T00:00' });
  bounds(utc({ mode: 'custom', start: '2024-02-29T00:00', end: '2024-03-01T00:00' }), '2024-02-29T00:00Z', '2024-03-01T00:00Z');
  bounds(utc({ mode: 'custom', start: '0099-01-01T00:00', end: '0099-01-02T00:00' }), '0099-01-01T00:00Z', '0099-01-02T00:00Z');
});
test('ambiguous and nonexistent custom times are rejected while exact fold intervals survive', () => {
  for (const start of ['2026-11-01T01:30', '2026-03-08T02:30']) rejects({ mode: 'custom', timezone: 'America/New_York', start, end: '2026-11-02T00:00' });
  const range = resolveRange({ mode: 'custom', timezone: 'America/New_York', fromMs: ms('2026-11-01T06:00Z'), toMs: ms('2026-11-01T07:00Z'), start: '2026-11-01T01:00', end: '2026-11-01T02:00' });
  bounds(range, '2026-11-01T06:00Z', '2026-11-01T07:00Z');
  const query = queryStateFromSearch(createDashboardState().query, `?range=custom&timezone=America/New_York&from=${range.fromMs}&to=${range.toMs}`);
  const roundtrip = queryStateFromSearch(createDashboardState().query, `?${queryStateToSearch(query)}`);
  assert.deepEqual(roundtrip.intervalBounds, [range.fromMs, range.toMs]);
  assert.equal(requestParameters(query).get('from'), String(range.fromMs));
  assert.equal(customRangeError(query), '');
});
test('UTC millisecond bounds reject invalid Date instants and inverted intervals', () => {
  for (const fromMs of [8_640_000_000_000_001, -8_640_000_000_000_001, Infinity, 1.5]) rejects({ mode: 'all', fromMs });
  rejects({ mode: 'custom', fromMs: 2, toMs: 1 });
  assert.equal(utc({ mode: 'custom', fromMs: 0, toMs: 1 }).fromMs, 0);
});
test('New York fold hours have separate non-overlapping bounds and spring skips the missing hour', () => {
  for (const [at, from, to] of [
    ['2026-11-01T05:30Z', '2026-11-01T05:00Z', '2026-11-01T06:00Z'],
    ['2026-11-01T06:30Z', '2026-11-01T06:00Z', '2026-11-01T07:00Z'],
    ['2026-03-08T06:30Z', '2026-03-08T06:00Z', '2026-03-08T07:00Z'],
    ['2026-03-08T07:30Z', '2026-03-08T07:00Z', '2026-03-08T08:00Z'],
  ]) { const start = bucketFor(ms(at), 'hour', 'America/New_York'); bounds({ fromMs: start, toMs: nextBucketFor(start, 'hour', 'America/New_York') }, from, to); }
  for (const [nowMs, length] of [['2026-03-08T12:00Z', 23], ['2026-11-01T12:00Z', 25]]) {
    const range = resolveRange({ mode: 'today', timezone: 'America/New_York', nowMs: ms(nowMs) }); assert.equal((range.toMs - range.fromMs) / 3_600_000, length);
  }
});
test('half-hour transitions and midnight gaps keep actual bucket bounds', () => {
  for (const [at, from, to] of [
    ['2026-04-04T14:45Z', '2026-04-04T14:00Z', '2026-04-04T15:00Z'],
    ['2026-04-04T15:15Z', '2026-04-04T15:00Z', '2026-04-04T15:30Z'],
    ['2026-10-03T15:45Z', '2026-10-03T15:30Z', '2026-10-03T16:00Z'],
  ]) { const start = bucketFor(ms(at), 'hour', 'Australia/Lord_Howe'); bounds({ fromMs: start, toMs: nextBucketFor(start, 'hour', 'Australia/Lord_Howe') }, from, to); }
  bounds(resolveRange({ mode: 'today', timezone: 'America/Santiago', nowMs: ms('2026-09-06T16:00Z') }), '2026-09-06T04:00Z', '2026-09-07T03:00Z');
});
test('completed months and years compare full prior calendar periods instead of equal milliseconds', () => {
  for (const [mode, period, from, to] of [['month', '2026-03', '2026-02-01T00:00Z', '2026-03-01T00:00Z'], ['year', '2025', '2024-01-01T00:00Z', '2025-01-01T00:00Z']]) {
    const range = utc({ mode, period }); const comparison = comparisonRanges(range, ms('2026-10-01T00:00Z')); bounds(comparison.range, from, to); assert.equal(comparison.partial, false); assert.equal(comparison.currentRange.toMs, range.toMs);
  }
});
test('current calendar comparison aligns local progress and preserves milliseconds across DST', () => {
  const now = ms('2026-03-10T16:30:20.123Z');
  const comparison = comparisonRanges(resolveRange({ mode: 'month', timezone: 'America/New_York', nowMs: now }), now);
  bounds(comparison.range, '2026-02-01T05:00Z', '2026-02-10T17:30:20.123Z');
  assert.equal(comparison.currentRange.toMs, now); assert.equal(comparison.partial, true);
  const day = comparisonRanges(resolveRange({ mode: 'today', timezone: 'America/New_York', nowMs: ms('2026-03-08T16:00Z') }), ms('2026-03-08T16:00Z'));
  bounds(day.range, '2026-03-07T05:00Z', '2026-03-07T17:00Z');
  const weekNow = ms('2026-01-01T12:00Z'); const week = comparisonRanges(utc({ mode: 'week', nowMs: weekNow }), weekNow);
  bounds(week.range, '2025-12-22T00:00Z', '2025-12-25T12:00Z');
});
test('missing previous date uses period end; ambiguous progress disables comparison only', () => {
  for (const [mode, now, to] of [['month', '2026-03-31T12:00Z', '2026-03-01T00:00Z'], ['year', '2024-02-29T12:00Z', '2024-01-01T00:00Z']]) {
    const value = ms(now); assert.equal(comparisonRanges(utc({ mode, nowMs: value }), value).range.toMs, ms(to));
  }
  const now = ms('2026-11-02T06:30Z');
  const comparison = comparisonRanges(resolveRange({ mode: 'today', timezone: 'America/New_York', nowMs: now }), now);
  assert.equal(comparison.available, false); assert.equal(comparison.reason, 'ambiguous-progress');
  assert.equal(comparisonRanges(utc({ mode: 'month', period: '2027-01' }), ms('2026-10-01T00:00Z')).reason, 'not-started');
});
test('custom and last24h comparisons use equal actual duration; all has no comparison', () => {
  for (const range of [utc({ mode: 'custom', fromMs: 1000, toMs: 2500 }), utc({ mode: 'last24h', nowMs: ms('2026-11-01T12:00Z') })]) {
    const comparison = comparisonRanges(range); assert.equal(comparison.basis, 'elapsed'); assert.equal(comparison.range.toMs, range.fromMs); assert.equal(comparison.range.toMs - comparison.range.fromMs, range.toMs - range.fromMs);
  }
  assert.equal(comparisonRanges(utc({ mode: 'all' })), null);
});
function dashboard(events, range, nowMs, models = []) {
  const usageEvents = events.map(([timestamp, tokens, model = 'gpt-5.6-terra']) => ({ timestamp, model, usage: { ...zeroUsage(), inputTokens: tokens, uncachedInputTokens: tokens, totalTokens: tokens } }));
  return buildDashboardPayload({ pricing: PRICING, sessions: [{ sessionKey: 'fixture', sessionId: 'fixture', file: 'fixture.jsonl', model: 'gpt-5.6-terra', usageEvents, invalidLineCount: 0, reconciliation: {} }], errors: [] }, { range, nowMs, q: '', sort: 'recent', offset: 0, limit: 100, filters: { ...filters, models } }, {});
}
test('comparison totals use both aligned intervals and selected model observations', () => {
  const now = ms('2026-03-10T12:00Z');
  const value = dashboard([['2026-03-05T00:00Z', 20], ['2026-03-05T01:00Z', 999, 'gpt-5.5'], ['2026-03-20T00:00Z', 40], ['2026-02-05T00:00Z', 10], ['2026-02-20T00:00Z', 80]], utc({ mode: 'month', nowMs: now }), now, ['gpt-5.6-terra']);
  assert.equal(value.totals.totalTokens, 60); assert.equal(value.comparison.currentTotals.totalTokens, 20); assert.equal(value.comparison.totals.totalTokens, 10); assert.equal(value.comparison.percentTotalTokens, 100);
});
test('trend repeated hours carry distinct UTC offsets and sum to the selected total', () => {
  const value = dashboard([['2026-11-01T05:30Z', 10], ['2026-11-01T06:30Z', 20]], resolveRange({ mode: 'custom', timezone: 'America/New_York', fromMs: ms('2026-11-01T04:00Z'), toMs: ms('2026-11-02T05:00Z') }));
  assert.equal(value.trend.points.length, 2); assert.notEqual(value.trend.points[0].label, value.trend.points[1].label); assert.match(value.trend.points[0].label, /GMT-4/); assert.match(value.trend.points[1].label, /GMT-5/); assert.equal(value.trend.points.reduce((sum, point) => sum + point.tokens, 0), value.totals.totalTokens);
});
test('client rejects normalized impossible dates and preserves API error codes', async () => {
  assert.equal(customRangeError({ rangeMode: 'custom', customStart: '2026-02-31T00:00', customEnd: '2026-03-05T00:00' }), 'range.invalidDate');
  const channels = createRequestChannels(async () => new Response(JSON.stringify({ error: { code: 'INVALID_RANGE', message: 'Ambiguous local time.' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(channels.request('dashboard', '/fixture'), { code: 'INVALID_RANGE', message: 'Ambiguous local time.' });
});
