import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mergeSessionPage } from '../public/scripts/projection-cache.mjs';

// Cross-phase checks use one copied app, synthetic logs/credentials, and blocked external fetch.
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-functional-integration-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  for (const file of ['index.html', 'settings.html']) {
    const target = path.join(root, 'public', file);
    await writeFile(target, (await readFile(target, 'utf8')).replace('<main ', '<p role="status">TEST ONLY integration QA. Synthetic logs and credentials, isolated settings, no external requests.</p><main '));
  }
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const write = (directory, name, events) => writeFile(path.join(directory, name), events.map(JSON.stringify).join('\n') + '\n');
  const firstAt = '2026-11-01T05:30:00Z'; const secondAt = '2026-11-01T06:30:00Z';
  const meta = (id) => ({ type: 'session_meta', timestamp: firstAt, payload: { id, model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/workspace' } });
  const turn = (input, model = 'gpt-5.5', timestamp = secondAt) => ({ type: 'turn.completed', timestamp, model, usage: { input_tokens: input, output_tokens: 0 } });
  const mixed = [meta('TEST_ONLY_MIXED'), { type: 'event_msg', id: 'TEST_ONLY_COUNT', timestamp: firstAt, payload: { type: 'token_count', model: 'gpt-5.6-terra', info: { total_token_usage: { input_tokens: 17, output_tokens: 0, total_tokens: 17 } } } }, turn(2, 'gpt-5.6-terra', firstAt), turn(10, 'gpt-5.5', firstAt), turn(20)];
  await write(codex, 'mixed.jsonl', mixed); await write(codex, 'mixed-copy.jsonl', mixed);
  const dummy = (i, input = 1) => [meta(`TEST_ONLY_DUMMY_${i}`), turn(input)];
  await Promise.all(Array.from({ length: 251 }, (_, i) => write(codex, `dummy-${i}.jsonl`, dummy(i))));
  await write(claude, 'cache.jsonl', [{ type: 'assistant', timestamp: firstAt, sessionId: 'TEST_ONLY_CLAUDE', message: { id: 'TEST_ONLY_RESPONSE', model: 'claude-opus-5', content: 'TEST_ONLY_PRIVATE_TRANSCRIPT', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 70, output_tokens: 5, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } }]);
  await writeFile(path.join(codex, 'auth.json'), JSON.stringify({ tokens: { access_token: 'fixture-only-secret', account_id: 'fixture-only-account' } }));
  const modeFile = path.join(root, 'quota-mode.txt'); await writeFile(modeFile, 'ok');
  await writeFile(path.join(root, 'offline.mjs'), `import { readFile } from 'node:fs/promises';
globalThis.fetch = async (url) => {
  if (String(url) === 'https://chatgpt.com/backend-api/wham/usage') {
    const mode = (await readFile(new URL('./quota-mode.txt', import.meta.url), 'utf8')).trim();
    if (mode !== 'ok') return Response.json({}, { status: mode === 'auth' ? 401 : 503 });
    return Response.json({ plan_type: 'fixture-plan', rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: Math.floor(Date.now()/1000) + 18000 } } });
  }
  return Response.json({}, { status: 503 });
};
`);
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, AUTO_REFRESH: '1', AUTO_REFRESH_DEBOUNCE_MS: '100', MAX_FILES: '1000', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(base + '/api/providers')).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route, init) => { const response = await fetch(base + route, init); assert.equal(response.status, 200, route); return response.json(); };
  const from = Date.parse('2026-11-01T04:00Z'); const to = Date.parse('2026-11-02T05:00Z');
  const query = `provider=codex&mode=custom&timezone=America/New_York&from=${from}&to=${to}&models=gpt-5.5&limit=100`;
  const before = await json('/api/dashboard?' + query);
  assert.equal(before.totals.totalTokens, 281); assert.equal(before.matchedSessionCount, 252); assert.equal(before.sessions.length, 100);
  assert.equal(before.models[0].tokens, 281); assert.equal(before.trend.points.reduce((sum, point) => sum + point.tokens, 0), 281);
  assert.deepEqual(before.trend.points.map((point) => point.tokens), [10, 271]); assert.notEqual(before.trend.points[0].label, before.trend.points[1].label); assert.equal(before.trend.points[0].toMs, before.trend.points[1].fromMs);
  const pin = `projection=${before.projection.key}&projectionAt=${before.projection.at}`;
  const page = await json(`/api/sessions?${query}&offset=250&${pin}`); assert.equal(page.sessions.length, 2); assert.equal(page.totals.totalTokens, 281); assert.equal(page.projection.key, before.projection.key);
  const report = await json(`/api/export?${query}&offset=250&format=json-report&${pin}`); assert.equal(report.metadata.exportedSessionCount, 252); assert.equal(report.totals.totalTokens, 281);
  const matching = await json(`/api/sessions?${query}&q=TEST_ONLY_MIXED`);
  const mixedSession = matching.sessions[0]; assert.equal(matching.matchedSessionCount, 1); assert.equal(mixedSession.usage.totalTokens, 30);
  const detailRoute = `/api/sessions/${mixedSession.sessionKey}?${query}&${pin}`;
  const detail = await json(detailRoute); assert.equal(detail.usage.totalTokens, 30); assert.equal(detail.observations.length, 2);
  const csv = await fetch(`${base}/api/export?${query}&offset=250&format=csv-sessions&${pin}`); assert.equal(csv.status, 200); assert.equal((await csv.text()).split('\r\n').length, 253);
  const claudeView = await json(`/api/dashboard?provider=claude&mode=custom&timezone=America/New_York&from=${from}&to=${to}`); assert.equal(claudeView.totals.totalTokens, 105); assert.equal(claudeView.cost.pricingCoverage.unpricedTokens, 70); assert.equal(claudeView.pricingCoverage.partial, true);
  const quota = await json('/api/account-usage/refresh?provider=codex', { method: 'POST', headers: { Origin: base } }); assert.equal(quota.status, 'available');
  await writeFile(modeFile, 'fail'); const stale = await json('/api/account-usage/refresh?provider=codex', { method: 'POST', headers: { Origin: base } }); assert.equal(stale.status, 'stale'); assert.equal(stale.windows[0].remainingPercent, 75);
  const settings = await json('/api/settings');
  const save = await fetch(base + '/api/settings', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'If-Match': '"' + settings.revision + '"' }, body: JSON.stringify({ ...settings.settings, MAX_FILES: '1', AUTO_REFRESH: '0' }) }); assert.equal(save.status, 200); assert.equal((await save.json()).restartRequired, true);
  const afterSettings = await json(`/api/dashboard?${query}&projectionAt=${before.projection.at}`); assert.equal(afterSettings.projection.key, before.projection.key); assert.equal(afterSettings.scan.complete, true);
  const broken = path.join(codex, 'broken.jsonl'); await writeFile(broken, 'null\n'); await write(codex, 'dummy-0.jsonl', dummy(0, 9));
  const failed = await fetch(`${base}/api/refresh?${query}`, { method: 'POST', headers: { Origin: base } }); assert.equal(failed.status, 503); assert.equal((await failed.json()).error.retainedSnapshot, true);
  const retained = await json(`/api/dashboard?${query}&projectionAt=${before.projection.at}`); assert.equal(retained.totals.totalTokens, 281); assert.equal(retained.projection.key, before.projection.key); assert.equal(retained.scan.retainedSnapshot, true);
  assert.equal((await json(detailRoute)).usage.totalTokens, 30);
  const retainedPage = await json(`/api/sessions?${query}&offset=250&${pin}`); assert.equal(retainedPage.totals.totalTokens, 281);
  const merged = mergeSessionPage(before, retainedPage); assert.equal(merged.quality.scan.refreshFailure.reason, 'file-parse'); assert.equal(merged.scan.retainedSnapshot, true); assert.equal(merged.trend, before.trend); assert.equal(merged.models, before.models);
  const retainedExport = await json(`/api/export?${query}&format=json-report&${pin}`); assert.equal(retainedExport.totals.totalTokens, 281); assert.equal(retainedExport.quality.scan.retainedSnapshot, true);
  await rm(broken);
  let repaired;
  for (let attempt = 0; attempt < 60; attempt++) { repaired = await json('/api/dashboard?' + query); if (repaired.totals.totalTokens === 289) break; await delay(50); }
  assert.equal(repaired.totals.totalTokens, 289); assert.ok(repaired.scan.snapshotVersion > before.scan.snapshotVersion); assert.equal(repaired.scan.refreshFailure, null);
  for (const route of [`/api/sessions?${query}&offset=250&${pin}`, detailRoute, `/api/export?${query}&format=json-report&${pin}`]) { const conflict = await fetch(base + route); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, 'PROJECTION_CONFLICT'); }
  for (const value of [before, report, detail, quota, stale, claudeView, retainedExport]) assert.doesNotMatch(JSON.stringify(value), /TEST_ONLY_PRIVATE_TRANSCRIPT|fixture-only-secret|fixture-only-account|contentHash/);
  console.log(JSON.stringify({ status: 'passed', fixtureOnly: true, node: process.version, selectedTokens: 281, exportedSessions: 252, foldBuckets: [10, 271], mixedDetailTokens: 30, claudeUnpricedTokens: 70, quotaAndSettingsLeaveProjectionIntact: true, rollbackTokens: 281, watcherRepairTokens: 289, conflicts: ['page', 'detail', 'export'] }));
  if (process.argv.includes('--serve')) {
    console.log(`TEST ONLY desktop integration QA: http://localhost:${port}/?provider=codex&range=custom&timezone=America/New_York&from=${from}&to=${to}&models=gpt-5.5`);
    console.log('Commands: break, repair, quota-fail, quota-ok. Use UI reparse, pagination, or quota check.');
    await writeFile(modeFile, 'ok');
    await new Promise((resolve) => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.on('data', async (chunk) => {
        const command = String(chunk).trim();
        if (command === 'break') { await writeFile(broken, 'null\n'); await write(codex, 'dummy-0.jsonl', dummy(0, 17)); console.log('TEST ONLY broken file plus healthy change; last snapshot should remain 289.'); }
        if (command === 'repair') { await rm(broken, { force: true }); console.log('TEST ONLY repaired; watcher should publish 297.'); }
        if (command === 'quota-fail' || command === 'quota-ok') { await writeFile(modeFile, command === 'quota-fail' ? 'fail' : 'ok'); console.log('TEST ONLY quota mode updated.'); }
      }); process.stdin.resume();
    }); process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
