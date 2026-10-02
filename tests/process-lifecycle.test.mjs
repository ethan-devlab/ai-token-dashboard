import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLifecycleJournal, createProcessLifecycle } from '../server/process-lifecycle.mjs';
import { createSummaryCache } from '../server/summary-cache.mjs';

test('private separate journals, allow-listed fields and rejected symlink directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-lifecycle-unit-'));
  try {
    const first = createLifecycleJournal(root); const second = createLifecycleJournal(root);
    first.record('start', { message: 'SECRET', reason: 'SECRET', signal: 'SECRET' });
    second.record('listening'); first.close(); second.close();
    const directory = path.join(root, '.lifecycle'); const files = await readdir(directory);
    assert.equal(files.length, 2); assert.equal((await stat(directory)).mode & 0o777, 0o700);
    for (const file of files) {
      assert.equal((await stat(path.join(directory, file))).mode & 0o777, 0o600);
      const body = await readFile(path.join(directory, file), 'utf8'); assert.ok(!body.includes('SECRET'));
      assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['event', 'pid', 'runId', 'timestamp', 'version']);
    }
    const outside = path.join(root, 'outside'); await mkdir(outside); const unsafe = path.join(root, 'unsafe'); await mkdir(unsafe);
    await symlink(outside, path.join(unsafe, '.lifecycle'));
    const refused = createLifecycleJournal(unsafe); assert.equal(refused.status().lastError, 'unsafe-directory');
    refused.record('start'); refused.close(); assert.deepEqual(await readdir(outside), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function fixture() {
  const runtime = new EventEmitter(); const records = []; const timers = []; let stops = 0; let cleanups = 0; let forced = 0;
  runtime.exit = code => { runtime.exitCode = code; runtime.emit('exit', code); };
  let resume; const pending = new Promise(resolve => { resume = resolve; });
  const lifecycle = createProcessLifecycle({ runtime, journal: { record: (...value) => records.push(value), close() {} },
    stop: () => { stops++; }, cleanup: async () => { cleanups++; }, forceClose: () => { forced++; },
    schedule: (callback, duration) => { const timer = { callback, duration, cancelled: false }; timers.push(timer); return timer; }, cancel: timer => { timer.cancelled = true; } });
  return { runtime, lifecycle, records, timers, pending, resume, counts: () => ({ stops, cleanups, forced }) };
}

test('coalesces signals, tracks handler completion and does not extend deadline', async () => {
  const item = fixture(); const work = item.lifecycle.track(() => item.pending);
  const stop = item.lifecycle.shutdown('SIGHUP');
  for (let i = 0; i < 10; i++) for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) item.runtime.emit(signal);
  assert.deepEqual(item.counts(), { stops: 1, cleanups: 0, forced: 0 });
  assert.equal(item.timers.length, 1); assert.equal(item.timers[0].duration, 30_000);
  assert.equal(item.lifecycle.admit(), null);
  assert.equal(item.records.filter(record => record[0] === 'shutdown-coalesced').length, 3);
  item.resume(); await work; await stop;
  assert.deepEqual(item.counts(), { stops: 1, cleanups: 1, forced: 0 });
  assert.equal(item.runtime.exitCode, 0); assert.equal(item.timers[0].cancelled, true);
});

test('deadline fails without running unsafe cleanup; fatal monitor does not install crash handlers', () => {
  const item = fixture(); item.lifecycle.admit(); void item.lifecycle.shutdown('SIGTERM');
  item.timers[0].callback(); assert.equal(item.runtime.exitCode, 1);
  assert.deepEqual(item.counts(), { stops: 1, cleanups: 0, forced: 1 });
  assert.equal(item.runtime.listenerCount('uncaughtException'), 0); assert.equal(item.runtime.listenerCount('unhandledRejection'), 0);
  item.runtime.emit('uncaughtExceptionMonitor', new Error('SECRET'), 'unhandledRejection');
  assert.ok(!JSON.stringify(item.records).includes('SECRET'));
});

test('provider cache close waits for an admitted background refresh and prevents publication', async () => {
  let resume; const pending = new Promise(resolve => { resume = resolve; });
  const cache = createSummaryCache(async () => { await pending; return { sessions: [] }; });
  const refresh = cache.refresh(); let closed = false;
  const closing = cache.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  resume(); await assert.rejects(refresh, error => error.reason === 'closed'); await closing;
  assert.equal(closed, true); assert.equal(cache.initialized(), false);
});

test('completed shutdown preserves an existing nonzero exit status', async () => {
  const item = fixture(); item.runtime.exitCode = 7;
  await item.lifecycle.shutdown('SIGTERM'); assert.equal(item.runtime.exitCode, 7);
});
