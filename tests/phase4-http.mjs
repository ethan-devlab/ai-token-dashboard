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
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase4-http-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const htmlPath = path.join(root, 'public/index.html');
  await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('<main ', '<p role="status">TEST ONLY projection QA. 251 isolated Session fixtures. Synthetic logs; external fetch disabled; isolated settings and credentials.</p><main '));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const write = (directory, name, events) => writeFile(path.join(directory, name), events.map(JSON.stringify).join('\n') + '\n');
  const record = (i, tokens = 1) => [{ type: 'session_meta', timestamp: '2026-09-01T00:00:00Z', payload: { id: `fixture-${i}`, model: 'gpt-5.5', cwd: '/TEST_ONLY/workspace' } }, { type: 'turn.completed', timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.5', usage: { input_tokens: tokens, output_tokens: 0 } }];
  await Promise.all(Array.from({ length: 251 }, (_, i) => write(codex, `${i}.jsonl`, record(i))));
  await writeFile(path.join(root, 'offline.mjs'), `import { readFile } from 'node:fs/promises';
globalThis.fetch = async (url) => {
  if (String(url) === 'https://developers.openai.com/api/docs/pricing.md') {
    try { return new Response(await readFile(new URL('./pricing-fixture.md', import.meta.url), 'utf8'), { headers: { 'content-type': 'text/markdown' } }); } catch {}
  }
  return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
};
`);
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: path.join(root, 'no-codex-auth'), CLAUDE_CONFIG_DIR: path.join(root, 'no-claude-auth'), AUTO_REFRESH: '0', MAX_FILES: '1000', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(`${base}/api/providers`)).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route, init) => { const response = await fetch(`${base}${route}`, init); assert.equal(response.status, 200); return response.json(); };
  const query = 'mode=all&timezone=UTC&limit=100';
  const before = await json(`/api/dashboard?${query}`); assert.equal(before.totals.totalTokens, 251); assert.equal(before.sessions.length, 100);
  const pin = `projection=${before.projection.key}&projectionAt=${before.projection.at}`;
  const page = await json(`/api/sessions?${query}&offset=200&${pin}`); assert.equal(page.sessions.length, 51); assert.equal(page.projection.key, before.projection.key);
  const detail = await json(`/api/sessions/${before.sessions[0].sessionKey}?${query}&${pin}`); assert.equal(detail.projection.key, before.projection.key);
  const csvResponse = await fetch(`${base}/api/export?${query}&offset=200&format=csv-sessions&${pin}`); assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text(); assert.equal(csv.split('\r\n').length, 252); assert.match(csvResponse.headers.get('content-disposition'), /attachment/);
  assert.equal(JSON.parse(decodeURIComponent(csvResponse.headers.get('x-export-scope'))).matchedSessionCount, 251);
  const report = await json(`/api/export?${query}&format=json-report&${pin}`); assert.equal(report.metadata.projection.key, before.projection.key); assert.equal(report.metadata.exportedSessionCount, 251);
  const markdown = await fetch(`${base}/api/export?${query}&format=markdown-summary&${pin}`); assert.match(await markdown.text(), /Snapshot: 1/);
  assert.equal((await fetch(`${base}/api/export?${query}&format=csv-trend&${pin}`)).status, 200);
  const empty = await fetch(`${base}/api/export?mode=all&timezone=UTC&q=no-matches&format=csv-sessions`); assert.equal(empty.status, 200); const emptyRows = (await empty.text()).split('\r\n'); assert.equal(emptyRows.length, 2); assert.match(emptyRows[0], /recordType$/); assert.match(emptyRows[1], /,"metadata"$/);
  const emptyTrend = await fetch(`${base}/api/export?mode=all&timezone=UTC&q=no-matches&format=csv-trend`); assert.equal(emptyTrend.status, 200); const emptyTrendRows = (await emptyTrend.text()).split('\r\n'); assert.equal(emptyTrendRows.length, 2); assert.match(emptyTrendRows[1], /,"metadata"$/);
  const clockQuery = 'mode=last24h&timezone=UTC&projectionAt=' + Date.parse('2026-09-01T12:00:00Z');
  const relative = await json(`/api/dashboard?${clockQuery}`); const relativePage = await json(`/api/sessions?${clockQuery}&projection=${relative.projection.key}`); assert.equal(relativePage.totals.totalTokens, 251);
  const refresh = () => fetch(`${base}/api/refresh?${query}`, { method: 'POST', headers: { Origin: base } });
  await write(codex, '0.jsonl', record(0, 9)); assert.equal((await refresh()).status, 200);
  const current = await json(`/api/dashboard?${query}`); assert.equal(current.totals.totalTokens, 259);
  for (const route of [`/api/sessions?${query}&offset=200&${pin}`, `/api/sessions/${before.sessions[0].sessionKey}?${query}&${pin}`, `/api/export?${query}&format=csv-sessions&${pin}`]) { const conflict = await fetch(base + route); assert.equal(conflict.status, 409); const error = (await conflict.json()).error; assert.equal(error.code, 'PROJECTION_CONFLICT'); assert.ok(error.requestId); }
  const latest = await json(`/api/export?${query}&format=json-report`); assert.equal(latest.totals.totalTokens, 259);
  assert.equal((await fetch(`${base}/api/export?${query}&projection=bad`)).status, 400);
  assert.equal((await fetch(`${base}/api/export?${query.replace('limit=100', 'limit=0')}`)).status, 400);
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST' })).status, 403);
  assert.ok(!csv.includes(root)); assert.ok(!JSON.stringify(report).includes(root));
  const pricingText = (await readFile(path.join(source, 'tests/server-services.test.mjs'), 'utf8')).match(/const pricingMarkdown = `([\s\S]*?)`;/)[1].replace('| gpt-5.5 (<272K context length) | $5.00', '| gpt-5.5 (<272K context length) | $10.00');
  await writeFile(path.join(root, 'pricing-fixture.md'), pricingText);
  const repriced = await json(`/api/pricing/refresh?${query}&projectionAt=${current.projection.at}`, { method: 'POST', headers: { Origin: base } });
  assert.equal(repriced.scan.snapshotVersion, current.scan.snapshotVersion); assert.notEqual(repriced.projection.pricingRevision, current.projection.pricingRevision);
  const pricingConflict = await fetch(`${base}/api/export?${query}&projectionAt=${current.projection.at}&projection=${current.projection.key}`); assert.equal(pricingConflict.status, 409);
  await rm(path.join(root, 'pricing-fixture.md'));
  console.log(JSON.stringify({ status: 'passed', fixtureOnly: true, node: process.version, exportedSessions: 251, offset: 200, pinnedPageSize: 51, beforeTokens: 251, afterTokens: 259, conflicts: ['page', 'detail', 'export'], formats: 4, relativeTimePinned: true, pricingConflictAtSameSnapshot: true }, null, 2));
  if (process.argv.includes('--serve')) {
    await write(codex, '0.jsonl', record(0)); assert.equal((await refresh()).status, 200);
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?range=all&timezone=UTC`);
    console.log('Type advance to change one fixture and publish a new snapshot.');
    await new Promise((resolve) => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.on('data', async (chunk) => { if (String(chunk).trim() === 'advance') { await write(codex, '0.jsonl', record(0, 9)); const response = await refresh(); console.log(`Fixture advanced: HTTP ${response.status}`); } }); process.stdin.resume();
    }); process.stdin.pause();
  }

} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
