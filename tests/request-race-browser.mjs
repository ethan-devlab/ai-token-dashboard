import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Test-only fault controls hold fetch/body promises after cancellation. They never ship in public/.
function browserFaults() {
  const nativeFetch = window.fetch.bind(window); let armed = null; let sequence = 0; let nativeStatus = 'none'; const pending = [];
  const panel = document.createElement('section'); panel.style.cssText = 'padding:16px;border:2px solid #eab308;background:#171717;color:white';
  panel.innerHTML = '<strong>TEST ONLY request races: synthetic usage/quota, copied app, no external requests. Held promises deliberately ignore cancellation; native delay keeps the real signal.</strong><label> Fault channel <select id="TEST-channel"><option>diagnostics</option><option>update</option><option>accountUsage</option><option>dashboard</option><option>detail</option><option>export</option><option>pricing</option></select></label><button id="TEST-body">Hold next body</button><button id="TEST-fetch">Hold next fetch</button><button id="TEST-native">Delay native fetch</button><button id="TEST-old-ok">Release oldest success</button><button id="TEST-old-error">Reject oldest</button><button id="TEST-new-ok">Release newest success</button><p id="TEST-status" role="status"></p>';
  document.body.prepend(panel);
  const status = panel.querySelector('#TEST-status');
  const render = () => { status.textContent = `Armed: ${armed ? armed.channel + '/' + armed.stage : 'none'}; Pending: ${pending.map((item) => `#${item.id} ${item.channel}/${item.provider} ${item.stage} aborted=${Boolean(item.signal?.aborted)}`).join('; ') || 'none'}; Native: ${nativeStatus}`; };
  for (const stage of ['body', 'fetch', 'native']) panel.querySelector('#TEST-' + stage).onclick = () => { armed = { channel: panel.querySelector('select').value, stage }; render(); };
  function settle(newest, fail) { const item = newest ? pending.pop() : pending.shift(); if (item) { if (fail) item.reject(item.stage === 'body' ? new SyntaxError(`TEST_ONLY late body failure ${item.id}`) : new TypeError(`TEST_ONLY late fetch failure ${item.id}`)); else item.release(); } render(); }
  panel.querySelector('#TEST-old-ok').onclick = () => settle(false, false);
  panel.querySelector('#TEST-old-error').onclick = () => settle(false, true);
  panel.querySelector('#TEST-new-ok').onclick = () => settle(true, false);
  const hold = (scope, release) => new Promise((resolve, reject) => { pending.push({ ...scope, id: ++sequence, release: () => Promise.resolve().then(release).then(resolve, reject), reject }); scope.signal?.addEventListener('abort', render, { once: true }); render(); });
  window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), location.href); const name = url.pathname;
    const channel = name.startsWith('/api/account-usage') ? 'accountUsage' : name.startsWith('/api/sessions/') ? 'detail' : name === '/api/pricing/refresh' ? 'pricing' : ({ '/api/diagnostics': 'diagnostics', '/api/update': 'update', '/api/dashboard': 'dashboard', '/api/export': 'export' })[name];
    const scope = { channel, provider: url.searchParams.get('provider') || 'codex', signal: options.signal };
    const fault = armed?.channel === channel ? armed : null; if (fault) { armed = null; render(); }
    if (fault?.stage === 'native') {
      url.searchParams.set('TEST_ONLY_native_delay', '1'); nativeStatus = `${channel} waiting`; render();
      try { const result = await nativeFetch(url.href, options); nativeStatus = `${channel} completed`; return result; }
      catch (error) { nativeStatus = `${channel} ${options.signal?.aborted ? 'aborted' : 'failed'}`; throw error; }
      finally { render(); }
    }
    async function response() {
      if (channel === 'accountUsage') {
        const remaining = scope.provider === 'codex' ? 75 : 40;
        return Response.json({ provider: scope.provider, status: 'available', planType: 'TEST_ONLY', fetchedAt: new Date().toISOString(), windows: [{ kind: 'five-hour', usedPercent: 100 - remaining, remainingPercent: remaining, resetsAt: new Date(Date.now() + 18000000).toISOString(), windowSeconds: 18000 }] });
      }
      return nativeFetch(input, fault ? { ...options, signal: undefined } : options);
    }
    if (fault?.stage === 'fetch') return hold({ ...scope, stage: 'fetch' }, response);
    const result = await response();
    if (fault?.stage !== 'body') return result;
    const body = await result.text();
    return { ok: result.ok, status: result.status, headers: result.headers,
      json: () => hold({ ...scope, stage: 'body' }, () => JSON.parse(body)),
      blob: () => hold({ ...scope, stage: 'body' }, () => new Blob([body], { type: result.headers.get('content-type') })) };
  };
  render();
}

