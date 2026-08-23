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
function start({ serverPort, sessionsDirectory, claudeSessionsDirectory = sessionsDirectory, host = '127.0.0.1', allowRemote = undefined }) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: projectRoot, env: { ...process.env, HOST: host, PORT: String(serverPort), CODEX_HOME: path.join(path.dirname(sessionsDirectory), 'isolated-codex-home'), CLAUDE_CONFIG_DIR: path.join(path.dirname(claudeSessionsDirectory), 'isolated-claude-home'), CODEX_SESSIONS_DIR: sessionsDirectory, CLAUDE_SESSIONS_DIR: claudeSessionsDirectory, ...(allowRemote == null ? {} : { ALLOW_REMOTE: allowRemote }) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}
async function stop(server) { if (server.child.exitCode !== null || server.child.signalCode !== null) return; const exited = once(server.child, 'exit'); server.child.kill(); await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error(`Server cleanup timed out: ${server.output()}`)), 5_000))]); }
async function ready(uri, options = undefined) { let last; for (let attempt = 0; attempt < 30; attempt += 1) { try { const response = await fetch(uri, options); if (response.ok) return response; last = new Error(`Unexpected ${response.status}`); } catch (error) { last = error; } await new Promise((resolve) => setTimeout(resolve, 100)); } throw last; }
function assertEnvelope(body, code) { assert.equal(body.error.code, code); assert.match(body.error.requestId, /^[0-9a-f-]{36}$/); }

