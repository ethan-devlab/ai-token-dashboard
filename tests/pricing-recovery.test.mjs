import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { PRICING, CLAUDE_PRICING } from '../server/pricing.mjs';
import { createPricingRefreshService } from '../server/pricing-refresh.mjs';
import { createPricingArchive } from '../server/pricing-archive.mjs';
import { acquirePricingOwner } from '../server/pricing-owner.mjs';

async function fixture(t, baseline = PRICING) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ctd-pricing-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let input = 7; let fetches = 0;
  const options = { baseline, cachePath: path.join(root, 'cache'), archiveDirectory: path.join(root, 'archive'),
    fetchImpl: async () => { fetches++; return new Response('TEST ONLY synthetic pricing', { headers: { 'content-type': 'text/markdown' } }); },
    parseDocument: () => ({ [baseline.rules[0].id]: { ...baseline.rules[0].rates, input } }), sourceUrl: baseline.source };
  return { root, options, setInput: (v) => { input = v; }, fetches: () => fetches, service: () => createPricingRefreshService(options) };
}
const reader = { status: () => ({ writable: false, writeReason: 'occupied' }), assertWritable: async () => { throw Object.assign(new Error('Read only.'), { code: 'PRICING_READ_ONLY', status: 409 }); } };
async function snapshot(root) {
  const records = {};
  async function walk(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await walk(file); else records[path.relative(root, file)] = await fs.readFile(file, 'utf8');
    }
  }
  await walk(root); return records;
}
async function inject(method, implementation, run) {
  const original = fs[method]; fs[method] = (...args) => implementation(original, ...args); syncBuiltinESMExports();
  try { return await run(); } finally { fs[method] = original; syncBuiltinESMExports(); }
}

test('reader initialization, automatic refresh and rejected writes never fetch or create files', async (t) => {
  for (const baseline of [PRICING, CLAUDE_PRICING]) {
    const f = await fixture(t, baseline); const service = createPricingRefreshService({ ...f.options, owner: reader });
    await service.initialize(); await service.refresh(); await service.verify();
    await assert.rejects(service.refresh({ manual: true }), { code: 'PRICING_READ_ONLY' });
    await assert.rejects(service.repair(), { code: 'PRICING_READ_ONLY' });
    await assert.rejects(service.load(), { code: 'PRICING_LOAD_FAILED' });
    assert.equal(service.current().archive.available, false); assert.equal(f.fetches(), 0); assert.deepEqual(await snapshot(f.root), {});
  }
});

test('reader explicitly loads published rates; failed latest load retains only its valid old basis', async (t) => {
  const f = await fixture(t); const writer = f.service(); await writer.initialize();
  const service = createPricingRefreshService({ ...f.options, owner: reader }); await service.initialize(); const old = service.current();
  await writer.refresh({ manual: true }); assert.notEqual(writer.current().revision, old.revision);
  await service.verify(); assert.equal(service.current().revision, old.revision);
  const before = await snapshot(f.root); await service.load(); assert.equal(service.current().revision, writer.current().revision); assert.deepEqual(await snapshot(f.root), before);
  await fs.writeFile(f.options.cachePath, 'TEST ONLY bad publication'); await assert.rejects(service.load());
  assert.equal(service.current().archive.available, true);
  await fs.rm(path.join(f.root, 'archive', service.current().revision + '.json'));
  await service.verify(); assert.equal(service.current().archive.available, false);
});

test('missing or corrupt existing publication never selects an archived version on restart', async (t) => {
  const f = await fixture(t); const service = f.service(); await service.initialize(); await service.refresh({ manual: true });
  for (const damaged of [null, '{', JSON.stringify({ version: 1, pricing: {} })]) {
    if (damaged == null) await fs.rm(f.options.cachePath); else await fs.writeFile(f.options.cachePath, damaged);
    const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().archive.available, false);
    assert.equal((await restarted.refresh()).attempted, false);
  }
});

test('publication write or rename failure leaves the old committed basis and restart pointer intact', async (t) => {
  const f = await fixture(t); const service = f.service(); await service.initialize(); const old = service.current();
  const publication = await fs.readFile(f.options.cachePath, 'utf8');
  for (const method of ['writeFile', 'rename']) {
    f.setInput(method === 'writeFile' ? 8 : 9);
    await inject(method, (original, ...args) => {
      if (method === 'rename' ? args[1] === f.options.cachePath : String(args[0]).startsWith(f.options.cachePath + '.')) throw new Error('TEST ONLY publication failure');
      return original(...args);
    }, async () => { await assert.rejects(service.refresh({ manual: true }), { code: 'publication' }); });
    assert.equal(service.current().revision, old.revision); assert.equal(await fs.readFile(f.options.cachePath, 'utf8'), publication);
    const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().revision, old.revision);
  }
  assert.equal((await service.archive.list()).total, 3);
});

