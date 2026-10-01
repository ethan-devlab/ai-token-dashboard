import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-settings-owner-http-'));
const children = [];
const clock = Date.now();
let writer; let reader;
async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; const closed = once(probe, 'close'); probe.close(); await closed; return port;
}
async function stop(instance, signal = 'SIGTERM') {
  if (instance.child.exitCode != null || instance.child.signalCode != null) return;
  const exited = once(instance.child, 'exit'); instance.child.kill(signal);
  await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => { throw new Error('Isolated process did not exit.'); })]);
}
function launch(port, command = []) {
  const child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs'), ...command],
    { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_HOME: path.join(root, 'codex'),
      CLAUDE_CONFIG_DIR: path.join(root, 'claude'), TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, base: `http://127.0.0.1:${port}`, output: '' };
  child.stdout.on('data', (chunk) => { instance.output += chunk; }); child.stderr.on('data', (chunk) => { instance.output += chunk; });
  children.push(instance); return instance;
}
async function start(port) {
  const instance = launch(port);
  for (let attempt = 0; attempt < 80; attempt++) {
    if (instance.child.exitCode != null || instance.child.signalCode != null) throw new Error('Isolated server exited before readiness.');
    if (instance.output.includes('Local AI Token Dashboard:')) {
      if ((await fetch(instance.base + '/api/providers')).ok) return instance;
    }
    await delay(25);
  }
  throw new Error('Isolated server was not ready.');
}
async function json(instance, route, init) {
  const response = await fetch(instance.base + route, init); assert.equal(response.status, 200); return response.json();
}
async function absent(file) { await assert.rejects(stat(file), (error) => error.code === 'ENOENT'); }

