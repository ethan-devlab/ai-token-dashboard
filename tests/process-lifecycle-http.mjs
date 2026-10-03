import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, symlink, chmod } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-lifecycle-http-'));
const children = []; const sockets = [];
const secret = 'TEST_ONLY_SECRET_DO_NOT_RECORD';
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(20); }
  throw new Error('Fixture condition timed out.');
}
async function exists(file) { return Boolean(await stat(file).catch(() => null)); }
async function absent(file) { assert.equal(await exists(file), false, path.basename(file)); }
async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; const closed = once(server, 'close'); server.close(); await closed; return port;
}
async function fixture(name, mode = {}) {
  const directory = path.join(root, name); await mkdir(directory);
  await Promise.all(['server', 'public'].map(value => cp(path.join(source, value), path.join(directory, value), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map(value => cp(path.join(source, value), path.join(directory, value))));
  await mkdir(path.join(directory, 'codex')); await mkdir(path.join(directory, 'claude'));
  await writeFile(path.join(directory, '.env'), `CODEX_SESSIONS_DIR=${path.join(directory, 'codex')}\nCLAUDE_SESSIONS_DIR=${path.join(directory, 'claude')}\nAUTO_REFRESH=0\nUPDATE_REPOSITORY=\n`);
  await writeFile(path.join(directory, 'mode.json'), JSON.stringify(mode));
  await writeFile(path.join(directory, 'offline.mjs'), `import fs from 'node:fs';
import promises from 'node:fs/promises';
import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
const root=new URL('./',import.meta.url); const mode=JSON.parse(fs.readFileSync(new URL('mode.json',root),'utf8'));
globalThis.fetch=async()=>Response.json({}, {status:503});
const rename=promises.rename;
promises.rename=async function(from,to){
 const settings=String(to)===new URL('.env',root).pathname;
 const pricing=String(to)===new URL('.pricing-cache.json',root).pathname;
 if((settings&&mode.settingsDelay)||(pricing&&mode.pricingDelay)){
   fs.writeFileSync(new URL(settings?'expected-settings':'expected-pricing',root),fs.readFileSync(from));
   fs.writeFileSync(new URL(settings?'settings-started':'pricing-started',root),'started');
   if((settings?mode.settingsDelay:mode.pricingDelay)==='stall')await new Promise(()=>{});
   else await new Promise(resolve=>setTimeout(resolve,settings?mode.settingsDelay:mode.pricingDelay));
 }
 if(mode.releaseFailure&&String(to).includes('.env.settings-lock.retired-'))throw new Error('${secret}');
 return rename.call(this,from,to);
};
const open=fs.openSync;const write=fs.writeSync;const journalFDs=new Set();let writes=0;
fs.openSync=function(file,...args){if(String(file).includes('/.lifecycle/')){
 if(mode.openFailure)throw new Error('${secret}');const fd=open.call(this,file,...args);journalFDs.add(fd);return fd;}
 return open.call(this,file,...args);};
fs.writeSync=function(fd,buffer,...args){if(journalFDs.has(fd)&&++writes>=Number(mode.failWrite||Infinity)){
 fs.appendFileSync(new URL('journal-failed',root),'attempt\\n');
 if(mode.partialWrite)return write.call(this,fd,buffer,0,Math.min(8,buffer.length));
 throw new Error('${secret}');}return write.call(this,fd,buffer,...args);};
const create=http.createServer;http.createServer=function(listener){return create.call(this,(req,res)=>{
 if(mode.slowExport&&req.url.startsWith('/api/export?')){const write=res.write;res.write=function(chunk,callback){return write.call(this,chunk,error=>setTimeout(()=>callback?.(error),250));};}
 if(req.url==='/api/fixture/fatal')setTimeout(()=>{throw new Error('${secret}');},20);
 if(req.url==='/api/fixture/rejection')setTimeout(()=>{void Promise.reject(new Error('${secret}'));},20);
 return listener(req,res);
});};syncBuiltinESMExports();
`);
  return { directory, settingsLock: path.join(directory, '.env.settings-lock'), pricingLock: path.join(directory, '.pricing.writer-lock') };
}
async function launch(item, args = [], host = '127.0.0.1') {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', path.join(item.directory, 'offline.mjs'), path.join(item.directory, 'server.mjs'), ...args],
    { cwd: item.directory, env: { HOST: host, PORT: String(port), ALLOW_REMOTE: host === '0.0.0.0' ? '1' : '0', CODEX_HOME: path.join(item.directory, 'codex'), CLAUDE_CONFIG_DIR: path.join(item.directory, 'claude'), TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { ...item, child, base: `http://127.0.0.1:${port}`, port, output: '', exited: null };
  instance.exit = new Promise(resolve => child.once('exit', (code, signal) => { instance.exited = { code, signal }; resolve(instance.exited); }));
  child.stdout.on('data', chunk => { instance.output += chunk; }); child.stderr.on('data', chunk => { instance.output += chunk; });
  children.push(instance); return instance;
}
async function ready(instance) {
  await until(() => { if (instance.exited) throw new Error('Fixture exited before listening.'); return instance.output.includes('Local AI Token Dashboard:'); });
  return instance;
}
async function get(instance, route = '/api/diagnostics') {
  const result = await fetch(instance.base + route); assert.equal(result.status, 200); return result.json();
}
async function journal(instance) {
  const files = await readdir(path.join(instance.directory, '.lifecycle'));
  const bodies = await Promise.all(files.map(file => readFile(path.join(instance.directory, '.lifecycle', file), 'utf8')));
  assert.ok(!bodies.join('').includes(secret));
  return bodies.map(body => body.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
}
async function stop(instance, signal = 'SIGTERM', timeout = 6000) {
  if (!instance.exited) instance.child.kill(signal);
  await until(() => Boolean(instance.exited), timeout); return instance.exited;
}
async function released(instance) { await absent(instance.settingsLock); await absent(instance.pricingLock); }
async function partialRequest(instance, origin) {
  const socket = net.connect(instance.port, '127.0.0.1'); sockets.push(socket); let output = '';
  socket.on('data', chunk => { output += chunk; }); await once(socket, 'connect');
  socket.write(`GET /api/diagnostics HTTP/1.1\r\nHost: 127.0.0.1:${instance.port}\r\n${origin ? 'Origin: https://example.invalid\r\n' : ''}`);
  await delay(30);
  return { complete: async () => { socket.end('\r\n'); await until(() => output.includes('\r\n\r\n')); return output; } };
}

try {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const instance = await ready(await launch(await fixture(signal)));
    const diagnostics = await get(instance); assert.deepEqual(Object.keys(diagnostics.lifecycle).sort(), ['available', 'lastError', 'lastRecordedAt']);
    assert.equal(diagnostics.lifecycle.available, true); assert.equal(diagnostics.lifecycle.lastError, null);
    assert.equal((await fetch(instance.base + '/api/diagnostics', { headers: { Origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await fetch(instance.base + '/api/diagnostics', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.deepEqual(await stop(instance, signal), { code: 0, signal: null }); await released(instance);
    const records = (await journal(instance))[0];
    assert.deepEqual(records.map(value => value.event), ['start', 'listening', 'shutdown-requested', 'cleanup-complete', 'exit']);
    assert.equal(records[2].signal, signal); assert.equal(records.at(-1).exitCode, 0);
    const restart = await ready(await launch(instance)); assert.equal((await get(restart, '/api/settings')).writable, true);
    await stop(restart); assert.equal((await journal(instance)).length, 2);
  }
  console.log('PASS: three graceful signals, lock release, separate journals, source guards and restart.');

  const slow = await ready(await launch(await fixture('delayed-save', { settingsDelay: 700 })));
  const before = await get(slow, '/api/settings'); const controller = new AbortController();
  const saving = fetch(slow.base + '/api/settings', { method: 'POST', signal: controller.signal, headers: { Origin: slow.base, 'Content-Type': 'application/json', 'If-Match': `"${before.revision}"` }, body: JSON.stringify({ ...before.settings, MAX_FILES: '987' }) }).catch(() => null);
  await until(() => exists(path.join(slow.directory, 'settings-started')));
  const accepted = await partialRequest(slow, false); const denied = await partialRequest(slow, true);
  controller.abort(); slow.child.kill('SIGHUP'); await delay(50);
  slow.child.kill('SIGTERM'); slow.child.kill('SIGINT'); await delay(50); slow.child.kill('SIGHUP');
  assert.equal(await exists(slow.settingsLock), true); assert.equal(await exists(slow.pricingLock), true);
  assert.ok((await accepted.complete()).startsWith('HTTP/1.1 503')); assert.ok((await denied.complete()).startsWith('HTTP/1.1 403'));
  await saving; assert.deepEqual(await stop(slow), { code: 0, signal: null }); await released(slow);
  assert.deepEqual(await readFile(path.join(slow.directory, '.env')), await readFile(path.join(slow.directory, 'expected-settings')));
  assert.ok((await readFile(path.join(slow.directory, '.env'), 'utf8')).includes('MAX_FILES=987\n'));
  const slowRecords = (await journal(slow))[0]; assert.equal(slowRecords.filter(value => value.event === 'cleanup-complete').length, 1);
  assert.equal(slowRecords.find(value => value.event === 'shutdown-requested').signal, 'SIGHUP');
  assert.ok(slowRecords.filter(value => value.event === 'shutdown-coalesced').length <= 3);
  console.log('PASS: disconnected save completes before lock release, coalesced signals, stopping gate preserves Origin policy.');

  const exporting = await fixture('active-export', { slowExport: true });
  for (let index = 0; index < 10; index++) await writeFile(path.join(exporting.directory, 'codex', `${index}.jsonl`), [
    { type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { id: 'TEST_ONLY_' + index + 'x'.repeat(100000), model: 'gpt-5.5' } },
    { type: 'turn.completed', timestamp: '2026-10-01T00:00:00Z', model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 0 } },
  ].map(JSON.stringify).join('\n') + '\n');
  const transfer = await ready(await launch(exporting));
  const downloading = await fetch(transfer.base + '/api/export?format=csv-sessions&mode=all&timezone=UTC');
  assert.equal(downloading.status, 200); const downloadingReader = downloading.body.getReader();
  const firstChunk = await downloadingReader.read(); assert.equal(firstChunk.done, false);
  const remaining = (async () => { for (;;) { if ((await downloadingReader.read()).done) return; } })();
  const interrupted = assert.rejects(remaining); transfer.child.kill('SIGHUP'); await interrupted;
  assert.deepEqual(await stop(transfer), { code: 0, signal: null }); await released(transfer);
  console.log('PASS: active streamed download is interrupted before graceful ownership release.');

  const startup = await launch(await fixture('startup', { pricingDelay: 500 }));
  await until(() => exists(path.join(startup.directory, 'pricing-started'))); startup.child.kill('SIGHUP');
  assert.equal(await exists(startup.pricingLock), true); assert.deepEqual(await stop(startup), { code: 0, signal: null });
  await released(startup); assert.ok(!startup.output.includes('Local AI Token Dashboard:'));
  assert.equal((await journal(startup))[0].some(value => value.event === 'listening'), false);
  assert.equal(JSON.parse(await readFile(path.join(startup.directory, '.pricing-cache.json'), 'utf8')).version, 1);
  assert.deepEqual(await readFile(path.join(startup.directory, '.pricing-cache.json')), await readFile(path.join(startup.directory, 'expected-pricing')));

  const pricing = await ready(await launch(await fixture('delayed-pricing', { pricingDelay: 600 })));
  await rm(path.join(pricing.directory, 'pricing-started'));
  const pricingController = new AbortController();
  const repairing = fetch(pricing.base + '/api/pricing/repair?provider=codex&mode=all&timezone=UTC', { method: 'POST', signal: pricingController.signal, headers: { Origin: pricing.base } }).catch(() => null);
  await until(() => exists(path.join(pricing.directory, 'pricing-started')));
  pricingController.abort(); pricing.child.kill('SIGHUP'); await delay(100);
  assert.equal(await exists(pricing.pricingLock), true); assert.equal(await exists(pricing.settingsLock), true);
  assert.deepEqual(await stop(pricing), { code: 0, signal: null }); await repairing; await released(pricing);
  assert.deepEqual(await readFile(path.join(pricing.directory, '.pricing-cache.json')), await readFile(path.join(pricing.directory, 'expected-pricing')));

  const failedRelease = await ready(await launch(await fixture('release-failure', { releaseFailure: true })));
  assert.equal((await stop(failedRelease)).code, 1); assert.equal(await exists(failedRelease.settingsLock), true);
  assert.ok((await journal(failedRelease))[0].some(value => value.event === 'cleanup-failed'));
  console.log('PASS: interrupted startup waits for publication; cleanup failure exits nonzero and retains failed ownership.');

  for (const kind of ['fatal', 'rejection', 'kill']) {
    const instance = await ready(await launch(await fixture(kind)));
    if (kind === 'kill') instance.child.kill('SIGKILL'); else await fetch(instance.base + `/api/fixture/${kind}`);
    await until(() => Boolean(instance.exited));
    assert.equal(await exists(instance.settingsLock), true); assert.equal(await exists(instance.pricingLock), true);
    const records = (await journal(instance))[0];
    if (kind === 'kill') { assert.equal(instance.exited.signal, 'SIGKILL'); assert.equal(records.at(-1).event, 'listening'); }
    else { assert.equal(instance.exited.code, 1); assert.equal(records.at(-2).event, 'fatal'); assert.equal(records.at(-1).event, 'exit'); }
    const recovered = await ready(await launch(instance)); assert.equal((await get(recovered, '/api/settings')).writable, true);
    for (const provider of (await get(recovered)).providers) assert.equal(provider.pricing.writable, true);
    await stop(recovered);
    await released(instance); assert.equal((await journal(instance)).length, 2);
  }
  console.log('PASS: native fatal exception/rejection and SIGKILL retain locks until startup safely recovers both writers.');

  for (const mode of [{ openFailure: true }, { failWrite: 2 }, { failWrite: 2, partialWrite: true }]) {
    const item = await fixture('journal-fault-' + children.length, mode); const instance = await ready(await launch(item));
    const diagnostic = await get(instance); assert.equal(diagnostic.lifecycle.available, false);
    assert.equal(diagnostic.lifecycle.lastError, mode.openFailure ? 'open-failed' : 'write-failed');
    const body = JSON.stringify(diagnostic.lifecycle); assert.ok(!body.includes(secret)); assert.ok(!body.includes(item.directory));
    const settings = await get(instance, '/api/settings'); assert.equal(settings.writable, true);
    const saved = await fetch(instance.base + '/api/settings', { method: 'POST', headers: { Origin: instance.base, 'Content-Type': 'application/json', 'If-Match': `"${settings.revision}"` }, body: JSON.stringify({ ...settings.settings, MAX_FILES: '876' }) }); assert.equal(saved.status, 200);
    const files = await readdir(path.join(item.directory, '.lifecycle')); const original = await Promise.all(files.map(file => readFile(path.join(item.directory, '.lifecycle', file))));
    await stop(instance); await released(instance);
    for (let index = 0; index < files.length; index++) assert.deepEqual(await readFile(path.join(item.directory, '.lifecycle', files[index])), original[index]);
    if (!mode.openFailure) assert.equal(await readFile(path.join(item.directory, 'journal-failed'), 'utf8'), 'attempt\n');
    await writeFile(path.join(item.directory, 'mode.json'), '{}'); const restarted = await ready(await launch(item)); assert.equal((await get(restarted)).lifecycle.available, true); await stop(restarted);
    assert.equal((await readdir(path.join(item.directory, '.lifecycle'))).length, files.length + 1);
  }
  for (const unsafe of ['symlink', 'permissions']) {
    const item = await fixture(unsafe); const directory = path.join(item.directory, '.lifecycle');
    const outside = path.join(item.directory, 'outside'); await mkdir(outside);
    if (unsafe === 'symlink') await symlink(outside, directory); else { await mkdir(directory); await chmod(directory, 0o755); }
    const instance = await ready(await launch(item)); assert.equal((await get(instance)).lifecycle.lastError, 'unsafe-directory');
    await stop(instance); await released(instance); assert.deepEqual(await readdir(outside), []);
  }
  console.log('PASS: open/write/partial-write faults latch without stopping saves, next run recovers; unsafe directories untouched.');

  const shared = await fixture('concurrent'); const writer = await ready(await launch(shared)); const reader = await ready(await launch(shared));
  assert.equal((await get(writer, '/api/settings')).writable, true); assert.equal((await get(reader, '/api/settings')).writable, false);
  assert.equal((await get(writer)).lifecycle.available, true); assert.equal((await get(reader)).lifecycle.available, true);
  await stop(reader); assert.equal(await exists(writer.settingsLock), true); await stop(writer); await released(writer);
  const sharedRecords = await journal(writer); assert.equal(sharedRecords.length, 2); assert.notEqual(sharedRecords[0][0].runId, sharedRecords[1][0].runId);
  const remote = await ready(await launch(await fixture('remote'), [], '0.0.0.0')); assert.equal((await fetch(remote.base + '/api/diagnostics')).status, 403); await stop(remote);

  if (!process.argv.includes('--skip-deadline')) {
    const stalled = await ready(await launch(await fixture('deadline', { settingsDelay: 'stall' })));
    const settings = await get(stalled, '/api/settings');
    const request = fetch(stalled.base + '/api/settings', { method: 'POST', headers: { Origin: stalled.base, 'Content-Type': 'application/json', 'If-Match': `"${settings.revision}"` }, body: JSON.stringify({ ...settings.settings, MAX_FILES: '765' }) }).catch(() => null);
    await until(() => exists(path.join(stalled.directory, 'settings-started')));
    const begin = Date.now(); stalled.child.kill('SIGHUP'); await delay(250); stalled.child.kill('SIGTERM');
    await until(() => Boolean(stalled.exited), 33_000); const elapsed = Date.now() - begin;
    assert.equal(stalled.exited.code, 1); assert.ok(elapsed >= 29_500 && elapsed < 32_500, String(elapsed));
    assert.equal(await exists(stalled.settingsLock), true); assert.equal(await exists(stalled.pricingLock), true); await request;
    const deadlineRecords = (await journal(stalled))[0]; assert.equal(deadlineRecords.at(-2).event, 'deadline'); assert.equal(deadlineRecords.at(-1).exitCode, 1);
    console.log(`PASS: real 30-second deadline (${elapsed} ms), no extension or unsafe release; concurrent records and remote denial.`);
  }

  if (process.argv.includes('--serve')) {
    const desktop = await ready(await launch(await fixture('desktop'))); const failed = await ready(await launch(await fixture('desktop-failed', { failWrite: 2 })));
    for (const instance of [desktop, failed]) {
      const file = path.join(instance.directory, 'public', 'index.html'); await writeFile(file, (await readFile(file, 'utf8')).replace('<main ', '<p role="status">TEST ONLY lifecycle QA. Isolated application, synthetic empty logs, all external requests blocked.</p><main '));
    }
    console.log(JSON.stringify({ TEST_ONLY: true, root, available: desktop.base, failed: failed.base }));
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.resume(); }); process.stdin.pause();
  }
} finally {
  for (const socket of sockets) socket.destroy();
  for (const instance of children) if (!instance.exited) { instance.child.kill('SIGKILL'); await instance.exit; }
  await rm(root, { recursive: true, force: true });
}
