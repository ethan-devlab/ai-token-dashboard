import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import { setImmediate as tick } from 'node:timers/promises';
import { buildDashboardPayload, buildSessionsPayload } from '../server/dashboard-data.mjs';
import { createExportPlan } from '../server/export-format.mjs';
import { createExportService } from '../server/export-service.mjs';
import { PRICING } from '../server/pricing.mjs';
import { zeroUsage } from '../server/usage.mjs';

const query = { nowMs: Date.parse('2026-10-01T00:00:00Z'), range: { mode: 'all', timezone: 'UTC' }, q: '', offset: 0, limit: 100, sort: 'recent',
  filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } };
const usage = { ...zeroUsage(), inputTokens: 12, uncachedInputTokens: 12, totalTokens: 12 };
function summary() { return { provider: 'codex', pricing: PRICING, generatedAt: '2026-10-01T00:00:00Z', errors: [], sessions: [{ provider: 'codex', sessionId: '=unsafe,"\r\n😀', sessionKey: 'test', file: 'test', model: 'gpt-5.5', invalidLineCount: 0, reconciliation: {}, usageEvents: [{ timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.5', usage }] }] }; }
function clock() {
  let value = 0; const timers = new Map();
  return { timers, now: () => value, advance: (ms) => { value += ms; },
    schedule: (fn, ms) => { const handle = { unref() {} }; timers.set(handle, { fn, ms }); return handle; },
    cancel: (handle) => timers.delete(handle), fire(ms) { const entry = [...timers.values()].find(item => item.ms === ms); assert.ok(entry); entry.fn(); } };
}
test('bounded formatter preserves UTF-8, quoting, formulas and exact byte counts in every format', () => {
  const data = buildDashboardPayload(summary(), query, { snapshotVersion: 1, complete: true }, { exportAllSessions: true });
  const long = 'a'.repeat(16383) + '😀"\r\n' + '漢'.repeat(70000);
  data.sessions[0].sessionId += long; data.models[0].model = long;
  for (const format of ['csv-sessions', 'csv-trend', 'json-report', 'markdown-summary']) {
    const plan = createExportPlan(format, data); const received = [];
    for (const view of plan.buffers()) { assert.ok(view.length <= 131072); received.push(Buffer.from(view)); }
    const body = Buffer.concat(received); assert.equal(body.length, plan.byteLength);
    assert.equal(body.toString(), [...plan.chunks()].join(''));
    if (format === 'json-report') { const report = JSON.parse(body); assert.equal(report.models[0].model, long); assert.equal(report.metadata.exportedSessionCount, 1); }
    if (format === 'csv-sessions') assert.ok(body.toString().includes('"\'=unsafe,""\r\n😀'));
    assert.ok(!body.toString().includes('�'));
  }
});
test('selection reuse does not retain live failure status, cross snapshot data, or unavailable costs', () => {
  const data = summary(); const scan = { snapshotVersion: 1, complete: true };
  assert.equal(buildDashboardPayload(data, query, scan).totals.totalTokens, 12);
  const failed = buildSessionsPayload(data, query, { ...scan, retainedSnapshot: true, refreshFailure: { reason: 'file-parse' } });
  assert.equal(failed.quality.scan.refreshFailure.reason, 'file-parse'); assert.equal(failed.totals.totalTokens, 12);
  const unavailable = { ...data, pricing: { ...PRICING, archive: { available: false } } };
  assert.equal(buildSessionsPayload(unavailable, query, scan).cost.total, null);
  unavailable.pricing.archive.available = true;
  assert.ok(buildSessionsPayload(unavailable, query, scan).cost.total > 0);
  const next = { ...data, sessions: [{ ...data.sessions[0], usageEvents: [] }] };
  assert.equal(buildSessionsPayload(next, query, { snapshotVersion: 2 }).totals.totalTokens, 0);
});
test('one slot, one-use claim, abandoned preparation and unused expiry release all state', () => {
  const time = clock(); const service = createExportService(time);
  const lease = service.reserve(); assert.throws(() => service.reserve(), { code: 'EXPORT_BUSY', status: 429 });
  service.release(lease); assert.throws(() => service.prepare(lease, {}), { code: 'EXPORT_EXPIRED' });
  const next = service.reserve(); service.prepare(next, { byteLength: 2, fileName: 'test' });
  service.claim(next.ticket); assert.throws(() => service.claim(next.ticket), { code: 'EXPORT_EXPIRED' }); service.release(next);
  const expired = service.reserve(); service.prepare(expired, {}); time.advance(120000);
  assert.throws(() => service.claim(expired.ticket), { code: 'EXPORT_EXPIRED' }); assert.equal(time.timers.size, 0);
  const pending = service.reserve(); service.prepare(pending, {}); time.fire(120000);
  assert.equal(pending.plan, null); assert.equal(time.timers.size, 0); service.close(); assert.throws(() => service.reserve(), { code: 'EXPORT_UNAVAILABLE' });
});
test('writer waits for completion before pulling and reusing the fixed buffer', async () => {
  const service = createExportService(); const lease = service.reserve(); let pulls = 0; const callbacks = []; const bytes = [];
  const buffer = Buffer.alloc(32, 65);
  service.prepare(lease, { *buffers() { for (let i = 0; i < 3; i++) { pulls++; buffer.fill(65 + i); yield buffer; } } });
  const sink = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) { callbacks.push(() => { bytes.push(Buffer.from(chunk)); callback(); }); } });
  const sending = service.send(lease, sink, () => undefined);
  for (let i = 0; i < 3; i++) { await tick(); assert.equal(pulls, i + 1); callbacks.shift()(); }
  await sending; assert.deepEqual(bytes.map(chunk => chunk[0]), [65, 66, 67]); assert.equal(lease.plan, null);
  const next = service.reserve(); service.release(next); service.close();
});
test('idle deadline, total deadline, disconnect and shutdown stop stalled transfer and free the slot', async () => {
  for (const mode of ['idle', 'total', 'disconnect', 'shutdown']) {
    const time = clock(); const service = createExportService(time); const lease = service.reserve();
    service.prepare(lease, { *buffers() { yield Buffer.alloc(65536); yield Buffer.alloc(65536); } });
    const sink = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) {} });
    const sending = service.send(lease, sink, () => undefined); const rejected = assert.rejects(sending);
    await tick();
    if (mode === 'idle') time.fire(60000); else if (mode === 'total') time.fire(1800000); else if (mode === 'shutdown') service.close(); else sink.destroy();
    await rejected; assert.equal(lease.plan, null); assert.equal(time.timers.size, 0);
    if (mode !== 'shutdown') { const next = service.reserve(); service.release(next); service.close(); }
  }
});