try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  for (const name of ['index.html', 'settings.html']) {
    const file = path.join(root, 'public', name);
    await writeFile(file, (await readFile(file, 'utf8')).replace('<main ', '<p role="status">TEST ONLY ownership QA. Two isolated servers; synthetic logs and credentials; no external requests.</p><main '));
  }
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const timestamp = new Date(clock).toISOString();
  await writeFile(path.join(codex, 'fixture.jsonl'), [{ type: 'session_meta', timestamp, payload: { id: 'TEST_ONLY', model: 'gpt-5.5' } },
    { type: 'turn.completed', timestamp, model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 0 } }].map(JSON.stringify).join('\n') + '\n');
  await writeFile(path.join(claude, 'fixture.jsonl'), JSON.stringify({ type: 'assistant', timestamp, sessionId: 'TEST_ONLY_CLAUDE',
    message: { id: 'TEST_ONLY_EVENT', model: 'claude-opus-5', usage: { input_tokens: 20, output_tokens: 0 } } }) + '\n');
  const credentialFile = path.join(claude, '.credentials.json');
  const credential = (valid) => JSON.stringify({ claudeAiOauth: { accessToken: 'TEST_ONLY-token', refreshToken: 'TEST_ONLY-unused', expiresAt: clock + (valid ? 3600000 : -1) }, unrelated: 'TEST_ONLY' });
  await writeFile(credentialFile, credential(false));
  await writeFile(path.join(root, '.env'), `HOST=127.0.0.1\nPORT=3333\nCODEX_SESSIONS_DIR=${codex}\nCLAUDE_SESSIONS_DIR=${claude}\nAUTO_REFRESH=0\nMAX_FILES=1000\nPARSE_CONCURRENCY=2\nCUSTOM_VALUE=keep\n`);
  const modeFile = path.join(root, 'mode'); await writeFile(modeFile, 'ok');
  const callFile = path.join(root, 'calls'); await writeFile(callFile, '');
  await writeFile(path.join(root, 'offline.mjs'), `import {appendFileSync,readFileSync} from 'node:fs';
Date.now = () => ${clock};
globalThis.fetch = async (url) => {
 const usage=String(url)==='https://api.anthropic.com/api/oauth/usage';
 appendFileSync(new URL('./calls',import.meta.url), (usage?'usage':String(url).endsWith('/oauth/token')?'oauth':'blocked')+'\\n');
 if(!usage) return Response.json({}, {status:503});
 const mode=readFileSync(new URL('./mode',import.meta.url),'utf8');
 if(mode==='network') throw new Error('TEST ONLY network');
 if(mode!=='ok') return Response.json({}, {status:Number(mode)});
 return Response.json({five_hour:{utilization:40,resets_at:'${new Date(clock + 18000000).toISOString()}'}});
};
`);
  const port1 = await freePort(); const port2 = await freePort();
  writer = await start(port1); reader = await start(port2);
  const settings = await json(writer, '/api/settings'); const readonly = await json(reader, '/api/settings');
  assert.equal(settings.writable, true); assert.equal(readonly.writable, false); assert.equal(readonly.writeReason, 'occupied');
  assert.ok(!JSON.stringify([settings, readonly]).includes('generation')); assert.ok(!JSON.stringify(readonly).includes('owner.json'));
  const save = (instance, values, revision) => fetch(instance.base + '/api/settings', { method: 'POST', headers: { Origin: instance.base,
    'Content-Type': 'application/json', 'If-Match': `"${revision}"` }, body: JSON.stringify(values) });
  const rejected = await save(reader, readonly.settings, readonly.revision);
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).error.code, 'SETTINGS_READ_ONLY');
  assert.equal((await fetch(reader.base + '/api/settings', { method: 'POST' })).status, 403);
  const saved = await save(writer, { ...settings.settings, MAX_FILES: '999' }, settings.revision); assert.equal(saved.status, 200);
  assert.equal((await save(writer, settings.settings, settings.revision)).status, 409);
  assert.equal((await json(reader, '/api/settings')).settings.MAX_FILES, '999');
  const dashboard = await json(reader, '/api/dashboard?mode=all&timezone=UTC'); assert.equal(dashboard.totals.totalTokens, 10);
  assert.equal((await fetch(reader.base + '/api/export?format=json-report&mode=all&timezone=UTC')).status, 200);
  const refresh = (instance) => json(instance, '/api/account-usage/refresh?provider=claude', { method: 'POST', headers: { Origin: instance.base } });
  const callsBefore = await readFile(callFile, 'utf8'); const expired = await refresh(reader);
  assert.equal(expired.reason, 'auth-expired'); assert.deepEqual(expired.windows, []);
  assert.equal(await readFile(callFile, 'utf8'), callsBefore); assert.equal(await readFile(credentialFile, 'utf8'), credential(false));
  await writeFile(credentialFile, credential(true));
  assert.equal((await refresh(reader)).windows[0].remainingPercent, 60);
  await writeFile(modeFile, '503'); assert.equal((await refresh(reader)).status, 'stale');
  await writeFile(modeFile, '401'); assert.equal((await refresh(reader)).reason, 'auth-expired');
  assert.equal(await readFile(credentialFile, 'utf8'), credential(true));
  assert.equal((await readFile(callFile, 'utf8')).split('\n').includes('oauth'), false);
  await writeFile(modeFile, 'ok'); await writeFile(credentialFile, credential(false));

  const lock = path.join(root, '.env.settings-lock');
  await stop(writer); await absent(lock);
  assert.equal((await json(reader, '/api/settings')).writable, false);
  const failed = launch(port2); const [failureCode] = await once(failed.child, 'exit'); assert.equal(failureCode, 1); await absent(lock);
  writer = await start(port1); assert.equal((await json(writer, '/api/settings')).writable, true);
  await stop(writer, 'SIGKILL'); assert.equal((await stat(lock)).isDirectory(), true);
  const blocked = await start(port1); assert.equal((await json(blocked, '/api/settings')).writable, false);
  const beforeUnlockCalls = await readFile(callFile, 'utf8');
  const recovery = launch(await freePort(), ['--unlock-settings']); const [recoveryCode] = await once(recovery.child, 'exit');
  assert.equal(recoveryCode, 0); assert.ok(recovery.output.includes('Settings ownership recovered.'));
  assert.equal(await readFile(callFile, 'utf8'), beforeUnlockCalls); await absent(lock);
  assert.equal((await json(blocked, '/api/settings')).writable, false); await stop(blocked);
  writer = await start(port1); assert.equal((await json(writer, '/api/settings')).writable, true);
  const beforeRefusal = await readFile(path.join(lock, 'owner.json'), 'utf8');
  const refused = launch(await freePort(), ['--unlock-settings']); const [refusedCode] = await once(refused.child, 'exit');
  assert.equal(refusedCode, 1); assert.equal(await readFile(path.join(lock, 'owner.json'), 'utf8'), beforeRefusal);
  console.log('PASS: isolated ownership, read-only routes, Claude no-write/no-refresh, graceful/failure cleanup, crash/manual recovery, fixed read-only lifecycle.');
  if (process.argv.includes('--serve')) {
    console.log(JSON.stringify({ TEST_ONLY: true, writer: writer.base, reader: reader.base, root, claude: 'expired', command: 'valid | expired' }));
    await new Promise((resolve) => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.on('data', async (chunk) => {
        const command = String(chunk).trim();
        if (command === 'valid' || command === 'expired') {
          await writeFile(credentialFile, credential(command === 'valid')); console.log('TEST ONLY Claude credentials: ' + command);
        }
      }); process.stdin.resume();
    }); process.stdin.pause();
  }
} finally {
  for (const instance of children) await stop(instance);
  await rm(root, { recursive: true, force: true });
}
