import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CLAUDE_PRICING, PRICING, createPricing, matchPricingRule } from '../server/pricing.mjs';
import { pricingBasis, pricingFromBasis, pricingRevision } from '../server/pricing-basis.mjs';
import { createPricingArchive } from '../server/pricing-archive.mjs';
import { createPricingRefreshService } from '../server/pricing-refresh.mjs';
import { buildDashboardPayload, buildExport, buildSessionDetail } from '../server/dashboard-data.mjs';
import { zeroUsage } from '../server/usage.mjs';
import { renderSessionDrawer } from '../public/scripts/drawer.mjs';
import { setLocale } from '../public/scripts/i18n.mjs';

const at = '2026-10-01T00:00:00Z';
const request = { nowMs: Date.parse(at), range: { mode: 'all', timezone: 'UTC', fromMs: null, toMs: null }, q: '', sort: 'recent', offset: 0, limit: 100, filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], quality: [] } };
const summary = (pricing) => ({ provider: 'codex', pricing, sessions: [{ provider: 'codex', sessionKey: 'fixture', sessionId: 'fixture', model: 'gpt-5.5', reconciliation: {}, invalidLineCount: 0, usageEvents: [{ timestamp: at, model: 'gpt-5.5', usage: { ...zeroUsage(), inputTokens: 10, uncachedInputTokens: 10, totalTokens: 10 } }] }], errors: [] });
async function root(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'ctd-price-archive-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('basis revisions ignore check dates and order, but cover every calculation condition', () => {
  const basis = pricingBasis(CLAUDE_PRICING); const revision = pricingRevision(CLAUDE_PRICING);
  assert.equal(pricingRevision(pricingFromBasis(basis)), revision);
  assert.equal(pricingRevision({ ...CLAUDE_PRICING, checkedAt: at, updatedAt: '2030-01-01', rules: [...CLAUDE_PRICING.rules].reverse() }), revision);
  for (const field of ['source', 'unitTokens', 'costDisclaimer']) { const changed = { ...basis, [field]: field === 'unitTokens' ? 1000 : field === 'source' ? 'https://example.invalid/prices' : 'Changed estimate conditions' }; assert.notEqual(pricingRevision(pricingFromBasis(changed)), revision); }
  for (const change of [(b) => { b.rules[0].rates.input += 1; }, (b) => { b.rules[0].effectiveFrom = '2027-01-01'; }, (b) => { b.rules[0].pattern += '$'; }, (b) => { b.modifiers.fastMultiplier += 1; }]) { const changed = structuredClone(basis); change(changed); assert.notEqual(pricingRevision(pricingFromBasis(changed)), revision); }
});

test('Claude dated hyphen model identifiers use their retained dotted price family', () => {
  assert.equal(matchPricingRule(CLAUDE_PRICING, 'claude-haiku-4-5-20251001').id, 'claude-haiku-4.5');
  assert.equal(matchPricingRule(CLAUDE_PRICING, 'claude-haiku-9-9-20251001'), null);
  assert.equal(matchPricingRule(PRICING, 'claude-haiku-4-5-20251001'), null);
});

test('archives persist immutable bases, separate check times, restart and reject corruption', async (t) => {
  const directory = await root(t); let now = new Date(at);
  const store = createPricingArchive({ directory, provider: 'codex', now: () => now });
  const first = await store.save(PRICING, { origin: 'bundled' });
  now = new Date('2026-10-02T00:00Z'); const second = await store.save({ ...PRICING, updatedAt: '2026-10-02' }, { origin: 'refresh', checkedAt: now.toISOString() });
  assert.equal(first.revision, second.revision); assert.equal(first.firstArchivedAt, second.firstArchivedAt); assert.equal(second.origin, 'bundled'); assert.equal(second.lastCheckedAt, now.toISOString()); assert.equal((await store.list()).total, 1);
  assert.equal((await store.save(PRICING, { origin: 'cache', checkedAt: at })).lastCheckedAt, second.lastCheckedAt);
  const restarted = createPricingArchive({ directory, provider: 'codex' }); assert.deepEqual(await restarted.get(first.revision), second);
  const file = path.join(directory, first.revision + '.json'); const record = JSON.parse(await readFile(file)); record.basis.rules[0].rates.input += 1; await writeFile(file, JSON.stringify(record));
  await assert.rejects(store.get(first.revision), { code: 'ARCHIVE_INVALID' }); await assert.rejects(store.save(PRICING, { origin: 'cache' }), { code: 'ARCHIVE_INVALID' }); assert.equal((await store.list()).items[0].status, 'invalid');
  await assert.rejects(store.get('../anything'), { status: 400 }); await assert.rejects(store.save(CLAUDE_PRICING, { origin: 'cache' }), { code: 'ARCHIVE_INVALID' });
});

