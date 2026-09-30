import assert from 'node:assert/strict';
import test from 'node:test';
import { PRICING } from '../server/pricing.mjs';
import { zeroUsage } from '../server/usage.mjs';
import { buildDashboardPayload, buildSessionsPayload, buildExport } from '../server/dashboard-data.mjs';
import { projectionIdentity, requireProjection } from '../server/projection.mjs';
import { createProjectionCache, mergeSessionPage, projectionParameters } from '../public/scripts/projection-cache.mjs';
import { createRequestChannels } from '../public/scripts/request-channels.mjs';

const request = { nowMs: Date.parse('2026-10-01T00:00:00Z'), range: { mode: 'all', timezone: 'UTC', fromMs: null, toMs: null }, q: '', sort: 'recent', offset: 0, limit: 100, filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } };
const usage = { ...zeroUsage(), inputTokens: 1, uncachedInputTokens: 1, totalTokens: 1 };
const summary = { provider: 'codex', pricing: PRICING, generatedAt: '2026-10-01T00:00:00Z', errors: [], sessions: Array.from({ length: 251 }, (_, i) => ({ provider: 'codex', sessionKey: `key${i}`, sessionId: `s${i}`, file: '/TEST_ONLY/file', cwd: '/TEST_ONLY/workspace', model: 'gpt-5.5', invalidLineCount: 0, reconciliation: {}, usageEvents: [{ timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.5', usage }] })) };
const scan = { snapshotVersion: 1 };

test('identity pins time, query, provider, snapshot and calculation basis but excludes pagination', () => {
  const identity = projectionIdentity(summary, request, scan);
  assert.equal(projectionIdentity(summary, { ...request, offset: 200, limit: 5 }, scan).key, identity.key);
  assert.equal(projectionIdentity({ ...summary, pricing: { ...PRICING, checkedAt: 'later' } }, request, scan).key, identity.key);
  for (const other of [projectionIdentity(summary, request, { snapshotVersion: 2 }), projectionIdentity(summary, { ...request, nowMs: request.nowMs + 1 }, scan), projectionIdentity(summary, { ...request, q: 's' }, scan), projectionIdentity({ ...summary, provider: 'claude' }, request, scan), projectionIdentity({ ...summary, pricing: { ...PRICING, unitTokens: 10 } }, request, scan)]) assert.throws(() => requireProjection(identity.key, other), { code: 'PROJECTION_CONFLICT', status: 409 });
  assert.throws(() => requireProjection('bad', identity), { code: 'INVALID_QUERY' });
  requireProjection(null, identity);
  const a = { ...request, filters: { ...request.filters, models: ['a', 'b'] } };
  assert.equal(projectionIdentity(summary, a, scan).key, projectionIdentity(summary, { ...a, filters: { ...a.filters, models: ['b', 'a'] } }, scan).key);
});

test('page merge retains original charts, totals, facets and metadata; conflicts fail closed', () => {
  const dashboard = buildDashboardPayload(summary, request, scan);
  const response = buildSessionsPayload(summary, { ...request, offset: 200 }, scan);
  response.totals.totalTokens = 999; response.facets.models = ['wrong'];
  const merged = mergeSessionPage(dashboard, response);
  assert.equal(merged.sessions.length, 51); assert.equal(merged.totals.totalTokens, 251);
  assert.deepEqual(merged.facets, dashboard.facets); assert.equal(merged.trend, dashboard.trend);
  assert.throws(() => mergeSessionPage(dashboard, buildSessionsPayload(summary, request, { snapshotVersion: 2 })), { code: 'PROJECTION_CONFLICT' });
  const params = projectionParameters('offset=200', dashboard.projection);
  assert.equal(params.get('projection'), dashboard.projection.key); assert.equal(params.get('projectionAt'), String(request.nowMs));
});

test('export selects every matching Session independent of offset and page limit', () => {
  const dashboard = buildDashboardPayload(summary, { ...request, offset: 200, limit: 1 }, scan, { exportAllSessions: true });
  const csv = buildExport('csv-sessions', dashboard);
  assert.equal(csv.body.split('\r\n').length, 252); assert.equal(csv.metadata.exportedSessionCount, 251);
  assert.equal(new Set(dashboard.sessions.map((s) => s.sessionKey)).size, 251);
  const filtered = buildDashboardPayload(summary, { ...request, q: 's250', sort: 'total', offset: 200 }, scan, { exportAllSessions: true });
  assert.equal(filtered.sessions.length, 1); assert.equal(filtered.totals.totalTokens, 1);
});

test('all formats include bounds, filters and version; CSV protects appended cells and redacts paths', () => {
  const selected = { ...request, q: '+s', range: { mode: 'custom', timezone: 'UTC', fromMs: Date.parse('2026-09-01'), toMs: Date.parse('2026-09-02') } };
  const malicious = { ...summary, sessions: [{ ...summary.sessions[0], sessionId: '+s', cwd: '/TEST_ONLY/secret/workspace' }] };
  const dashboard = buildDashboardPayload(malicious, selected, scan, { exportAllSessions: true });
  const json = JSON.parse(buildExport('json-report', dashboard).body);
  assert.equal(json.metadata.projection.query.q, '+s'); assert.equal(json.metadata.range.fromMs, selected.range.fromMs);
  assert.match(buildExport('markdown-summary', dashboard).body, new RegExp(String(selected.range.toMs)));
  for (const format of ['csv-sessions', 'csv-trend']) {
    const output = buildExport(format, dashboard); assert.match(output.body, /snapshotVersion/); assert.match(output.body, /pricingSource/); assert.match(output.body, /"'\+s"/); assert.ok(!output.body.includes('/TEST_ONLY/'));
  }
});

test('cache evicts stale provider versions while preserving other providers', () => {
  const cache = createProjectionCache(); const identity = projectionIdentity(summary, request, scan);
  cache.set('old', { projection: identity }); cache.set('claude', { projection: { ...identity, provider: 'claude' } });
  cache.set('new', { projection: { ...identity, snapshotVersion: 2 } });
  assert.equal(cache.get('old'), null); assert.ok(cache.get('claude')); assert.ok(cache.get('new'));
  cache.set('restart', { projection: { ...identity, epoch: 'new-process', snapshotVersion: 2 } });
  assert.equal(cache.get('new'), null);
});

test('a server restart cannot reuse an old identity at the same version and clock', async () => {
  const restarted = await import('../server/projection.mjs?phase4-restart');
  const prior = projectionIdentity(summary, request, scan);
  const current = restarted.projectionIdentity(summary, request, scan);
  assert.notEqual(prior.epoch, current.epoch);
  assert.throws(() => requireProjection(prior.key, current), { code: 'PROJECTION_CONFLICT' });
});

test('superseded errors cannot affect current state and JSON exports are downloadable blobs', async () => {
  const pending = []; const channels = createRequestChannels(() => new Promise((resolve) => pending.push(resolve)));
  const old = channels.request('export', '/old', { responseType: 'blob' });
  const current = channels.request('export', '/new', { responseType: 'blob' });
  pending[0](new Response(JSON.stringify({ error: { code: 'PROJECTION_CONFLICT' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
  assert.equal((await old).stale, true);
  pending[1](new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  assert.equal(await (await current).payload.text(), '{"ok":true}');
  const aborted = channels.request('detail', '/detail'); channels.destroy();
  pending[2](new Response('{}', { headers: { 'content-type': 'application/json' } })); assert.equal((await aborted).stale, true);
});

test('empty CSV preserves header-only compatibility while reports retain complete query scope', () => {
  const query = { ...request, q: 'no-matches' };
  const dashboard = buildDashboardPayload(summary, query, scan, { exportAllSessions: true });
  for (const format of ['csv-sessions', 'csv-trend']) assert.equal(buildExport(format, dashboard).body.split('\r\n').length, 1);
  const report = JSON.parse(buildExport('json-report', dashboard).body);
  assert.equal(report.metadata.matchedSessionCount, 0); assert.equal(report.metadata.projection.query.q, 'no-matches');
  assert.match(buildExport('markdown-summary', dashboard).body, /no-matches/);
});