test('automatic and manual overlap share one refresh; publication operations run in order', async (t) => {
  const f = await fixture(t); let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; }); const started = new Promise((resolve) => { entered = resolve; });
  const service = createPricingRefreshService({ ...f.options, fetchImpl: async () => { entered(); await gate; return new Response('TEST ONLY', { headers: { 'content-type': 'text/markdown' } }); } });
  await service.initialize(); const auto = service.refresh(); await started; const manual = service.refresh({ manual: true }); const load = service.load();
  release(); assert.equal((await auto).attempted, true); assert.equal((await manual).attempted, true); await load;
  assert.equal(service.current().rates[PRICING.rules[0].id].input, 7);
  const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().revision, service.current().revision);
});

test('new queries detect deleted and corrupt bases without writing; retained repair works offline', async (t) => {
  const f = await fixture(t); const service = createPricingRefreshService({ ...f.options, fetchImpl: async () => { throw new Error('TEST ONLY offline'); } });
  await service.initialize(); const firstArchivedAt = service.current().archive.firstArchivedAt; const revision = service.current().revision; const file = path.join(f.root, 'archive', revision + '.json');
  for (const corrupted of [null, 'TEST ONLY damaged bytes']) {
    if (corrupted == null) await fs.rm(file); else await fs.writeFile(file, corrupted);
    const before = await snapshot(f.root); await service.verify(); assert.equal(service.current().archive.available, false); assert.deepEqual(await snapshot(f.root), before);
    await service.repair(); assert.equal(service.current().archive.available, true); assert.equal(service.current().revision, revision); assert.equal(service.current().archive.firstArchivedAt, firstArchivedAt);
    if (corrupted != null) { const quarantine = Object.keys(await snapshot(f.root)).find((name) => name.startsWith('archive/' + revision + '.json.quarantine-')); assert.equal(await fs.readFile(path.join(f.root, quarantine), 'utf8'), corrupted); }
  }
});

test('metadata write failure does not invalidate basis, and corrupt metadata repairs without replacing it', async (t) => {
  const f = await fixture(t); const service = f.service(); await service.initialize();
  await inject('rename', (original, ...args) => { if (String(args[1]).endsWith('.check.json')) throw new Error('TEST ONLY metadata failure'); return original(...args); }, async () => { await service.refresh({ manual: true }); });
  assert.equal(service.current().archive.available, true); assert.equal(service.status().metadataError, 'metadata'); assert.equal(service.status().lastCheckedAt, null);
  const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().archive.available, true); assert.equal(restarted.status().metadataError, 'metadata'); assert.equal(restarted.status().lastCheckedAt, null);
  const offline = createPricingRefreshService({ ...f.options, fetchImpl: async () => { throw new Error('TEST ONLY offline'); } }); await offline.initialize(); await assert.rejects(offline.refresh(), { code: 'network' });
  const afterAttempt = f.service(); await afterAttempt.initialize(); assert.equal(afterAttempt.status().metadataError, 'metadata'); assert.equal(afterAttempt.status().lastCheckedAt, null);
  const file = path.join(f.root, 'archive', service.current().revision + '.json'); const basis = await fs.readFile(file, 'utf8');
  const check = file.replace(/\.json$/, '.check.json'); await fs.writeFile(check, 'TEST ONLY bad metadata'); await service.verify();
  assert.equal(service.current().archive.available, true); await service.repair(); assert.equal(await fs.readFile(file, 'utf8'), basis);
  const all = await snapshot(f.root); assert.ok(Object.entries(all).some(([name, body]) => name.includes('.check.json.quarantine-') && body === 'TEST ONLY bad metadata'));
});

test('unknown startup repair must fetch validated pricing; it preserves damaged publication bytes', async (t) => {
  const f = await fixture(t); await fs.writeFile(f.options.cachePath, 'TEST ONLY damaged publication');
  const service = f.service(); await service.initialize(); assert.equal(service.current().archive.available, false);
  await service.repair(); assert.equal(f.fetches(), 1); assert.equal(service.current().archive.available, true);
  assert.ok(Object.entries(await snapshot(f.root)).some(([name, body]) => name.startsWith('cache.quarantine-') && body === 'TEST ONLY damaged publication'));
});

