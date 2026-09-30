import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createSessionIndex } from '../server/session-index.mjs';
import { createSummaryCache } from '../server/summary-cache.mjs';
import { createProviderRegistry } from '../server/provider-registry.mjs';
import { buildDashboardPayload } from '../server/dashboard-data.mjs';
import { PRICING } from '../server/pricing.mjs';
import { zeroUsage } from '../server/usage.mjs';

const record = (input) => JSON.stringify({ type: 'turn.completed', timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.5', usage: { input_tokens: input, output_tokens: 0 } }) + '\n';
const request = { range: { mode: 'all', timezone: 'UTC' }, q: '', offset: 0, limit: 100, sort: 'recent', filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } };
async function until(predicate, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await delay(10); } throw new Error('Fixture condition timed out.'); }
async function fixture(t, maxFiles = 100) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-reliability-'));
  const index = createSessionIndex({ sessionsDirectory: root, maxFiles, parseConcurrency: 2, pricing: PRICING });
  t.after(async () => { await index.close(); await rm(root, { recursive: true, force: true }); });
  const write = async (name, text) => { const file = path.join(root, name); await writeFile(file, text); return file; };
  return { root, index, write, cache: createSummaryCache(() => index.prepareRefresh()) };
}
test('any changed-file failure rolls back the whole index and snapshot, including healthy changes and deletion', async (t) => {
  const f = await fixture(t); await f.write('bad.jsonl', record(110)); await f.write('healthy.jsonl', record(5)); await f.write('deleted.jsonl', record(3));
  await f.cache.get(); await f.write('bad.jsonl', 'null\n'); await f.write('healthy.jsonl', record(9)); await rm(path.join(f.root, 'deleted.jsonl'));
  await assert.rejects(f.cache.refresh(), { code: 'SESSION_REFRESH_FAILED', reason: 'file-parse' });
  const retained = await f.cache.get(); assert.equal(retained.summary.totals.totalTokens, 118); assert.equal(retained.metadata.snapshotVersion, 1); assert.equal(retained.metadata.retainedSnapshot, true); assert.equal(retained.metadata.refreshFailure.failedFiles, 1);
  await assert.rejects(f.cache.refresh(), { reason: 'file-parse' }); assert.equal(f.cache.status().snapshotVersion, 1);
  await f.write('bad.jsonl', record(120)); const repaired = await f.cache.refresh();
  assert.equal(repaired.summary.totals.totalTokens, 129); assert.equal(repaired.summary.scan.deleted, 1); assert.equal(repaired.summary.scan.changed, 2); assert.equal(repaired.version, 2); assert.equal(f.cache.status().refreshFailure, null);
});
test('initial scan failure stays uninitialized and never publishes an empty success', async (t) => {
  const f = await fixture(t); await f.write('bad.jsonl', 'null\n');
  await assert.rejects(f.cache.get(), { code: 'SESSION_REFRESH_FAILED' }); assert.equal(f.cache.initialized(), false); assert.equal(f.cache.status().snapshotVersion, 0); assert.equal(f.cache.status().retainedSnapshot, false);
  await f.write('bad.jsonl', record(110)); assert.equal((await f.cache.get()).summary.totals.totalTokens, 110);
});
test('exact file cap is complete; an extra JSONL is excluded and marked end to end', async (t) => {
  const f = await fixture(t, 1); await f.write('a.jsonl', record(10)); await mkdir(path.join(f.root, 'empty')); await f.write('ignore.txt', 'not a Session');
  const exact = await f.index.refresh(); assert.equal(exact.truncated, false); assert.equal(exact.scan.complete, true);
  await f.write('b.jsonl', record(20)); const capped = await f.index.refresh(); const dashboard = buildDashboardPayload(capped, request, capped.scan);
  assert.equal(capped.totals.totalTokens, 10); assert.equal(capped.truncated, true); assert.equal(dashboard.quality.scan.complete, false); assert.equal(dashboard.quality.scan.maxFiles, 1); assert.equal(dashboard.scan.omittedFilesAtLeast, 1);
  await rm(path.join(f.root, 'b.jsonl')); assert.equal((await f.index.refresh()).scan.complete, true);
});
test('a cap-displaced known file is excluded, not claimed as a confirmed deletion', async (t) => {
  const f = await fixture(t, 2); await f.write('b.jsonl', record(2)); await f.write('c.jsonl', record(3)); await f.index.refresh();
  await f.write('a.jsonl', record(1)); const capped = await f.index.refresh(); assert.equal(capped.scan.deleted, 0); assert.equal(capped.scan.excluded, 1); assert.equal(capped.scan.truncated, true);
});
test('unchanged reuse holds but same-size restored-mtime replacements are reparsed', async (t) => {
  const f = await fixture(t); const file = await f.write('one.jsonl', record(110)); await f.index.refresh();
  assert.equal((await f.index.refresh()).scan.reused, 1); const before = await stat(file); await f.write('one.jsonl', record(220)); await utimes(file, before.atime, before.mtime);
  const changed = await f.index.refresh(); assert.equal(changed.totals.totalTokens, 220); assert.equal(changed.scan.changed, 1);
});
test('write during a parser pass rejects the candidate and leaves the committed index reusable', async (t) => {
  const f = await fixture(t); const file = await f.write('one.jsonl', record(110)); await f.index.refresh(); await f.write('one.jsonl', record(1).repeat(20_000));
  const pending = f.index.refresh(); const outcome = pending.catch((error) => error);
  await until(() => f.index.status().activeWorkers > 0); await appendFile(file, record(20));
  const error = await outcome; assert.equal(error.code, 'SESSION_REFRESH_FAILED'); assert.equal(error.reason, 'files-changed'); assert.equal(f.index.status().activeWorkers, 0);
  const repaired = await f.index.refresh(); assert.equal(repaired.totals.totalTokens, 20020); assert.equal(repaired.scan.changed, 1); assert.equal(f.index.status().activeWorkers, 0);
});
test('dirty generations discard intermediate candidates and commit only the final complete pass', async () => {
  let release; let enter; let calls = 0; let commits = 0;
  const started = new Promise((resolve) => { enter = resolve; });
  const cache = createSummaryCache(async () => { const marker = ++calls; if (marker === 1) { enter(); await new Promise((resolve) => { release = resolve; }); } return { summary: { marker, scan: {} }, commit: () => { commits += 1; } }; });
  const pending = cache.refresh(); await started; cache.invalidate(); cache.invalidate(); const joined = cache.refresh(); release();
  const [a, b] = await Promise.all([pending, joined]); assert.equal(a, b); assert.equal(a.summary.marker, 2); assert.equal(a.version, 1); assert.equal(commits, 1);
});
test('follow-up failure does not commit an earlier candidate; continuous changes are bounded', async () => {
  let cache; let commits = 0; let calls = 0;
  cache = createSummaryCache(async () => { calls += 1; if (calls === 2) throw Object.assign(new Error('fixture'), { reason: 'file-parse' }); cache.invalidate(); return { summary: { scan: {} }, commit: () => { commits += 1; } }; });
  await assert.rejects(cache.refresh(), /fixture/); assert.equal(commits, 0); assert.equal(cache.status().snapshotVersion, 0);
  const busy = createSummaryCache(async () => { busy.invalidate(); return { scan: {} }; });
  await assert.rejects(busy.refresh(), { code: 'SESSION_REFRESH_FAILED', reason: 'files-changing' }); assert.equal(busy.status().snapshotVersion, 0);
});
test('closing an active parser terminates owned workers and prevents publication', async (t) => {
  const f = await fixture(t); await f.write('one.jsonl', record(1).repeat(20_000));
  const pending = f.index.refresh().catch((error) => error); await until(() => f.index.status().activeWorkers > 0); await f.index.close();
  const error = await pending; assert.equal(error.reason, 'closed'); assert.equal(f.index.status().activeWorkers, 0); assert.equal(f.index.status().closed, true);
  await assert.rejects(f.index.refresh(), { reason: 'closed' });
});
test('150000-observation all-time query keeps totals and completes without argument spread', () => {
  const usage = { ...zeroUsage(), inputTokens: 1, uncachedInputTokens: 1, totalTokens: 1 };
  const usageEvents = Array.from({ length: 150_000 }, (_, index) => ({ timestamp: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), model: 'gpt-5.5', usage }));
  const summary = { pricing: PRICING, errors: [], sessions: [{ sessionKey: 'large', sessionId: 'large', model: 'gpt-5.5', file: 'large.jsonl', usageEvents, reconciliation: {}, invalidLineCount: 0 }] };
  const dashboard = buildDashboardPayload(summary, request, {}); assert.equal(dashboard.totals.totalTokens, 150_000); assert.equal(dashboard.trend.points.reduce((sum, point) => sum + point.tokens, 0), 150_000); assert.equal(dashboard.models[0].tokens, 150_000);
});
test('missing-directory watcher recovers, refreshes changes, rebinds a replaced root and stops cleanly', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-watcher-')); const directory = path.join(root, 'codex'); const claude = path.join(root, 'claude'); await mkdir(claude);
  const pricingService = { current: () => PRICING, status: () => ({}) };
  const registry = createProviderRegistry({ config: { codexSessionsDirectory: directory, claudeSessionsDirectory: claude, maxFiles: 100, parseConcurrency: 1, autoRefresh: true, autoRefreshDebounceMs: 100 }, pricingServices: { codex: pricingService, claude: pricingService } });
  t.after(async () => { await registry.close(); await rm(root, { recursive: true, force: true }); });
  const provider = registry.get('codex'); await registry.startWatchers(); assert.equal(provider.watcher().status, 'unavailable');
  await mkdir(directory); await writeFile(path.join(directory, 'one.jsonl'), record(110));
  await until(() => provider.watcher().status === 'watching'); assert.equal((await provider.cache.get()).summary.totals.totalTokens, 110);
  await writeFile(path.join(directory, 'one.jsonl'), record(120)); await until(async () => (await provider.cache.get()).summary.totals.totalTokens === 120);
  await rename(directory, path.join(root, 'old-codex')); await mkdir(directory); await writeFile(path.join(directory, 'one.jsonl'), record(130));
  await until(async () => (await provider.cache.get()).summary.totals.totalTokens === 130);
  await registry.close(); const version = provider.cache.status().snapshotVersion; await writeFile(path.join(directory, 'one.jsonl'), record(140)); await delay(200);
  assert.equal(provider.watcher().status, 'closed'); assert.equal(provider.cache.status().snapshotVersion, version); await assert.rejects(provider.cache.refresh(), { reason: 'closed' });
});
