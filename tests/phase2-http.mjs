import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Actual shipped routes and assets in an isolated app. External requests cannot leave this process.
// --serve keeps the test-only desktop surface open until SIGINT/SIGTERM. No real credentials or .env are used.
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase2-http-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const htmlPath = path.join(root, 'public/index.html');
  await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('<main ', '<p role="status">TEST ONLY calendar QA. Clock fixed at 2026-03-10 12:00 UTC. Synthetic logs; external fetch disabled; isolated settings and credentials.</p><main '));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const write = (directory, name, events) => writeFile(path.join(directory, name), events.map(JSON.stringify).join('\n') + '\n');
  const writeSession = (name, timestamps) => write(codex, `${name}.jsonl`, [{ type: 'session_meta', payload: { id: `TEST_ONLY_${name}`, model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/workspace' } }, ...timestamps.map(([timestamp, input]) => ({ type: 'turn.completed', timestamp, model: 'gpt-5.6-terra', usage: { input_tokens: input, output_tokens: 0 } }))]);
  await writeSession('week', [['2025-12-30T12:00:00Z', 7], ['2026-01-05T00:00:00Z', 99]]);
  await writeSession('comparison', [['2026-02-05T12:00:00Z', 10], ['2026-02-20T12:00:00Z', 80], ['2026-03-05T12:00:00Z', 20], ['2026-03-20T12:00:00Z', 40]]);
  await writeSession('fold', [['2026-11-01T05:30:00Z', 10], ['2026-11-01T06:30:00Z', 20]]);
  await writeFile(path.join(root, 'offline.mjs'), "globalThis.fetch = async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });\nDate.now = () => 1773144000000;\n");
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: path.join(root, 'no-codex-auth'), CLAUDE_CONFIG_DIR: path.join(root, 'no-claude-auth'), AUTO_REFRESH: '0', MAX_FILES: '100', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(`${base}/api/providers`)).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route, init) => { const response = await fetch(`${base}${route}`, init); assert.equal(response.status, 200); return response.json(); };
  const week = await json('/api/dashboard?mode=week&period=2026-W01&timezone=UTC&offset=0&limit=1');
  assert.equal(week.range.fromMs, Date.parse('2025-12-29T00:00Z')); assert.equal(week.totals.totalTokens, 7); assert.equal(week.limit, 1);
  const comparison = await json('/api/dashboard?mode=month&timezone=UTC');
  assert.equal(comparison.comparison.currentRange.toMs, Date.parse('2026-03-10T12:00Z'));
  assert.equal(comparison.comparison.currentTotals.totalTokens, 20); assert.equal(comparison.comparison.totals.totalTokens, 10); assert.equal(comparison.comparison.percentTotalTokens, 100); assert.equal(comparison.totals.totalTokens, 60);
  const rejected = ['mode=week&period=2025-W53', 'mode=week&period=2026-W00', 'mode=month&period=2026-13', 'mode=year&period=2026-03', 'mode=today&period=2026', 'mode=custom&start=2026-02-31T00:00&end=2026-03-05T00:00', 'mode=custom&timezone=America/New_York&start=2026-11-01T01:30&end=2026-11-01T03:00', 'mode=custom&timezone=America/New_York&start=2026-03-08T02:30&end=2026-03-08T04:00', 'mode=all&from=8640000000000001', 'mode=custom&from=2&to=1', 'limit=0', 'limit=201', 'offset=-1', 'offset=1000001'];
  for (const query of rejected) {
    const response = await fetch(`${base}/api/dashboard?${query}`); assert.equal(response.status, 400, query);
    const body = await response.json(); assert.ok(['INVALID_RANGE', 'INVALID_QUERY'].includes(body.error.code)); assert.ok(body.error.requestId);
  }
  const leap = await json('/api/sessions?mode=custom&timezone=UTC&start=2024-02-29T00:00&end=2024-03-01T00:00');
  assert.equal(leap.range.fromMs, Date.parse('2024-02-29T00:00Z'));
  const from = Date.parse('2026-11-01T04:00Z'); const to = Date.parse('2026-11-02T05:00Z');
  const fold = await json(`/api/dashboard?mode=custom&timezone=America/New_York&from=${from}&to=${to}`);
  assert.equal(fold.trend.points.length, 2); assert.equal(fold.trend.points[0].toMs, fold.trend.points[1].fromMs); assert.notEqual(fold.trend.points[0].label, fold.trend.points[1].label); assert.equal(fold.totals.totalTokens, 30);
  const selected = await json(`/api/dashboard?mode=custom&timezone=America/New_York&from=${fold.trend.points[1].fromMs}&to=${fold.trend.points[1].toMs}`);
  assert.equal(selected.totals.totalTokens, 20);
  const detail = await json(`/api/sessions/${selected.sessions[0].sessionKey}?mode=custom&timezone=America/New_York&from=${fold.trend.points[1].fromMs}&to=${fold.trend.points[1].toMs}`); assert.equal(detail.usage.totalTokens, 20);
  assert.equal((await fetch(`${base}/api/export?format=json-report&limit=0`)).status, 400);
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST' })).status, 403);
  console.log(JSON.stringify({ status: 'passed', node: process.version, fixtureOnly: true, rejectedQueries: rejected.length, historicalWeekTokens: week.totals.totalTokens, localProgressPercent: comparison.comparison.percentTotalTokens, separateFoldHours: fold.trend.points.map(({ label, fromMs, toMs }) => ({ label, fromMs, toMs })), exactFoldSelectionTokens: selected.totals.totalTokens, leapDayAccepted: true, securityBoundariesRetained: true }, null, 2));
  if (process.argv.includes('--serve')) {
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?range=week&week=2026-W01&timezone=UTC`);
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.once('data', resolve); process.stdin.resume(); });
    process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
