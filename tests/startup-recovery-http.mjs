import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-startup-recovery-'));
const children = [];
async function port() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const value = socket.address().port; const closed = once(socket, 'close'); socket.close(); await closed; return value;
}
async function start(selectedPort) {
  const child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], {
    cwd: root, env: { HOST: '127.0.0.1', PORT: String(selectedPort), CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const instance = { child, base: `http://127.0.0.1:${selectedPort}`, output: '', exited: false };
  instance.exit = new Promise(resolve => child.once('exit', (code, signal) => { instance.exited = true; resolve({ code, signal }); }));
  children.push(instance);
  child.stdout.on('data', chunk => { instance.output += chunk; }); child.stderr.on('data', chunk => { instance.output += chunk; });
  for (let i = 0; i < 200 && !instance.output.includes('Local AI Token Dashboard:'); i++) { assert.equal(instance.exited, false); await delay(25); }
  assert.ok(instance.output.includes('Local AI Token Dashboard:')); return instance;
}
async function stop(instance, signal = 'SIGTERM') {
  if (!instance.exited) instance.child.kill(signal);
  return Promise.race([instance.exit, delay(6000, undefined, { ref: false }).then(() => { instance.child.kill('SIGKILL'); throw new Error('Fixture shutdown timed out.'); })]);
}
async function json(instance, route) {
  const response = await fetch(instance.base + route); assert.equal(response.status, 200); return response.json();
}
async function records() {
  return Promise.all((await readdir(path.join(root, '.lifecycle'))).map(async name => (await readFile(path.join(root, '.lifecycle', name), 'utf8')).trim().split('\n').map(JSON.parse)));
}

try {
  await Promise.all(['server', 'public', 'server.mjs', 'package.json'].map(name => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await mkdir(path.join(root, 'codex')); await mkdir(path.join(root, 'claude'));
  await writeFile(path.join(root, '.env'), `CODEX_SESSIONS_DIR=${path.join(root, 'codex')}\nCLAUDE_SESSIONS_DIR=${path.join(root, 'claude')}\nAUTO_REFRESH=0\nUPDATE_REPOSITORY=\n`);
  await writeFile(path.join(root, 'offline.mjs'), 'globalThis.fetch=async()=>Response.json({}, {status:503});\n');
  await writeFile(path.join(root, 'codex', 'test.jsonl'), JSON.stringify({ type: 'turn.completed', timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.4', usage: { input_tokens: 10, output_tokens: 0 } }) + '\n');
  const settingsHtml = path.join(root, 'public', 'settings.html');
  await writeFile(settingsHtml, (await readFile(settingsHtml, 'utf8')).replace('<main ', '<p role="status">TEST ONLY. Restart after forced termination. Synthetic 10 Tokens, disposable configuration, external requests blocked.</p><main '));
  const first = await start(await port()); const oldReader = await start(await port());
  assert.equal((await json(first, '/api/settings')).writable, true);
  assert.equal((await json(oldReader, '/api/settings')).writable, false);
  const baseline = await json(first, '/api/dashboard?mode=all&timezone=UTC'); assert.equal(baseline.totals.totalTokens, 10);
  const envBefore = await readFile(path.join(root, '.env'));
  const killed = await stop(first, 'SIGKILL'); assert.equal(killed.signal, 'SIGKILL');
  for (const name of ['.env.settings-lock', '.pricing.writer-lock']) assert.ok((await readdir(path.join(root, name))).includes('owner.json'));
  assert.equal((await records()).find(run => run[0].pid === first.child.pid).at(-1).event, 'listening');
  const candidates = await Promise.all((await Promise.all([port(), port()])).map(start));
  const settings = await Promise.all(candidates.map(instance => json(instance, '/api/settings')));
  const diagnostics = await Promise.all(candidates.map(instance => json(instance, '/api/diagnostics')));
  assert.equal(settings.filter(value => value.writable).length, 1);
  for (const provider of ['codex', 'claude']) assert.equal(diagnostics.filter(value => value.providers.find(item => item.id === provider).pricing.writable).length, 1);
  assert.equal((await json(oldReader, '/api/settings')).writable, false);
  for (const provider of (await json(oldReader, '/api/diagnostics')).providers) assert.equal(provider.pricing.writable, false);
  for (const instance of candidates) assert.deepEqual((await json(instance, '/api/dashboard?mode=all&timezone=UTC')).totals, baseline.totals);
  assert.deepEqual(await readFile(path.join(root, '.env')), envBefore);
  const index = settings.findIndex(value => value.writable); const writer = candidates[index]; const reader = candidates[1 - index];
  const response = await fetch(writer.base + '/api/settings', { method: 'POST', headers: { Origin: writer.base, 'Content-Type': 'application/json', 'If-Match': `"${settings[index].revision}"` }, body: JSON.stringify({ ...settings[index].settings, MAX_FILES: '999' }) });
  assert.equal(response.status, 200); assert.equal((await json(writer, '/api/settings')).settings.MAX_FILES, '999');
  assert.equal((await json(reader, '/api/settings')).writable, false);
  console.log(JSON.stringify({ fixtureOnly: true, status: 'passed', checks: ['SIGKILL retains evidence; next startup recovers both dead-owner leases without an unlock command', 'two real startup contenders elect exactly one writer per independent lease', 'already-running readers do not take over', 'startup preserves configuration bytes and adopted usage; recovered writer saves with the existing Origin/revision guards'], writer: writer.base, reader: reader.base, root }));
  if (process.argv.includes('--serve')) {
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.once('data', resolve); process.stdin.resume(); }); process.stdin.pause();
  }
} finally {
  for (const instance of children) await stop(instance);
  await rm(root, { recursive: true, force: true });
}
