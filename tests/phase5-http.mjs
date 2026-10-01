import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// The copied app uses synthetic credentials, an isolated .env, and no external fetch.
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase5-http-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  for (const file of ['index.html', 'settings.html']) {
    const target = path.join(root, 'public', file);
    await writeFile(target, (await readFile(target, 'utf8')).replace('<main ', '<p role="status">TEST ONLY quota/settings QA. Synthetic credentials, isolated settings, no external requests.</p><main '));
  }
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const auth = path.join(codex, 'auth.json'); const env = path.join(root, '.env');
  const credential = { tokens: { access_token: 'fixture-only-secret', account_id: 'fixture-only-account' } };
  await writeFile(auth, JSON.stringify(credential));
  const initialClock = Date.now();
  const stateFile = path.join(root, 'fixture-state.json');
  const state = { mode: 'ok', now: initialClock, reset: initialClock + 10000 };
  const mode = async (value, advance = 0) => { state.mode = value; state.now += advance; await writeFile(stateFile, JSON.stringify(state)); };
  await mode('ok');
  await writeFile(path.join(root, 'offline.mjs'), `import { readFileSync } from 'node:fs';
const state = () => JSON.parse(readFileSync(new URL('./fixture-state.json', import.meta.url), 'utf8'));
Date.now = () => state().now;
globalThis.fetch = async (url) => {
  const s = state();
  if (String(url) === 'https://chatgpt.com/backend-api/wham/usage') {
    if (s.mode === 'network') throw new Error('TEST ONLY network failure');
    if (s.mode === 'fail' || s.mode === 'auth') return Response.json({}, { status: s.mode === 'auth' ? 401 : 503 });
    return Response.json({ plan_type: 'fixture-plan', rate_limit: { primary_window: { used_percent: s.mode === 'unknown' ? null : 25, limit_window_seconds: 18000, reset_at: s.mode === 'unknown' ? null : Math.ceil(s.reset / 1000) }, secondary_window: { used_percent: s.mode === 'unknown' ? 0 : 50, limit_window_seconds: 604800, reset_at: Math.ceil((s.reset + 604800000) / 1000) } } });
  }
  return Response.json({}, { status: 503 });
};
`);
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, AUTO_REFRESH: '0', MAX_FILES: '1000', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(base + '/api/providers')).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route, init) => { const response = await fetch(base + route, init); assert.equal(response.status, 200); return response.json(); };
  const refresh = () => json('/api/account-usage/refresh?provider=codex', { method: 'POST', headers: { Origin: base } });
  const success = await refresh(); assert.equal(success.windows[0].remainingPercent, 75);
  await mode('fail', 11000); const stale = await refresh(); assert.equal(stale.status, 'stale'); assert.equal(stale.fetchedAt, success.fetchedAt); assert.equal(stale.windows[0].remainingPercent, null); assert.equal(stale.windows[1].remainingPercent, 50);
  await mode('auth'); const expired = await refresh(); assert.equal(expired.reason, 'auth-expired'); assert.deepEqual(expired.windows, []);
  await mode('unknown'); const unknown = await refresh(); assert.equal(unknown.windows[0].remainingPercent, null); assert.equal(unknown.windows[0].resetsAt, null); assert.equal(unknown.windows[1].remainingPercent, 100);
  assert.ok(!JSON.stringify([success, stale, expired, unknown]).includes('fixture-only-secret'));
  assert.ok(!JSON.stringify([success, stale]).includes('fixture-only-account'));
  assert.equal((await fetch(base + '/api/account-usage/refresh', { method: 'POST' })).status, 403);
  const first = await json('/api/settings'); assert.match(first.revision, /^[a-f0-9]{64}$/);
  const settings = { ...first.settings, HOST: '127.0.0.1', CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, PORT: '3344' };
  const save = (values, revision) => fetch(base + '/api/settings', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(revision ? { 'If-Match': '"' + revision + '"' } : {}) }, body: JSON.stringify(values) });
  assert.equal((await save(settings)).status, 428);
  const results = await Promise.all([save(settings, first.revision), save({ ...settings, PORT: '3355' }, first.revision)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const saved = await results.find((response) => response.ok).json(); assert.equal(saved.restartRequired, true);
  const current = await json('/api/settings'); assert.equal(current.revision, saved.revision); assert.equal(current.settings.PORT, saved.settings.PORT);
  const persisted = await readFile(env, 'utf8'); assert.match(persisted, new RegExp('PORT=' + saved.settings.PORT));
  assert.equal((await save({ ...settings, HOST: '0.0.0.0' }, current.revision)).status, 400); assert.equal(await readFile(env, 'utf8'), persisted);
  await writeFile(env, persisted + '# external fixture change\nCUSTOM_VALUE=keep\n');
  assert.equal((await save(settings, current.revision)).status, 409);
  const external = await json('/api/settings'); assert.notEqual(external.revision, current.revision); assert.equal((await save(settings, external.revision)).status, 200); assert.match(await readFile(env, 'utf8'), /CUSTOM_VALUE=keep/);
  assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })).status, 403);
  console.log(JSON.stringify({ status: 'passed', fixtureOnly: true, node: process.version, staleResetMasked: true, authClearsUsage: true, unknownIsNotZero: true, settingsStatuses: [428, 409, 400, 403], externalEditDetected: true, restartRequired: true }));
  if (process.argv.includes('--serve')) {
    await mode('ok'); await refresh();
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?range=all&timezone=UTC`);
    console.log('Commands: fail, network, auth, unknown, ok, settings. Then use the UI check/save action.');
    await new Promise((resolve) => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.on('data', async (chunk) => {
        const command = String(chunk).trim();
        if (command === 'settings') {
          const content = await readFile(env, 'utf8'); await writeFile(env, content.replace(/^PORT=.*$/m, 'PORT=3366')); console.log('TEST ONLY settings changed externally to port 3366.');
        } else if (['fail', 'network', 'auth', 'unknown', 'ok'].includes(command)) { await mode(command); console.log('TEST ONLY quota mode: ' + command); }
      }); process.stdin.resume();
    }); process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
