import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SIGNALS = new Set(['SIGINT', 'SIGTERM', 'SIGHUP']);
const EVENTS = new Set(['start', 'listening', 'shutdown-requested', 'shutdown-coalesced', 'cleanup-complete', 'cleanup-failed', 'deadline', 'fatal', 'exit']);
const REASONS = new Set(['server-closed', 'listen-failed', 'startup-failed', 'uncaughtException', 'unhandledRejection']);

export function createLifecycleJournal(appDirectory) {
  const runId = randomUUID(); let descriptor; let lastError = null; let lastRecordedAt = null;
  function fail(code) {
    if (lastError) return;
    lastError = code;
    console.error(`Lifecycle record unavailable (${code}); this run will not write further records.`);
  }
  try {
    const directory = path.join(appDirectory, '.lifecycle');
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || process.getuid && info.uid !== process.getuid()) {
      fail('unsafe-directory');
    } else {
      descriptor = openSync(path.join(directory, `${runId}.jsonl`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      const file = fstatSync(descriptor); const currentDirectory = lstatSync(directory);
      if (!file.isFile() || file.nlink !== 1 || (file.mode & 0o077) || currentDirectory.dev !== info.dev || currentDirectory.ino !== info.ino) fail('unsafe-file');
    }
  } catch { fail('open-failed'); }
  function record(event, detail = {}) {
    if (lastError || descriptor === undefined || !EVENTS.has(event)) return;
    const timestamp = new Date().toISOString();
    const item = { version: 1, timestamp, pid: process.pid, runId, event };
    if (SIGNALS.has(detail.signal)) item.signal = detail.signal;
    if (REASONS.has(detail.reason)) item.reason = detail.reason;
    if (Number.isInteger(detail.exitCode) && detail.exitCode >= 0 && detail.exitCode <= 255) item.exitCode = detail.exitCode;
    const buffer = Buffer.from(JSON.stringify(item) + '\n');
    try {
      // A partial record is evidence of failure. Do not append to or repair that run again.
      if (writeSync(descriptor, buffer) !== buffer.length) { fail('write-failed'); return; }
      lastRecordedAt = timestamp;
    } catch { fail('write-failed'); }
  }
  function close() { if (descriptor !== undefined) { try { closeSync(descriptor); } catch { fail('close-failed'); } descriptor = undefined; } }
  return Object.freeze({ record, close, status: () => ({ available: !lastError && descriptor !== undefined, lastError, lastRecordedAt }) });
}

export function createProcessLifecycle({ journal, stop, cleanup, forceClose, runtime = process, schedule = setTimeout, cancel = clearTimeout }) {
  let stopping = false; let completion; let timer; let active = 0; let drained;
  const duplicates = new Set();
  function admit() {
    if (stopping) return null;
    active++;
    let finished = false;
    return () => { if (!finished) { finished = true; active--; if (!active) { drained?.(); drained = null; } } };
  }
  async function track(operation) {
    const finish = admit();
    if (!finish) return;
    try { return await operation(); } finally { finish(); }
  }
  function waitForWork() { return active ? new Promise(resolve => { drained = resolve; }) : Promise.resolve(); }
  function shutdown(cause) {
    if (stopping) {
      if (SIGNALS.has(cause) && !duplicates.has(cause)) { duplicates.add(cause); journal.record('shutdown-coalesced', { signal: cause }); }
      return completion;
    }
    stopping = true;
    const detail = SIGNALS.has(cause) ? { signal: cause } : { reason: cause };
    journal.record('shutdown-requested', detail);
    timer = schedule(() => {
      journal.record('deadline', { exitCode: 1 });
      try { forceClose(); } finally { runtime.exit(1); }
    }, 30_000);
    let stopFailure;
    try { stop(); } catch { stopFailure = true; }
    completion = (async () => {
      try {
        await waitForWork();
        if (stopFailure) throw new Error('Shutdown stop failed.');
        await cleanup();
        journal.record('cleanup-complete');
      } catch {
        runtime.exitCode = 1;
        journal.record('cleanup-failed', { exitCode: 1 });
        console.error('Dashboard cleanup failed; explicit ownership recovery may be required.');
      }
      cancel(timer);
      runtime.exit(Number(runtime.exitCode) || 0);
    })();
    return completion;
  }
  for (const signal of SIGNALS) runtime.on(signal, () => { void shutdown(signal); });
  runtime.on('uncaughtExceptionMonitor', (_error, origin) => { journal.record('fatal', { reason: origin, exitCode: 1 }); });
  runtime.once('exit', code => { journal.record('exit', { exitCode: code }); journal.close(); });
  journal.record('start');
  return Object.freeze({ admit, track, shutdown, stopping: () => stopping });
}
