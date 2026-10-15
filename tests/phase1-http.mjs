import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Actual shipped routes and assets in an isolated app. External requests cannot leave this process.
// --serve keeps the test-only desktop surface open until SIGINT/SIGTERM. No real credentials or .env are used.
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase1-http-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const htmlPath = path.join(root, 'public/index.html');
  await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('<main ', '<p role="status">TEST ONLY accounting QA. Synthetic logs; external fetch disabled; isolated settings and credentials.</p><main '));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const write = (directory, name, events) => writeFile(path.join(directory, name), events.map(JSON.stringify).join('\n') + '\n');
  const at = '2026-09-15T12:00:00Z';
  const meta = (id) => ({ type: 'session_meta', timestamp: at, payload: { id, model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/workspace' } });
  const count = (id, input, timestamp = at) => ({ type: 'event_msg', id, timestamp, payload: { type: 'token_count', model: 'gpt-5.6-terra', info: { total_token_usage: { input_tokens: input, output_tokens: 0, total_tokens: input } } } });
  await write(codex, 'mixed.jsonl', [meta('TEST_ONLY_MIXED'), { type: 'turn.completed', timestamp: at, model: 'gpt-5.6-terra', usage: { input_tokens: 2, output_tokens: 0 } }, { type: 'turn.completed', timestamp: at, model: 'gpt-5.5', usage: { input_tokens: 5, output_tokens: 0 } }]);
  const copied = [meta('TEST_ONLY_COPIED'), count('start', 30)];
  await write(codex, 'copy-one.jsonl', copied);
  await write(codex, 'copy-two.jsonl', [...copied, count('next', 35, '2026-09-15T12:00:01Z')]);
  await write(codex, 'uncertain.jsonl', [meta('TEST_ONLY_UNCERTAIN'), count('cumulative', 10), { type: 'turn.completed', timestamp: at, usage: { input_tokens: 2, output_tokens: 0 } }]);
  await write(claude, 'cache.jsonl', [{ type: 'assistant', timestamp: at, sessionId: 'TEST_ONLY_CLAUDE_CACHE', message: { id: 'response', model: 'claude-opus-5', content: 'TEST_ONLY_PRIVATE_TRANSCRIPT', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 70, output_tokens: 5, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } }]);
  await writeFile(path.join(root, 'offline.mjs'), "globalThis.fetch = async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });\n");
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'offline.mjs')).href, path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: path.join(root, 'no-codex-auth'), CLAUDE_CONFIG_DIR: path.join(root, 'no-claude-auth'), AUTO_REFRESH: '0', MAX_FILES: '100', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(`${base}/api/providers`)).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route, init) => { const response = await fetch(`${base}${route}`, init); assert.equal(response.status, 200); return response.json(); };
  const full = await json('/api/dashboard?mode=all');
  assert.equal(full.totals.totalTokens, 52);
  assert.equal(full.matchedSessionCount, 3);
  assert.equal(full.quality.range.usage.incomplete, true);
  const selected = await json('/api/dashboard?mode=all&models=gpt-5.5');
  assert.equal(selected.totals.totalTokens, 5);
  assert.deepEqual(selected.models.map((model) => model.tokens), [5]);
  assert.equal(selected.trend.points.reduce((sum, point) => sum + point.tokens, 0), 5);
  assert.equal((await json('/api/sessions?mode=all&models=gpt-5.5')).totals.totalTokens, 5);
  const detail = await json(`/api/sessions/${selected.sessions[0].sessionKey}?mode=all&models=gpt-5.5`);
  assert.equal(detail.usage.totalTokens, 5);
  assert.equal(detail.observations.length, 1);
  const claudeDashboard = await json('/api/dashboard?provider=claude&mode=all');
  assert.equal(claudeDashboard.totals.totalTokens, 105);
  assert.equal(claudeDashboard.totals.cacheWriteTokens, 70);
  assert.equal(claudeDashboard.cost.pricingCoverage.pricedTokens, 35);
  assert.equal(claudeDashboard.cost.pricingCoverage.unpricedTokens, 70);
  assert.equal(claudeDashboard.trend.partialCost, true);
  for (const format of ['json-report', 'csv-sessions', 'csv-trend', 'markdown-summary']) {
    const response = await fetch(`${base}/api/export?mode=all&models=gpt-5.5&format=${format}`);
    assert.equal(response.status, 200);
    const body = await response.text();
    if (format === 'json-report') assert.equal(JSON.parse(body).totals.totalTokens, 5);
    if (format === 'csv-sessions') assert.match(body, /"5",/);
    if (format === 'csv-trend') assert.match(body, /"5",/);
    if (format === 'markdown-summary') assert.match(body, /Total tokens: 5/);
    assert.doesNotMatch(body, /TEST_ONLY_PRIVATE_TRANSCRIPT|usageObservations|contentHash|inferenceGeo/);
  }
  const legacy = await json('/api/summary?mode=all&models=gpt-5.5');
  assert.equal(legacy.totals.totalTokens, 52);
  assert.equal(legacy.sessions[0].usage.totalTokens, 5);
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${base}/api/sessions/${claudeDashboard.sessions[0].sessionKey}?provider=codex&mode=all`)).status, 404);
  const ancestor = '11111111-1111-1111-1111-111111111111';
  const fork = '22222222-2222-2222-2222-222222222222';
  const parentRows = [meta('TEST_ONLY_LINEAGE_PARENT'), count(undefined, 100)];
  const prefix = Buffer.byteLength(parentRows.map(JSON.stringify).join('\n') + '\n');
  await write(codex, `${ancestor}.jsonl`, parentRows);
  await write(codex, `${fork}.jsonl`, [{ ...meta('TEST_ONLY_LINEAGE_CHILD'), payload: { ...meta('TEST_ONLY_LINEAGE_CHILD').payload, history_base: { thread_id: ancestor, end_byte_offset: prefix } } }, count(undefined, 130, '2026-10-07T12:00:00Z')]);
  const manual = { method: 'POST', headers: { Origin: base } };
  await json('/api/refresh?provider=codex&mode=all', manual);
  const lineage = await json('/api/dashboard?mode=all&q=TEST_ONLY_LINEAGE');
  assert.equal(lineage.totals.totalTokens, 130);
  assert.equal(lineage.matchedSessionCount, 2);
  const october = await json('/api/dashboard?mode=month&month=2026-10&timezone=UTC&q=TEST_ONLY_LINEAGE');
  assert.equal(october.totals.totalTokens, 30);
  assert.equal(october.trend.points.reduce((sum, p) => sum + p.tokens, 0), 30);
  assert.equal((await json('/api/sessions?mode=month&month=2026-10&timezone=UTC&q=TEST_ONLY_LINEAGE')).totals.totalTokens, 30);
  assert.equal((await json(`/api/sessions/${october.sessions[0].sessionKey}?mode=month&month=2026-10&timezone=UTC&q=TEST_ONLY_LINEAGE`)).usage.totalTokens, 30);
  const exported = await json('/api/export?mode=month&month=2026-10&timezone=UTC&q=TEST_ONLY_LINEAGE&format=json-report');
  assert.equal(exported.totals.totalTokens, 30);
  assert.doesNotMatch(JSON.stringify(exported), /historyBase|storageIdentity|attributedUsage|byteEnd|decodedSize/);
  const response = (sessionId, id, output) => ({ type: 'assistant', sessionId, timestamp: at, message: { id, model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: output, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } });
  await write(claude, 'fork-parent.jsonl', [response('TEST_ONLY_FORK_PARENT', 'fork-response', 5)]);
  await write(claude, 'fork-child.jsonl', [response('TEST_ONLY_FORK_CHILD', 'fork-response', 5), response('TEST_ONLY_FORK_CHILD', 'new-response', 7)]);
  await json('/api/refresh?provider=claude&mode=all', manual);
  const claudeFork = await json('/api/dashboard?provider=claude&mode=all&q=TEST_ONLY_FORK');
  assert.equal(claudeFork.totals.totalTokens, 32);
  assert.equal((await json('/api/export?provider=claude&mode=all&q=TEST_ONLY_FORK&format=json-report')).totals.totalTokens, 32);
  console.log(JSON.stringify({ forkChecks: 'passed', codexAll: 130, codexOctober: 30, claudeCopiedResponseAndNewUsage: 32 }));
  console.log(JSON.stringify({ status: 'passed', node: process.version, fixtureOnly: true, codexTokens: full.totals.totalTokens, modelB: selected.totals.totalTokens, copiedTokens: full.sessions.find((session) => session.sessionId === 'TEST_ONLY_COPIED').usage.totalTokens, claudeTokens: claudeDashboard.totals.totalTokens, claudeKnownCost: claudeDashboard.cost.total, claudeUnpricedTokens: claudeDashboard.cost.unpricedTokens, formatsChecked: 4, legacyTotalsRetained: true, securityBoundariesRetained: true }, null, 2));
  if (process.argv.includes('--serve')) {
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?range=all&timezone=UTC`);
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.once('data', resolve); process.stdin.resume(); });
    process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
