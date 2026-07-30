import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function port() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); assert.ok(address && typeof address === 'object'); probe.close(); await once(probe, 'close'); return address.port;
}
function start({ serverPort, sessionsDirectory, host = '127.0.0.1', allowRemote = undefined }) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: projectRoot, env: { ...process.env, HOST: host, PORT: String(serverPort), CODEX_SESSIONS_DIR: sessionsDirectory, ...(allowRemote == null ? {} : { ALLOW_REMOTE: allowRemote }) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}
async function stop(server) { if (server.child.exitCode !== null || server.child.signalCode !== null) return; const exited = once(server.child, 'exit'); server.child.kill(); await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error(`Server cleanup timed out: ${server.output()}`)), 5_000))]); }
async function ready(uri) { let last; for (let attempt = 0; attempt < 30; attempt += 1) { try { const response = await fetch(uri); if (response.ok) return response; last = new Error(`Unexpected ${response.status}`); } catch (error) { last = error; } await new Promise((resolve) => setTimeout(resolve, 100)); } throw last; }
function assertEnvelope(body, code) { assert.equal(body.error.code, code); assert.match(body.error.requestId, /^[0-9a-f-]{36}$/); }

test('v2 dashboard HTTP contract is redacted, server-authoritative, and same-origin protected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-contract-'));
  const sessions = path.join(root, 'sessions');
  let dashboard;
  try {
    await mkdir(sessions);
    await writeFile(path.join(sessions, 'formula.jsonl'), [
      '{"timestamp":"2026-07-29T00:00:00Z","type":"session_meta","payload":{"id":"=formula","cwd":"C:\\\\Users\\\\secret\\\\project","model":"gpt-5.6-terra"}}',
      '{"timestamp":"2026-07-29T00:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":40,"total_tokens":140}}}}',
      '{"timestamp":"2026-07-29T00:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":40,"total_tokens":140}}}}',
    ].join('\n'));
    const serverPort = await port(); dashboard = start({ serverPort, sessionsDirectory: sessions });
    const base = `http://127.0.0.1:${serverPort}`;
    await ready(`${base}/api/dashboard?mode=all`);
    const dashboardResponse = await fetch(`${base}/api/dashboard?mode=all&timezone=Asia/Taipei`);
    assert.equal(dashboardResponse.status, 200); assert.equal(dashboardResponse.headers.get('x-content-type-options'), 'nosniff'); assert.equal(dashboardResponse.headers.get('cache-control'), 'no-store');
    const data = await dashboardResponse.json();
    assert.equal(data.range.timezone, 'Asia/Taipei'); assert.equal(data.range.interval, '[from,to)'); assert.equal(data.totals.totalTokens, 140); assert.equal(data.sessions[0].workspace, 'project'); assert.equal(Object.hasOwn(data.sessions[0], 'usageEvents'), false); assert.equal(JSON.stringify(data).includes('secret'), false); assert.equal(data.pricing.rates['codex-auto-review'].input, 2.5); assert.equal(typeof data.watcher.enabled, 'boolean'); assert.equal(typeof data.watcher.status, 'string');
    const detailResponse = await fetch(`${base}/api/sessions/${data.sessions[0].sessionKey}?mode=all&timezone=Asia/Taipei`);
    assert.equal(detailResponse.status, 200); const detail = await detailResponse.json(); assert.equal(detail.observations.length, 1); assert.equal(Object.hasOwn(detail.observations[0], 'payload'), false);
    const invalidTimezone = await fetch(`${base}/api/dashboard?timezone=Not/A_Timezone`); assert.equal(invalidTimezone.status, 400); assertEnvelope(await invalidTimezone.json(), 'INVALID_TIMEZONE');
    const malformedQuery = await fetch(`${base}/api/dashboard?mode=custom&from=not-a-number&to=2`); assert.equal(malformedQuery.status, 400); assertEnvelope(await malformedQuery.json(), 'INVALID_QUERY');
    const traversal = await fetch(`${base}/styles/%2e%2e%2fserver.mjs`); assert.equal(traversal.status, 404); assertEnvelope(await traversal.json(), 'NOT_FOUND');
    const blockedRefresh = await fetch(`${base}/api/refresh?mode=all`, { method: 'POST' }); assert.equal(blockedRefresh.status, 403); assertEnvelope(await blockedRefresh.json(), 'INVALID_ORIGIN');
    const settings = await fetch(`${base}/api/settings`); assert.equal(settings.status, 200); assert.equal((await settings.json()).restartRequired, true);
    const invalidSettings = await fetch(`${base}/api/settings`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); assert.equal(invalidSettings.status, 400); assertEnvelope(await invalidSettings.json(), 'INVALID_SETTINGS');
    const refreshed = await fetch(`${base}/api/refresh?mode=all`, { method: 'POST', headers: { Origin: base } }); assert.equal(refreshed.status, 200); assert.equal((await refreshed.json()).scan.snapshotVersion, 2);
    const exported = await fetch(`${base}/api/export?format=csv-sessions&mode=all`); assert.equal(exported.status, 200); assert.match(await exported.text(), /'=formula/);
    const compatibility = await fetch(`${base}/api/summary?mode=all`); assert.equal(compatibility.status, 200); assert.equal((await compatibility.json()).deprecated, true);
    await rm(sessions, { recursive: true, force: true });
    const failedRefresh = await fetch(`${base}/api/refresh?mode=all`, { method: 'POST', headers: { Origin: base } }); assert.equal(failedRefresh.status, 500); assertEnvelope(await failedRefresh.json(), 'INTERNAL_ERROR');
    const retained = await fetch(`${base}/api/dashboard?mode=all`); assert.equal(retained.status, 200); assert.equal((await retained.json()).scan.snapshotVersion, 2);
  } finally { if (dashboard) await stop(dashboard); await rm(root, { recursive: true, force: true }); }
});

test('server rejects a remote bind without the explicit local configuration opt-in', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-remote-'));
  try {
    const server = start({ serverPort: await port(), sessionsDirectory: root, host: '0.0.0.0' });
    await once(server.child, 'exit');
    assert.notEqual(server.child.exitCode, 0);
    assert.match(server.output(), /Non-loopback HOST requires ALLOW_REMOTE=1/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