test('valid replacement during quarantine is restored and repair stops without replacing it', async (t) => {
  const f = await fixture(t); const service = f.service(); await service.initialize();
  const file = path.join(f.root, 'archive', service.current().revision + '.json'); const valid = await fs.readFile(file, 'utf8'); await fs.writeFile(file, 'TEST ONLY bad');
  await inject('rename', async (original, ...args) => {
    if (args[0] === file && String(args[1]).includes('.quarantine-')) await fs.writeFile(file, valid);
    return original(...args);
  }, async () => { await assert.rejects(service.repair(), { code: 'PRICING_REPAIR_CONFLICT' }); });
  assert.equal(await fs.readFile(file, 'utf8'), valid);
});

test('lost ownership blocks refresh and repair without file or fetch changes', async (t) => {
  const f = await fixture(t); const owner = await acquirePricingOwner(f.root); const service = createPricingRefreshService({ ...f.options, owner }); await service.initialize();
  const ownerFile = path.join(f.root, '.pricing.writer-lock', 'owner.json'); const old = JSON.parse(await fs.readFile(ownerFile, 'utf8')); await fs.writeFile(ownerFile, JSON.stringify({ ...old, generation: '00000000-0000-0000-0000-000000000000' }));
  const before = await snapshot(f.root); await service.verify();
  await assert.rejects(service.refresh({ manual: true }), { code: 'PRICING_READ_ONLY' }); await assert.rejects(service.repair(), { code: 'PRICING_READ_ONLY' });
  assert.equal(f.fetches(), 0); assert.deepEqual(await snapshot(f.root), before); await owner.release(); assert.deepEqual(await snapshot(f.root), before);
});

test('version-1 publications remain compatible but wrong source, Provider or digest is rejected', async (t) => {
  const f = await fixture(t); const initial = f.service(); await initial.initialize(); const stored = JSON.parse(await fs.readFile(f.options.cachePath));
  const compatible = structuredClone(stored); delete compatible.revision; await fs.writeFile(f.options.cachePath, JSON.stringify(compatible));
  const readerService = createPricingRefreshService({ ...f.options, owner: reader }); await readerService.initialize(); assert.equal(readerService.current().archive.available, true);
  for (const alter of [(s) => { s.pricing.source = 'https://example.invalid/pricing'; }, (s) => { s.pricing.provider = 'claude'; }, (s) => { s.revision = '0'.repeat(64); }]) {
    const damaged = structuredClone(stored); alter(damaged); await fs.writeFile(f.options.cachePath, JSON.stringify(damaged));
    const next = f.service(); await next.initialize(); assert.equal(next.current().archive.available, false); assert.equal((await next.refresh()).attempted, false);
  }
});

test('first publication failure cannot enable bundled cost or infer its archive at restart', async (t) => {
  const f = await fixture(t); const service = f.service();
  await inject('rename', (original, ...args) => { if (args[1] === f.options.cachePath) throw new Error('TEST ONLY first publication failure'); return original(...args); }, async () => { await service.initialize(); });
  assert.equal(service.current().archive.available, false); assert.equal(service.status().publicationError, 'publication');
  assert.equal((await service.archive.list()).total, 1);
  const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().archive.available, false);
  await restarted.repair(); assert.equal(f.fetches(), 1); assert.equal(restarted.current().archive.available, true);
});

test('close waits for an admitted refresh and rejects new pricing work', async (t) => {
  const f = await fixture(t); let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; }); const started = new Promise((resolve) => { entered = resolve; });
  const service = createPricingRefreshService({ ...f.options, fetchImpl: async () => { entered(); await gate; return new Response('TEST ONLY', { headers: { 'content-type': 'text/markdown' } }); } });
  await service.initialize(); const refresh = service.refresh({ manual: true }); await started;
  let closed = false; const shutdown = service.close().then(() => { closed = true; });
  await assert.rejects(service.load(), { code: 'closed' }); assert.equal(closed, false);
  release(); await refresh; await shutdown; assert.equal(closed, true);
  const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().revision, service.current().revision);
});

test('automatic refresh cannot silently repair a basis removed during its fetch', async (t) => {
  const f = await fixture(t); let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; }); const started = new Promise((resolve) => { entered = resolve; });
  const service = createPricingRefreshService({ ...f.options, fetchImpl: async () => { entered(); await gate; return new Response('TEST ONLY', { headers: { 'content-type': 'text/markdown' } }); } });
  await service.initialize(); const refresh = service.refresh(); await started;
  await fs.rm(path.join(f.root, 'archive', service.current().revision + '.json')); const before = await snapshot(f.root);
  release(); await assert.rejects(refresh, { code: 'archive' }); assert.deepEqual(await snapshot(f.root), before); assert.equal(service.current().archive.available, false);
});