const source = fileURLToPath(new URL('../', import.meta.url)); const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-request-race-')); let child;
try {
  await Promise.all(['server', 'public', 'server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  const serverFile = path.join(root, 'server.mjs');
  await writeFile(serverFile, (await readFile(serverFile, 'utf8')).replace('http.createServer(async (req, res) => {', 'http.createServer(async (req, res) => {\n  if (req.url.includes("TEST_ONLY_native_delay=1")) await new Promise(resolve => setTimeout(resolve, 10000));\n  if (res.destroyed) return;'));
  const html = path.join(root, 'public/index.html');
  await writeFile(html, (await readFile(html, 'utf8')).replace('<script type="module"', '<script defer src="/scripts/TEST_ONLY-races.mjs"></script><script type="module"'));
  await writeFile(path.join(root, 'public/scripts/TEST_ONLY-races.mjs'), `(${browserFaults.toString()})();`);
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude'); await mkdir(codex); await mkdir(claude);
  const timestamp = '2026-09-01T00:00:00Z';
  await writeFile(path.join(codex, 'fixture.jsonl'), [{ type: 'session_meta', timestamp, payload: { id: 'TEST_ONLY_CODEX', model: 'gpt-5.5' } }, { type: 'turn.completed', timestamp, model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 0 } }].map(JSON.stringify).join('\n') + '\n');
  await writeFile(path.join(claude, 'fixture.jsonl'), JSON.stringify({ type: 'assistant', timestamp, sessionId: 'TEST_ONLY_CLAUDE', message: { id: 'TEST_ONLY_CLAUDE_EVENT', model: 'claude-opus-5', usage: { input_tokens: 20, output_tokens: 0 } } }) + '\n');
  await writeFile(path.join(root, 'offline.mjs'), 'globalThis.fetch = async () => Response.json({}, {status:503});\n');
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: path.join(root, 'no-auth'), CLAUDE_CONFIG_DIR: path.join(root, 'no-claude-auth'), AUTO_REFRESH: '0', MAX_FILES: '10' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let i = 0; i < 40; i++) { if (child.exitCode != null) throw new Error(output); try { if ((await fetch(base + '/api/providers')).ok) { ready = true; break; } } catch {} await delay(50); }
  assert.equal(ready, true);
  for (const [provider, total] of [['codex', 10], ['claude', 20]]) { const response = await fetch(base + '/api/dashboard?mode=all&timezone=UTC&provider=' + provider); assert.equal(response.status, 200); assert.equal((await response.json()).totals.totalTokens, total); }
  console.log(`TEST ONLY request race QA: http://localhost:${port}/?range=all&timezone=UTC&provider=codex`);
  if (process.argv.includes('--serve')) {
    console.log('Type reload-assets to copy the current request/controller assets. Reload the browser after copying.');
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.on('data', async (chunk) => { if (String(chunk).trim() === 'reload-assets') { for (const name of ['request-channels.mjs', 'dashboard.mjs']) await cp(path.join(source, 'public/scripts', name), path.join(root, 'public/scripts', name)); console.log('Current assets copied.'); } }); process.stdin.resume(); }); process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
