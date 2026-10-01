import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-pricing-ownership-http-'));
const children = []; const evidence = { fixtureOnly: true, node: process.version, checks: [] };
let writer; let reader;
async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; const closed = once(probe, 'close'); probe.close(); await closed; return port;
}
async function stop(instance, signal = 'SIGTERM') {
  if (instance.child.exitCode != null || instance.child.signalCode != null) return;
  const exited = once(instance.child, 'exit'); instance.child.kill(signal);
  await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => { instance.child.kill('SIGKILL'); throw new Error('Fixture did not exit.'); })]);
}
function launch(port, args = [], app = root) {
  const child = spawn(process.execPath, ['--import', path.join(app, 'offline.mjs'), path.join(app, 'server.mjs'), ...args],
    { cwd: app, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: path.join(root, 'codex'),
      CLAUDE_SESSIONS_DIR: path.join(root, 'claude'), CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), AUTO_REFRESH: '0', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const instance = { child, base: `http://127.0.0.1:${port}`, output: '', fetches: 0, stages: [] };
  child.stdout.on('data', (data) => { instance.output += data; }); child.stderr.on('data', (data) => { instance.output += data; });
  child.on('message', (message) => { if (message.type === 'fetch') instance.fetches++; if (message.type === 'stage') instance.stages.push(message.stage); });
  children.push(instance); return instance;
}
async function waitFor(test) { for (let i = 0; i < 200; i++) { if (await test()) return; await delay(20); } throw new Error('Fixture condition timed out.'); }
async function start(port) {
  port ??= await freePort();
  const instance = launch(port); await waitFor(async () => {
    if (instance.child.exitCode != null) throw new Error('Fixture exited: ' + instance.output);
    if (!instance.output.includes('Local AI Token Dashboard:')) return false;
    return (await fetch(instance.base + '/api/providers')).ok;
  }); return instance;
}
async function json(instance, route, expected = 200, init) { const response = await fetch(instance.base + route, init); assert.equal(response.status, expected, route); return response.json(); }
const route = (action = 'dashboard', provider = 'codex') => `/api/${action}?provider=${provider}&mode=all&timezone=UTC`;
const dashboard = (instance, provider) => json(instance, route('dashboard', provider));
const post = (instance, action, provider = 'codex', expected = 200) => json(instance, route('pricing/' + action, provider), expected, { method: 'POST', headers: { Origin: instance.base } });
const statePath = path.join(root, 'fixture-state.json');
const state = (value) => writeFile(statePath, JSON.stringify({ input: 7, offline: true, ...value }));
async function pricingFiles() {
  const files = {};
  async function walk(dir) { for (const name of await readdir(dir)) { const file = path.join(dir, name); if ((await stat(file)).isDirectory()) await walk(file); else files[path.relative(root, file)] = await readFile(file, 'utf8'); } }
  for (const name of (await readdir(root)).filter((name) => name.startsWith('.pricing') || name.startsWith('.claude-pricing'))) {
    const file = path.join(root, name); try { if ((await stat(file)).isDirectory()) await walk(file); else files[name] = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files;
}
async function unlock(args, expected = 0) {
  const command = launch(await freePort(), args); const [code] = await once(command.child, 'exit'); assert.equal(code, expected); assert.equal(command.fetches, 0); return command;
}
async function unlockBoth() { await unlock(['--unlock-pricing']); await unlock(['--unlock-settings']); }
const mark = (name) => evidence.checks.push(name);

try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const html = path.join(root, 'public', 'index.html'); await writeFile(html, (await readFile(html, 'utf8')).replace('<main ', '<p role="status">TEST ONLY pricing ownership QA. Isolated app, two servers, synthetic logs and prices. External requests are blocked.</p><main '));
  await mkdir(path.join(root, 'codex')); await mkdir(path.join(root, 'claude'));
  await writeFile(path.join(root, 'codex', 'fixture.jsonl'), [{ type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { id: 'TEST_ONLY', model: 'gpt-5.5' } }, { type: 'turn.completed', timestamp: '2026-10-01T00:00:01Z', model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 0 } }].map(JSON.stringify).join('\n') + '\n');
  await writeFile(path.join(root, 'claude', 'fixture.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T00:00:01Z', sessionId: 'TEST_ONLY', message: { id: 'TEST_ONLY_message', model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 0 } } }) + '\n');
  await state({});
  await writeFile(path.join(root, 'offline.mjs'), `import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {PRICING,CLAUDE_PRICING} from './server/pricing.mjs';
const state=async()=>JSON.parse(await fs.readFile(new URL('./fixture-state.json',import.meta.url),'utf8'));
async function checkpoint(stage){if((await state()).killAt===stage){process.send?.({type:'stage',stage});await new Promise(()=>{});}}
const link=fs.link,rename=fs.rename,write=fs.writeFile;
fs.link=async(...args)=>{const result=await link(...args);if(String(args[1]).includes('.pricing-archive')&&String(args[1]).endsWith('.json'))await checkpoint('archive');return result;};
fs.writeFile=async(...args)=>{const result=await write(...args);if(String(args[0]).includes('.pricing-cache.json.')&&String(args[0]).endsWith('.tmp'))await checkpoint('cache-temp');return result;};
fs.rename=async(...args)=>{const mode=await state();if(mode.failPublish&&String(args[1]).endsWith('.pricing-cache.json'))throw new Error('TEST ONLY publication failure');const result=await rename(...args);if(String(args[1]).endsWith('.pricing-cache.json'))await checkpoint('publication');if(String(args[1]).includes('.quarantine-'))await checkpoint('quarantine');return result;};
syncBuiltinESMExports();
globalThis.fetch=async(url)=>{process.send?.({type:'fetch'});const mode=await state();if(mode.delay)await new Promise(r=>setTimeout(r,mode.delay));if(mode.offline)return Response.json({}, {status:503});
 const claude=String(url).includes('platform.claude.com');if(!claude&&!String(url).includes('developers.openai.com'))return Response.json({}, {status:503});
 const price=v=>v==null?'-':'$'+v;
 const header=claude?'| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |':'| Model | Short context input | Short context cached input | Short context cache writes | Short context output |';
 const rows=Object.entries((claude?CLAUDE_PRICING:PRICING).rates).map(([id,r])=>'| '+[id,...(claude?[price(mode.input),price(r.cacheWrite5m),price(r.cacheWrite1h),price(r.cachedInput),price(r.output)]:[price(mode.input),price(r.cachedInput),price(r.cacheWrite),price(r.output)])].join(' | ')+' |');
 return new Response((claude?'':'### Standard pricing data\\n')+header+'\\n|---|---|---|---|---|---|\\n'+rows.join('\\n'),{headers:{'content-type':'text/markdown'}});};
`);
  writer = await start(); reader = await start();
  await dashboard(writer, 'claude'); await delay(60);
  for (const provider of ['codex', 'claude']) {
    const w = await dashboard(writer, provider); const r = await dashboard(reader, provider);
    assert.equal(w.pricing.refresh.writable, true); assert.equal(r.pricing.refresh.writable, false); assert.equal(r.pricing.archive.available, true); assert.equal(r.totals.totalTokens, 10);
    const files = await pricingFiles(); await post(reader, 'refresh', provider, 409); await post(reader, 'repair', provider, 409); await post(reader, 'load', provider);
    assert.deepEqual(await pricingFiles(), files); assert.equal(reader.fetches, 0);
  }
  mark('two real processes; both Providers; reader zero fetches and byte-identical pricing files');
  await unlock(['--unlock-pricing'], 1); mark('active pricing owner unlock refused without fetching');
  await state({ offline: false, input: 7 }); const old = await dashboard(reader);
  await post(writer, 'refresh'); const updated = await dashboard(writer); assert.notEqual(updated.pricing.revision, old.pricing.revision);
  const claudeUpdated = await post(writer, 'refresh', 'claude');
  const claudeLoaded = await post(reader, 'load', 'claude');
  assert.equal(claudeLoaded.pricing.revision, claudeUpdated.pricing.revision);
  assert.equal(claudeLoaded.cost.total, claudeUpdated.cost.total);
  assert.equal((await dashboard(reader)).pricing.revision, old.pricing.revision); const loaded = await post(reader, 'load'); assert.equal(loaded.pricing.revision, updated.pricing.revision);
  mark('manual reader load changes the full projection only after successful publication');
  await state({ offline: false, input: 9, failPublish: true }); await post(writer, 'refresh', 'codex', 502); assert.equal((await dashboard(writer)).pricing.revision, updated.pricing.revision);
  await state({}); await stop(writer); writer = await start(); assert.equal((await dashboard(writer)).pricing.revision, updated.pricing.revision);
  mark('failed publication retains old in-memory and restarted version; archive-only candidate stays inactive');
  const cache = path.join(root, '.pricing-cache.json'); const pointer = await readFile(cache, 'utf8'); await writeFile(cache, 'TEST ONLY corrupt pointer');
  await post(reader, 'load', 'codex', 503); assert.equal((await dashboard(reader)).pricing.archive.available, true); await writeFile(cache, pointer);
  const basis = path.join(root, '.pricing-archive', 'codex', updated.pricing.revision + '.json');
  const admitted = await dashboard(reader); const pin = `&projection=${admitted.projection.key}&projectionAt=${admitted.projection.at}`;
  const prepared = await json(reader, route('export/prepare') + '&format=json-report' + pin, 200, { method: 'POST', headers: { Origin: reader.base } });
  await writeFile(basis, 'TEST ONLY damaged basis'); const beforeQueries = await pricingFiles(); const unknown = await dashboard(reader); assert.equal(unknown.cost.total, null); assert.equal(unknown.totals.totalTokens, 10);
  assert.equal(unknown.models[0].cost, null); assert.equal(unknown.trend.points[0].cost, null);
  assert.equal((await json(reader, route('sessions'))).sessions[0].pricingStatus, 'unknown');
  const detail = await json(reader, `/api/sessions/${unknown.sessions[0].sessionKey}?provider=codex&mode=all&timezone=UTC`); assert.equal(detail.cost.total, null);
  await json(reader, route('summary')); await json(reader, route('refresh'), 200, { method: 'POST', headers: { Origin: reader.base } });
  const download = await json(reader, prepared.downloadUrl); assert.equal(download.cost.total, admitted.cost.total);
  for (const format of ['json-report', 'csv-sessions', 'csv-trend', 'markdown-summary']) { const response = await fetch(reader.base + route('export') + '&format=' + format); assert.equal(response.status, 200); const text = await response.text(); if (format === 'json-report') assert.equal(JSON.parse(text).cost.total, null); else assert.ok(text.length > 0); }
  assert.deepEqual(await pricingFiles(), beforeQueries);
  mark('every cost route revalidates corruption; reads preserve files; admitted native export keeps its old cost');
  await state({ failPublish: true }); await post(writer, 'repair', 'codex', 502);
  assert.equal((await dashboard(reader)).cost.total, null); await post(reader, 'load', 'codex', 503);
  await state({});
  const repaired = await post(writer, 'repair'); assert.equal(repaired.pricing.archive.available, true); assert.ok(Object.entries(await pricingFiles()).some(([name, body]) => name.includes('.quarantine-') && body === 'TEST ONLY damaged basis'));
  assert.equal(repaired.pricing.archive.firstArchivedAt, updated.pricing.archive.firstArchivedAt);
  await post(reader, 'load'); mark('offline retained-basis repair preserves corrupt bytes and publishes before cost recovery');
  const check = basis.replace(/\.json$/, '.check.json'); await writeFile(check, 'TEST ONLY damaged check'); const metadata = await dashboard(writer); assert.equal(metadata.pricing.refresh.metadataError, 'metadata'); assert.equal(metadata.pricing.refresh.lastCheckedAt, null); assert.equal(metadata.cost.total, repaired.cost.total); await post(writer, 'repair'); mark('metadata damage leaves verified costs available and check time unknown');
  // Actual SIGKILL checkpoints occur inside the copied service's file operations.
  for (const [stage, input, expectNew] of [['archive', 11, false], ['cache-temp', 13, false], ['publication', 15, true]]) {
    const preceding = await dashboard(writer); await state({ offline: false, input, killAt: stage });
    const request = fetch(writer.base + route('pricing/refresh'), { method: 'POST', headers: { Origin: writer.base } }).then(() => {}, () => {});
    await waitFor(() => writer.stages.includes(stage)); await stop(writer, 'SIGKILL'); await request;
    await state({}); await unlockBoth(); writer = await start(); const recovered = await dashboard(writer);
    assert.equal(recovered.pricing.archive.available, true);
    assert.equal(recovered.pricing.revision === preceding.pricing.revision, !expectNew);
    assert.equal((await dashboard(reader)).pricing.refresh.writable, false);
    mark(`SIGKILL after ${stage}: restart uses ${expectNew ? 'new published' : 'previous published'} basis`);
  }
  const active = await dashboard(writer); const activeFile = path.join(root, '.pricing-archive', 'codex', active.pricing.revision + '.json'); await writeFile(activeFile, 'TEST ONLY interrupted repair'); await state({ killAt: 'quarantine' });
  const repairRequest = fetch(writer.base + route('pricing/repair'), { method: 'POST', headers: { Origin: writer.base } }).then(() => {}, () => {});
  await waitFor(() => writer.stages.includes('quarantine')); await stop(writer, 'SIGKILL'); await repairRequest;
  await state({}); await unlockBoth(); writer = await start(); assert.equal((await dashboard(writer)).cost.total, null);
  await post(writer, 'repair', 'codex', 502); assert.equal((await dashboard(writer)).cost.total, null);
  await state({ offline: false, input: 15 }); await post(writer, 'repair'); await post(reader, 'load'); await state({});
  mark('SIGKILL after quarantine preserves evidence; unknown restart requires newly validated source');
  await stop(writer); assert.equal((await dashboard(reader)).pricing.refresh.writable, false); writer = await start(); assert.equal((await dashboard(writer)).pricing.refresh.writable, true);
  mark('normal release does not promote a running reader; restart acquires the independent pricing lease');
  const ownerFile = path.join(root, '.pricing.writer-lock', 'owner.json');
  const ownerRecord = JSON.parse(await readFile(ownerFile)); await writeFile(ownerFile, JSON.stringify({ ...ownerRecord, generation: '00000000-0000-0000-0000-000000000000' }));
  const beforeLostWrite = await pricingFiles(); const fetches = writer.fetches;
  await post(writer, 'refresh', 'codex', 409); await post(writer, 'repair', 'codex', 409);
  assert.deepEqual(await pricingFiles(), beforeLostWrite); assert.equal(writer.fetches, fetches);
  assert.equal((await json(writer, '/api/settings')).writable, true);
  await stop(writer); await unlock(['--unlock-pricing']); writer = await start();
  mark('lost pricing generation blocks writes/fetches while settings remain writable; explicit dead-owner recovery works');
  const failedListener = launch(Number(new URL(writer.base).port)); await once(failedListener.child, 'exit'); assert.equal(failedListener.child.exitCode, 1); assert.equal(failedListener.fetches, 0);
  mark('occupied listen failure exits without fetching or releasing another owner');
  const failureApp = path.join(root, 'listen-failure-app'); await mkdir(failureApp);
  await Promise.all(['server', 'public', 'server.mjs', 'package.json'].map((name) => cp(path.join(root, name), path.join(failureApp, name), { recursive: true })));
  await writeFile(path.join(failureApp, 'offline.mjs'), "globalThis.fetch=async()=>{process.send?.({type:'fetch'});return Response.json({}, {status:503});};\n");
  const ownFailedListener = launch(Number(new URL(writer.base).port), [], failureApp); await once(ownFailedListener.child, 'exit'); assert.equal(ownFailedListener.child.exitCode, 1); assert.equal(ownFailedListener.fetches, 0);
  for (const name of ['.pricing.writer-lock', '.env.settings-lock']) await assert.rejects(stat(path.join(failureApp, name)), { code: 'ENOENT' });
  mark('failed listen with its own acquired generation releases both independent locks');
  console.log(JSON.stringify({ status: 'passed', ...evidence }));
  if (process.argv.includes('--serve')) {
    console.log(JSON.stringify({ fixture: root, writer: writer.base, reader: reader.base, commands: ['publish', 'corrupt', 'bad-pointer', 'metadata', 'offline', 'delayed', 'exit'] }));
    await new Promise((resolve) => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.on('data', async (chunk) => {
        const command = String(chunk).trim();
        try {
          if (command === 'publish') { await state({ offline: false, input: 19 }); await post(writer, 'refresh'); await state({}); }
          if (command === 'corrupt') { const active = await dashboard(writer); await writeFile(path.join(root, '.pricing-archive', 'codex', active.pricing.revision + '.json'), 'TEST ONLY desktop damaged basis'); }
          if (command === 'bad-pointer') await writeFile(cache, 'TEST ONLY desktop bad publication');
          if (command === 'metadata') { const active = await dashboard(writer); await writeFile(path.join(root, '.pricing-archive', 'codex', active.pricing.revision + '.check.json'), 'TEST ONLY desktop bad metadata'); }
          if (command === 'offline') await state({});
          if (command === 'delayed') await state({ offline: false, input: 21, delay: 2000 });
          if (command === 'exit') resolve();
          console.log('TEST ONLY command completed: ' + command);
        } catch (error) { console.log('TEST ONLY command failed: ' + error.message); }
      }); process.stdin.resume();
    }); process.stdin.pause();
  }
} finally {
  await Promise.all(children.map((instance) => stop(instance).catch(() => {})));
  await rm(root, { recursive: true, force: true });
}
