import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Runs a copy of the shipped server with fixture directories, no real .env,
// no CLI credentials, and external fetch replaced by a fixed 503 response.
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-http-audit-'));
let child;
const reports = [];
try {
  await cp(path.join(sourceRoot, 'server'), path.join(root, 'server'), { recursive: true });
  await cp(path.join(sourceRoot, 'server.mjs'), path.join(root, 'server.mjs'));
  await cp(path.join(sourceRoot, 'package.json'), path.join(root, 'package.json'));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  await Promise.all(Array.from({ length: 251 }, (_, i) => writeFile(path.join(codex, `${i}.jsonl`), [
    { type: 'session_meta', timestamp: '2026-09-15T12:00:00Z', payload: { id: `TEST_ONLY_${i}`, model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/workspace' } },
    { type: 'turn.completed', timestamp: '2026-09-15T12:00:01Z', usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } },
  ].map(JSON.stringify).join('\n') + '\n')));
  await writeFile(path.join(claude, 'one.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2026-09-15T12:00:00Z', sessionId: 'TEST_ONLY_CLAUDE', message: { id: 'TEST_ONLY_RESPONSE', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 70, cache_read_input_tokens: 20 } } }) + '\n');
  await writeFile(path.join(root, 'offline.mjs'), "globalThis.fetch = async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });\n");
  const portProbe = net.createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  const port = portProbe.address().port; portProbe.close(); await once(portProbe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: path.join(root, 'no-codex-auth'), CLAUDE_CONFIG_DIR: path.join(root, 'no-claude-auth'), AUTO_REFRESH: '0', MAX_FILES: '10000', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let processOutput = ''; child.stdout.on('data', (chunk) => { processOutput += chunk; }); child.stderr.on('data', (chunk) => { processOutput += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Isolated server exited: ${processOutput}`);
    try { const response = await fetch(`${base}/api/providers`); if (response.ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  if (!ready) throw new Error('Isolated server did not become ready.');
  async function jsonProbe(route, init) { const response = await fetch(`${base}${route}`, init); return { status: response.status, body: await response.json() }; }
  const dashboard = await jsonProbe('/api/dashboard?mode=all');
  const exported = await fetch(`${base}/api/export?mode=all&format=csv-sessions`);
  reports.push({ id: 'HTTP01', title: 'Complete Session CSV', dashboardMatched: dashboard.body.matchedSessionCount, dashboardPage: dashboard.body.sessions.length, csvStatus: exported.status, csvDataRows: (await exported.text()).split('\r\n').length - 1 });
  const week = await jsonProbe('/api/dashboard?mode=week&period=2026-W01&timezone=UTC');
  reports.push({ id: 'HTTP02', title: 'Historical week query', status: week.status, expectedStart: '2025-12-29T00:00:00.000Z', actualStart: new Date(week.body.range.fromMs).toISOString() });
  const invalidCivil = await jsonProbe('/api/dashboard?mode=custom&start=2026-02-31T00:00&end=2026-03-05T00:00&timezone=UTC');
  reports.push({ id: 'HTTP03', title: 'Invalid civil date', status: invalidCivil.status, actualStart: invalidCivil.body.range ? new Date(invalidCivil.body.range.fromMs).toISOString() : null });
  const invalidPeriod = await jsonProbe('/api/dashboard?mode=month&period=2026-13&timezone=UTC');
  reports.push({ id: 'HTTP04', title: 'Invalid calendar period', status: invalidPeriod.status, returnedMode: invalidPeriod.body.range?.mode, returnedStart: invalidPeriod.body.range ? new Date(invalidPeriod.body.range.fromMs).toISOString() : null });
  const claudeDashboard = await jsonProbe('/api/dashboard?provider=claude&mode=all');
  reports.push({ id: 'HTTP05', title: 'Claude generic cache through API', status: claudeDashboard.status, expectedTotal: 105, actualTotal: claudeDashboard.body.totals.totalTokens, cacheWrite: claudeDashboard.body.totals.cacheWriteTokens });
  const origin = await jsonProbe('/api/refresh', { method: 'POST' });
  const invalidProvider = await jsonProbe('/api/dashboard?provider=other');
  const crossProvider = await jsonProbe(`/api/sessions/${claudeDashboard.body.sessions[0].sessionKey}?provider=codex&mode=all`);
  const account = await jsonProbe('/api/account-usage?provider=codex');
  reports.push({ id: 'HTTPCHECK01', title: 'Provider and Origin boundary', blockedOriginStatus: origin.status, blockedOriginCode: origin.body.error?.code, invalidProviderStatus: invalidProvider.status, crossProviderStatus: crossProvider.status, noCredentialsQuotaStatus: account.body.status, noCredentialsReason: account.body.reason });
  const invalidSettings = await jsonProbe('/api/settings', { method: 'POST', headers: { Origin: base, 'content-type': 'application/json' }, body: '{}' });
  const settings = await jsonProbe('/api/settings');
  reports.push({ id: 'HTTPCHECK02', title: 'Isolated settings contract', invalidStatus: invalidSettings.status, invalidCode: invalidSettings.body.error?.code, settingsStatus: settings.status, restartRequired: settings.body.restartRequired });
  const refresh = await jsonProbe('/api/refresh?mode=all', { method: 'POST', headers: { Origin: base } });
  reports.push({ id: 'HTTPCHECK03', title: 'Provider snapshot refresh', initialVersion: dashboard.body.scan.snapshotVersion, nextVersion: refresh.body.scan.snapshotVersion, reusedFiles: refresh.body.scan.reused, totalTokens: refresh.body.totals.totalTokens });
  await writeFile(path.join(codex, '0.jsonl'), [
    { type: 'session_meta', timestamp: '2026-09-15T12:00:00Z', payload: { id: 'TEST_ONLY_0', model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/workspace' } },
    { type: 'turn.completed', timestamp: '2026-09-15T12:00:01Z', usage: { input_tokens: 20, output_tokens: 2, total_tokens: 22 } },
  ].map(JSON.stringify).join('\n') + '\n');
  const newer = await jsonProbe('/api/refresh?mode=all', { method: 'POST', headers: { Origin: base } });
  const latestExport = await jsonProbe('/api/export?mode=all&format=json-report');
  reports.push({ id: 'HTTP07', title: 'Export after another client advances snapshot', displayedVersion: dashboard.body.scan.snapshotVersion, displayedTotal: dashboard.body.totals.totalTokens, newerVersion: newer.body.scan.snapshotVersion, exportTotal: latestExport.body.totals.totalTokens, exportSnapshotVersion: latestExport.body.scan?.snapshotVersion ?? null });
  const zeroLimit = await jsonProbe('/api/sessions?mode=all&limit=0');
  reports.push({ id: 'HTTP06', title: 'Zero page limit', status: zeroLimit.status, limit: zeroLimit.body.limit, rows: zeroLimit.body.sessions?.length, hasNext: zeroLimit.body.hasNext });
  process.stdout.write(`${JSON.stringify({ audit: 'TEST ONLY offline isolated shipped HTTP server', reports }, null, 2)}\n`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
  await rm(root, { recursive: true, force: true });
}