test('refresh archives before activation, keeps prior rates on write failure and restores versions after restart', async (t) => {
  const directory = await root(t); const store = createPricingArchive({ directory: path.join(directory, 'archive'), provider: 'codex' }); let fail = false; let input = 7; let now = new Date(at);
  const archiveStore = { ...store, save: (...args) => { if (fail) throw new Error('TEST ONLY disk failure'); return store.save(...args); } };
  const options = { baseline: PRICING, cachePath: path.join(directory, 'cache.json'), archiveStore, now: () => now, fetchImpl: async () => new Response('TEST ONLY', { headers: { 'content-type': 'text/markdown' } }), parseDocument: () => ({ 'gpt-5.5': { input, cachedInput: 0.5, cacheWrite: null, output: 30 } }) };
  const service = createPricingRefreshService(options); await service.initialize(); const initial = service.current();
  await service.refresh({ manual: true }); const changed = service.current(); assert.notEqual(initial.revision, changed.revision); assert.equal(changed.rates['gpt-5.5'].input, 7); assert.equal((await store.list()).total, 2);
  const pinned = buildDashboardPayload(summary(changed), request, { snapshotVersion: 1 }).projection;
  now = new Date('2026-10-02T00:00Z'); await service.refresh({ manual: true }); assert.equal(service.current().revision, changed.revision); assert.equal((await store.list()).total, 2); assert.equal(buildDashboardPayload(summary(service.current()), request, { snapshotVersion: 1 }).projection.key, pinned.key);
  fail = true; input = 9; await assert.rejects(service.refresh({ manual: true }), { code: 'archive' }); assert.equal(service.current().rates['gpt-5.5'].input, 7); assert.equal(service.current().archive.available, true); assert.equal(service.current().archive.error, 'archive'); assert.equal((await store.list()).total, 2);
  fail = false; const restarted = createPricingRefreshService(options); await restarted.initialize(); assert.equal(restarted.current().revision, changed.revision); assert.equal((await restarted.archive.get(initial.revision)).basis.rules.length, PRICING.rules.length);
});

test('first archive failure keeps Token counts and null costs across all projections and recovers', async (t) => {
  const directory = await root(t); let fail = true; const store = createPricingArchive({ directory: path.join(directory, 'archive'), provider: 'codex' });
  const service = createPricingRefreshService({ baseline: PRICING, cachePath: path.join(directory, 'cache'), archiveStore: { ...store, save: (...args) => { if (fail) throw new Error('TEST ONLY storage blocked'); return store.save(...args); } }, fetchImpl: async () => new Response('TEST ONLY', { headers: { 'content-type': 'text/plain' } }), parseDocument: () => ({ 'gpt-5.5': PRICING.rates['gpt-5.5'] }) });
  await service.initialize(); const data = summary(service.current()); const dashboard = buildDashboardPayload(data, request, { snapshotVersion: 1 });
  assert.equal(dashboard.totals.totalTokens, 10); assert.equal(dashboard.cost.total, null); assert.equal(dashboard.pricingCoverage.available, false); assert.equal(dashboard.trend.points[0].cost, null); assert.equal(dashboard.models[0].cost, null); assert.equal(dashboard.sessions[0].pricingStatus, 'unknown');
  const detail = buildSessionDetail(data, request, 'fixture'); assert.equal(detail.cost.total, null); setLocale('en'); assert.match(renderSessionDrawer({ detail, status: 'ready', timezone: 'UTC' }), /Costs are unknown/);
  for (const format of ['json-report', 'markdown-summary', 'csv-sessions', 'csv-trend']) { const exported = buildExport(format, dashboard); assert.equal(exported.metadata.pricing.archive.available, false); if (format === 'json-report') assert.equal(JSON.parse(exported.body).cost.total, null); if (format === 'markdown-summary') assert.match(exported.body, /Known token cost: unknown/); }
  fail = false; await service.refresh({ manual: true }); const recovered = buildDashboardPayload(summary(service.current()), request, { snapshotVersion: 1 }); assert.equal(recovered.cost.available, true); assert.equal(recovered.cost.total, 0.00005); assert.notEqual(recovered.projection.key, dashboard.projection.key);
});