test('v2 dashboard HTTP contract is redacted, server-authoritative, and same-origin protected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-contract-'));
  const sessions = path.join(root, 'sessions');
  const claudeSessions = path.join(root, 'claude-projects');
  let dashboard;
  try {
    await mkdir(sessions);
    await mkdir(path.join(claudeSessions, 'workspace', 'claude-session', 'subagents'), { recursive: true });
    await writeFile(path.join(sessions, 'formula.jsonl'), [
      '{"timestamp":"2026-07-29T00:00:00Z","type":"session_meta","payload":{"id":"=formula","cwd":"C:\\\\Users\\\\secret\\\\project","model":"gpt-5.6-terra"}}',
      '{"timestamp":"2026-07-29T00:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":40,"total_tokens":140}}}}',
      '{"timestamp":"2026-07-29T00:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":40,"total_tokens":140}}}}',
    ].join('\n'));
    await writeFile(path.join(claudeSessions, 'workspace', 'claude-session.jsonl'), [
      JSON.stringify({ type: 'assistant', sessionId: 'claude-session', cwd: 'C:/Users/secret/claude-workspace', version: '2.1.0', entrypoint: 'cli', timestamp: '2026-07-29T00:00:00Z', message: { id: 'claude-message', model: 'claude-opus-5', content: 'private transcript', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40 }, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } }),
      JSON.stringify({ type: 'assistant', sessionId: 'claude-session', cwd: 'C:/Users/secret/claude-workspace', version: '2.1.0', entrypoint: 'cli', timestamp: '2026-07-29T00:00:01Z', message: { id: 'claude-message', model: 'claude-opus-5', content: 'final private transcript', usage: { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40 }, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } }),
    ].join('\n'));
    await writeFile(path.join(claudeSessions, 'workspace', 'claude-session', 'subagents', 'agent-one.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'claude-session', cwd: 'C:/Users/secret/claude-workspace', version: '2.1.0', entrypoint: 'cli', timestamp: '2026-07-29T00:00:02Z', message: { id: 'agent-message', model: 'claude-sonnet-5', content: 'private agent transcript', usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } }));
    const serverPort = await port(); dashboard = start({ serverPort, sessionsDirectory: sessions, claudeSessionsDirectory: claudeSessions });
    const base = `http://127.0.0.1:${serverPort}`;
    await ready(`${base}/api/dashboard?mode=all`);
    const providers = await (await fetch(`${base}/api/providers`)).json();
    assert.deepEqual(providers.providers.map(({ id, available }) => ({ id, available })), [{ id: 'codex', available: true }, { id: 'claude', available: true }]);
    const accountUsage = await (await fetch(`${base}/api/account-usage?provider=codex`)).json();
    assert.deepEqual(accountUsage, { provider: 'codex', status: 'unavailable', reason: 'not-signed-in', fetchedAt: accountUsage.fetchedAt, windows: [] });
    assert.equal(JSON.stringify(accountUsage).includes('isolated-codex-home'), false);
    const blockedAccountUsageRefresh = await fetch(`${base}/api/account-usage/refresh?provider=codex`, { method: 'POST' }); assert.equal(blockedAccountUsageRefresh.status, 403); assertEnvelope(await blockedAccountUsageRefresh.json(), 'INVALID_ORIGIN');
    const refreshedAccountUsage = await fetch(`${base}/api/account-usage/refresh?provider=codex`, { method: 'POST', headers: { Origin: base } }); assert.equal(refreshedAccountUsage.status, 200); assert.equal((await refreshedAccountUsage.json()).status, 'unavailable');
    const dashboardResponse = await fetch(`${base}/api/dashboard?mode=all&timezone=Asia/Taipei`);
    assert.equal(dashboardResponse.status, 200); assert.equal(dashboardResponse.headers.get('x-content-type-options'), 'nosniff'); assert.equal(dashboardResponse.headers.get('cache-control'), 'no-store');
    const data = await dashboardResponse.json();
    assert.equal(data.range.timezone, 'Asia/Taipei'); assert.equal(data.range.interval, '[from,to)'); assert.equal(data.totals.totalTokens, 140); assert.equal(data.sessions[0].workspace, 'project'); assert.equal(Object.hasOwn(data.sessions[0], 'usageEvents'), false); assert.equal(JSON.stringify(data).includes('secret'), false); assert.equal(data.pricing.rates['codex-auto-review'].input, 2.5); assert.equal(typeof data.watcher.enabled, 'boolean'); assert.equal(typeof data.watcher.status, 'string');
    assert.equal(data.provider, 'codex');
    const beforeClaude = await (await fetch(`${base}/api/diagnostics`)).json();
    assert.deepEqual(beforeClaude.providers.map((provider) => [provider.id, provider.snapshot.snapshotVersion]), [['codex', 1], ['claude', 0]]);
    const claudeResponse = await fetch(`${base}/api/dashboard?provider=claude&mode=all&timezone=Asia/Taipei`);
    assert.equal(claudeResponse.status, 200); const claude = await claudeResponse.json();
    assert.equal(claude.provider, 'claude'); assert.equal(claude.sessions.length, 2); assert.equal(claude.totals.cacheWrite5mTokens, 30); assert.equal(claude.totals.cacheWrite1hTokens, 40); assert.equal(JSON.stringify(claude).includes('private transcript'), false); assert.equal(claude.pricing.toolFeesExcluded, true);
    const mainOnly = await (await fetch(`${base}/api/dashboard?provider=claude&mode=all&executionType=main`)).json();
    assert.equal(mainOnly.sessions.length, 1); assert.equal(mainOnly.sessions[0].executionType, 'main');
    const reusedCodex = await (await fetch(`${base}/api/dashboard?mode=all`)).json(); assert.equal(reusedCodex.scan.snapshotVersion, 1);
    const invalidProvider = await fetch(`${base}/api/dashboard?provider=other`); assert.equal(invalidProvider.status, 400); assertEnvelope(await invalidProvider.json(), 'INVALID_PROVIDER');
    const crossProviderDetail = await fetch(`${base}/api/sessions/${claude.sessions[0].sessionKey}?provider=codex&mode=all`); assert.equal(crossProviderDetail.status, 404); assertEnvelope(await crossProviderDetail.json(), 'SESSION_NOT_FOUND');
    const detailResponse = await fetch(`${base}/api/sessions/${data.sessions[0].sessionKey}?mode=all&timezone=Asia/Taipei`);
    assert.equal(detailResponse.status, 200); const detail = await detailResponse.json(); assert.equal(detail.observations.length, 1); assert.equal(Object.hasOwn(detail.observations[0], 'payload'), false);
    const invalidTimezone = await fetch(`${base}/api/dashboard?timezone=Not/A_Timezone`); assert.equal(invalidTimezone.status, 400); assertEnvelope(await invalidTimezone.json(), 'INVALID_TIMEZONE');
    const malformedQuery = await fetch(`${base}/api/dashboard?mode=custom&from=not-a-number&to=2`); assert.equal(malformedQuery.status, 400); assertEnvelope(await malformedQuery.json(), 'INVALID_QUERY');
    const traversal = await fetch(`${base}/styles/%2e%2e%2fserver.mjs`); assert.equal(traversal.status, 404); assertEnvelope(await traversal.json(), 'NOT_FOUND');
    const blockedRefresh = await fetch(`${base}/api/refresh?mode=all`, { method: 'POST' }); assert.equal(blockedRefresh.status, 403); assertEnvelope(await blockedRefresh.json(), 'INVALID_ORIGIN');
    const settings = await fetch(`${base}/api/settings`); assert.equal(settings.status, 200); assert.equal((await settings.json()).restartRequired, true);
    const invalidSettings = await fetch(`${base}/api/settings`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); assert.equal(invalidSettings.status, 400); assertEnvelope(await invalidSettings.json(), 'INVALID_SETTINGS');
    const refreshed = await fetch(`${base}/api/refresh?mode=all`, { method: 'POST', headers: { Origin: base } }); assert.equal(refreshed.status, 200); assert.equal((await refreshed.json()).scan.snapshotVersion, 2);
    const refreshedClaude = await fetch(`${base}/api/refresh?provider=claude&mode=all`, { method: 'POST', headers: { Origin: base } }); assert.equal(refreshedClaude.status, 200); assert.equal((await refreshedClaude.json()).scan.snapshotVersion, 2);
    const exported = await fetch(`${base}/api/export?format=csv-sessions&mode=all`); assert.equal(exported.status, 200); assert.match(await exported.text(), /'=formula/);
    const claudeExport = await fetch(`${base}/api/export?provider=claude&format=json-report&mode=all`); assert.match(claudeExport.headers.get('content-disposition'), /local-ai-token-dashboard-claude/); assert.equal((await claudeExport.json()).provider, 'claude');
    const compatibility = await fetch(`${base}/api/summary?mode=all`); assert.equal(compatibility.status, 200); assert.equal((await compatibility.json()).deprecated, true);
    await rm(sessions, { recursive: true, force: true });
    const failedRefresh = await fetch(`${base}/api/refresh?mode=all`, { method: 'POST', headers: { Origin: base } }); assert.equal(failedRefresh.status, 409); assertEnvelope(await failedRefresh.json(), 'PROVIDER_UNAVAILABLE');
    await rm(claudeSessions, { recursive: true, force: true });
    const unavailableClaude = await fetch(`${base}/api/dashboard?provider=claude&mode=all`); assert.equal(unavailableClaude.status, 409); assertEnvelope(await unavailableClaude.json(), 'PROVIDER_UNAVAILABLE');
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

test('account usage endpoint stays disabled when remote bind is explicitly enabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-remote-usage-'));
  let dashboard;
  try {
    const serverPort = await port(); dashboard = start({ serverPort, sessionsDirectory: root, host: '0.0.0.0', allowRemote: '1' });
    await ready(`http://0.0.0.0:${serverPort}/`);
    const response = await fetch(`http://0.0.0.0:${serverPort}/api/account-usage`);
    assert.equal(response.status, 403); assertEnvelope(await response.json(), 'ACCOUNT_USAGE_DISABLED');
  } finally { if (dashboard) await stop(dashboard); await rm(root, { recursive: true, force: true }); }
});