test('Claude refresh round-trips complete explicit pricing modifiers', async (t) => {
  const f = await fixture(t, CLAUDE_PRICING); const service = f.service(); await service.initialize();
  const modifiers = service.current().modifiers; await service.refresh({ manual: true });
  for (const field of ['usGeoMultiplier', 'fastMultiplier']) assert.equal(service.current().modifiers[field], modifiers[field]);
  for (const field of ['usGeoPattern', 'fastPattern']) assert.equal(service.current().modifiers[field].source, modifiers[field].source);
  const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().revision, service.current().revision);
});

test('repair publication failure blocks writer, reader and restart until explicit publication completes', async (t) => {
  const f = await fixture(t); const writer = f.service(); await writer.initialize();
  const service = createPricingRefreshService({ ...f.options, owner: reader }); await service.initialize();
  const file = path.join(f.root, 'archive', writer.current().revision + '.json'); await fs.writeFile(file, 'TEST ONLY bad basis');
  await inject('rename', (original, ...args) => { if (args[1] === f.options.cachePath) throw new Error('TEST ONLY repair publication failure'); return original(...args); }, async () => { await assert.rejects(writer.repair(), { code: 'publication' }); });
  await writer.verify(); await service.verify(); assert.equal(writer.current().archive.available, false); assert.equal(service.current().archive.available, false);
  const restarted = f.service(); await restarted.initialize(); assert.equal(restarted.current().archive.available, false); await assert.rejects(service.load(), { code: 'PRICING_LOAD_FAILED' });
  await writer.repair(); await service.verify(); assert.equal(service.current().archive.available, true); assert.equal(f.fetches(), 0);
  await assert.rejects(fs.stat(f.options.cachePath + '.repairing'), { code: 'ENOENT' });
});

test('ownership lost during fetch stops all later price mutations', async (t) => {
  const f = await fixture(t); const owner = await acquirePricingOwner(f.root); let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; }); const started = new Promise((resolve) => { entered = resolve; });
  const service = createPricingRefreshService({ ...f.options, owner, fetchImpl: async () => { entered(); await gate; return new Response('TEST ONLY', { headers: { 'content-type': 'text/markdown' } }); } });
  await service.initialize(); const refresh = service.refresh({ manual: true }); await started;
  const ownerFile = path.join(f.root, '.pricing.writer-lock', 'owner.json'); const prior = JSON.parse(await fs.readFile(ownerFile)); await fs.writeFile(ownerFile, JSON.stringify({ ...prior, generation: '00000000-0000-0000-0000-000000000000' }));
  const before = await snapshot(f.root); release(); await assert.rejects(refresh, { code: 'PRICING_READ_ONLY' }); assert.deepEqual(await snapshot(f.root), before); await owner.release();
});

test('valid publication and check replacements during quarantine are preserved', async (t) => {
  const f = await fixture(t); const service = f.service(); await service.initialize(); await service.refresh({ manual: true });
  for (const file of [f.options.cachePath, path.join(f.root, 'archive', service.current().revision + '.check.json')]) {
    const valid = await fs.readFile(file, 'utf8'); await fs.writeFile(file, 'TEST ONLY invalid bytes');
    await inject('rename', async (original, ...args) => {
      if (args[0] === file && String(args[1]).includes('.quarantine-')) await fs.writeFile(file, valid);
      return original(...args);
    }, async () => { await assert.rejects(service.repair(), { code: 'PRICING_REPAIR_CONFLICT' }); });
    assert.equal(await fs.readFile(file, 'utf8'), valid);
  }
});

test('unknown startup repair quarantines its invalid published basis before adopting a fresh different basis', async (t) => {
  const f = await fixture(t); const first = f.service(); await first.initialize(); await first.refresh({ manual: true });
  const prior = first.current().revision; const file = path.join(f.root, 'archive', prior + '.json'); await fs.writeFile(file, 'TEST ONLY damaged published basis');
  const service = f.service(); await service.initialize(); assert.equal(service.current().archive.available, false); f.setInput(9); await service.repair();
  assert.notEqual(service.current().revision, prior); assert.ok(Object.entries(await snapshot(f.root)).some(([name, body]) => name.startsWith('archive/' + prior + '.json.quarantine-') && body === 'TEST ONLY damaged published basis'));
});

test('a manual refresh overlapping a skipped automatic check still fetches', async (t) => {
  const f = await fixture(t); const service = f.service(); await service.initialize(); await service.refresh();
  const automatic = service.refresh(); const manual = service.refresh({ manual: true });
  assert.equal((await automatic).attempted, false); assert.equal((await manual).attempted, true); assert.equal(f.fetches(), 2);
});