test('reports carry the complete reconstructable basis, including Claude multipliers', () => {
  for (const pricing of [PRICING, CLAUDE_PRICING]) { const dashboard = buildDashboardPayload({ ...summary(pricing), provider: pricing.provider || 'codex' }, request, { snapshotVersion: 1 }); const json = JSON.parse(buildExport('json-report', dashboard).body); assert.equal(pricingRevision(pricingFromBasis(json.metadata.pricing.basis)), json.metadata.pricing.revision); assert.equal(json.metadata.pricing.revision, dashboard.projection.pricingRevision); assert.ok(buildExport('markdown-summary', dashboard).body.includes(JSON.stringify(pricingBasis(pricing)))); }
});

test('storage recovery archives the retained basis even if the upstream request fails', async (t) => {
  const directory = await root(t); let fail = true; const store = createPricingArchive({ directory: path.join(directory, 'archive'), provider: 'codex' });
  const service = createPricingRefreshService({ baseline: PRICING, cachePath: path.join(directory, 'cache'), archiveStore: { ...store, save: (...args) => { if (fail) throw new Error('TEST ONLY disk blocked'); return store.save(...args); } }, fetchImpl: async () => { throw new Error('TEST ONLY offline'); } });
  await service.initialize(); assert.equal(service.current().archive.available, false); fail = false;
  await assert.rejects(service.refresh({ manual: true }), { code: 'network' }); assert.equal(service.current().archive.available, true); assert.equal(buildDashboardPayload(summary(service.current()), request, {}).cost.total, 0.00005);
});

test('a verified published basis loads without metadata writes', async (t) => {
  const directory = await root(t); const store = createPricingArchive({ directory: path.join(directory, 'archive'), provider: 'codex' });
  const cachePath = path.join(directory, 'cache');
  const first = createPricingRefreshService({ baseline: PRICING, cachePath, archiveStore: store }); await first.initialize();
  await writeFile(path.join(directory, 'archive', first.current().revision + '.check.json'), 'TEST ONLY invalid metadata');
  const service = createPricingRefreshService({ baseline: PRICING, cachePath, archiveStore: { ...store, save: () => { throw new Error('TEST ONLY no writes'); } } });
  await service.initialize(); assert.equal(service.current().archive.available, true); assert.equal(service.current().revision, first.current().revision);
  assert.equal(service.status().metadataError, 'metadata'); assert.equal(service.status().lastCheckedAt, null);
});

test('legacy Claude publication migrates offline and prices August and September usage', async (t) => {
  const directory = await root(t); const cachePath = path.join(directory, 'cache');
  const legacy = { version: 1, pricing: { ...pricingBasis(CLAUDE_PRICING), updatedAt: CLAUDE_PRICING.updatedAt }, lastCheckedAt: '2026-08-30T00:00:00Z', lastAutomaticAttemptDate: '2026-08-30' };
  await writeFile(cachePath, JSON.stringify(legacy));
  const options = { baseline: CLAUDE_PRICING, cachePath, sourceUrl: CLAUDE_PRICING.source, fetchImpl: async () => { throw new Error('Offline'); } };
  const service = createPricingRefreshService(options); await service.initialize();
  assert.equal(service.current().archive.available, true);
  assert.equal(service.current().archive.origin, 'cache');
  assert.equal(service.status().lastCheckedAt, legacy.lastCheckedAt);
  const publication = JSON.parse(await readFile(cachePath));
  assert.equal(publication.revision, pricingRevision(CLAUDE_PRICING));
  for (const timestamp of ['2026-08-15T00:00:00Z', '2026-09-15T00:00:00Z']) {
    const data = { ...summary(service.current()), provider: 'claude' };
    data.sessions[0] = { ...data.sessions[0], provider: 'claude', model: 'claude-opus-5', usageEvents: [{ timestamp, model: 'claude-opus-5', pricingModifiers: { inferenceGeo: 'global', speed: 'standard', serviceTier: 'standard' }, usage: { ...zeroUsage(), inputTokens: 1000, uncachedInputTokens: 1000, outputTokens: 100, totalTokens: 1100 } }] };
    const dashboard = buildDashboardPayload(data, request, {});
    assert.equal(dashboard.cost.available, true); assert.equal(dashboard.cost.total, 0.0075);
    assert.equal(dashboard.sessions[0].cost.total, 0.0075);
  }
  const restarted = createPricingRefreshService(options); await restarted.initialize(); assert.equal(restarted.current().archive.available, true);
  await rm(path.join(`${cachePath}.archive`, publication.revision + '.json'));
  const damaged = createPricingRefreshService(options); await damaged.initialize();
  assert.equal(damaged.current().archive.available, false);
});
