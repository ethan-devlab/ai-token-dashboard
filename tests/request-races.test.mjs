import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestChannels } from '../public/scripts/request-channels.mjs';

function deferred() { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
const json = (payload, status = 200) => Response.json(payload, { status });

test('late fetch rejection after replacement is stale and cannot remove the current channel', async () => {
  const pending = []; const channels = createRequestChannels((url, options) => { const task = { ...deferred(), signal: options.signal }; pending.push(task); return task.promise; });
  const first = channels.request('diagnostics', '/codex');
  const second = channels.request('diagnostics', '/claude');
  pending[0].reject(new TypeError('late network failure'));
  assert.equal((await first).stale, true); assert.equal(pending[1].signal.aborted, false);
  channels.abort('diagnostics'); assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve(json({ provider: 'claude' })); assert.equal((await second).stale, true);
});

test('body parse rejection after destroy is stale even when parsing ignores the signal', async () => {
  const body = deferred(); const started = deferred();
  const channels = createRequestChannels(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: () => { started.resolve(); return body.promise; } }));
  const pending = channels.request('update', '/api/update', { method: 'POST' }); await started.promise;
  channels.destroy(); body.reject(new SyntaxError('late invalid JSON'));
  assert.equal((await pending).stale, true);
});

test('Codex to Claude to Codex does not accept the first Codex failure', async () => {
  const pending = []; const channels = createRequestChannels(() => { const task = deferred(); pending.push(task); return task.promise; });
  const first = channels.request('accountUsage', '/codex'); channels.destroy();
  const middle = channels.request('accountUsage', '/claude'); channels.destroy();
  const current = channels.request('accountUsage', '/codex');
  pending[2].resolve(json({ provider: 'codex', remaining: 75 })); assert.equal((await current).payload.remaining, 75);
  pending[0].reject(new TypeError('old Codex failed')); pending[1].resolve(json({ provider: 'claude' }));
  assert.equal((await first).stale, true); assert.equal((await middle).stale, true);
});

test('stale headers skip body consumption', async () => {
  const fetched = deferred(); let read = false;
  const channels = createRequestChannels(() => fetched.promise); const pending = channels.request('detail', '/detail'); channels.abort('detail');
  fetched.resolve({ ok: true, headers: { get: () => 'application/json' }, json: () => { read = true; throw new Error('must not parse'); } });
  assert.equal((await pending).stale, true); assert.equal(read, false);
});

test('stale export blob rejection is suppressed', async () => {
  const body = deferred(); const started = deferred();
  const channels = createRequestChannels(async () => ({ ok: true, headers: { get: () => 'application/json' }, blob: () => { started.resolve(); return body.promise; } }));
  const pending = channels.request('export', '/export', { responseType: 'blob' }); await started.promise; channels.abort('export'); body.reject(new TypeError('late body transport error'));
  assert.equal((await pending).stale, true);
});

test('active fetch and body errors remain visible', async () => {
  const network = new TypeError('current network error'); const syntax = new SyntaxError('current body error');
  await assert.rejects(createRequestChannels(async () => { throw network; }).request('update', '/update'), (error) => error === network);
  await assert.rejects(createRequestChannels(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => { throw syntax; } })).request('diagnostics', '/diagnostics'), (error) => error === syntax);
});

test('unrelated channels and current HTTP conflict metadata remain independent', async () => {
  const diagnostic = deferred(); const channels = createRequestChannels((url) => url === '/diagnostics' ? diagnostic.promise : Promise.resolve(json({ error: { code: 'PROJECTION_CONFLICT', message: 'changed', retainedSnapshot: true } }, 409)));
  const pending = channels.request('diagnostics', '/diagnostics');
  await assert.rejects(channels.request('export', '/export'), { code: 'PROJECTION_CONFLICT', message: 'changed', retainedSnapshot: true });
  diagnostic.resolve(json({ provider: 'codex' })); assert.equal((await pending).stale, false);
});
