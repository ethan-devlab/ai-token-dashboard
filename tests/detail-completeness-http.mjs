import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Synthetic logs run through a copied app. External requests and real credentials are excluded.
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-detail-completeness-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const html = path.join(root, 'public', 'index.html');
  await writeFile(html, (await readFile(html, 'utf8')).replace('<main ', '<p role="status">TEST ONLY detail completeness QA. Synthetic logs, isolated settings, no external requests.</p><main '));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const start = Date.parse('2026-09-01T00:00:00Z');
  const write = (directory, name, events) => writeFile(path.join(directory, name), events.map(JSON.stringify).join('\n') + '\n');
  await write(codex, 'large.jsonl', [{ type: 'session_meta', timestamp: new Date(start).toISOString(), payload: { id: 'TEST_ONLY_LARGE', model: 'gpt-5.5', cwd: '/TEST_ONLY/workspace' } }, ...Array.from({ length: 2001 }, (_, index) => ({ type: 'turn.completed', timestamp: new Date(start + index * 1000).toISOString(), model: index === 2000 ? 'gpt-5.6-terra' : 'gpt-5.5', usage: { input_tokens: 1, output_tokens: 0 }, content: 'TEST_ONLY_PRIVATE_TRANSCRIPT' }))]);
  const assistant = (output) => ({ type: 'assistant', sessionId: 'TEST_ONLY_CONFLICT', timestamp: new Date(start).toISOString(), message: { id: 'TEST_ONLY_RESPONSE', model: 'claude-opus-5', content: 'TEST_ONLY_PRIVATE_TRANSCRIPT', usage: { input_tokens: 10, output_tokens: output, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } });
  await write(claude, 'one.jsonl', [assistant(2)]); await write(claude, 'two.jsonl', [assistant(5)]);
  await writeFile(path.join(root, 'offline.mjs'), 'globalThis.fetch = async () => Response.json({}, { status: 503 });\n');
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, AUTO_REFRESH: '0', MAX_FILES: '100', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(base + '/api/providers')).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route) => { const response = await fetch(base + route); assert.equal(response.status, 200, route); return response.json(); };
  const detail = async (query) => {
    const dashboard = await json('/api/dashboard?' + query); assert.equal(dashboard.matchedSessionCount, 1);
    const value = await json(`/api/sessions/${dashboard.sessions[0].sessionKey}?${query}&projection=${dashboard.projection.key}&projectionAt=${dashboard.projection.at}`);
    assert.equal(value.usage.totalTokens, dashboard.totals.totalTokens); assert.equal(value.cost.total, dashboard.cost.total);
    assert.equal(value.returnedObservationCount, value.observations.length); assert.equal(value.observationLimit, 2000);
    assert.doesNotMatch(JSON.stringify(value), /TEST_ONLY_PRIVATE_TRANSCRIPT|contentHash/);
    return value;
  };
  const query = 'provider=codex&mode=all&timezone=UTC';
  const large = await detail(query); assert.equal(large.observationCount, 2001); assert.equal(large.returnedObservationCount, 2000); assert.equal(large.observationsTruncated, true); assert.equal(large.usage.totalTokens, 2001);
  assert.equal(large.observations.at(-1).timestamp, new Date(start + 1999000).toISOString());
  const exact = await detail(query + '&models=gpt-5.5'); assert.equal(exact.observationCount, 2000); assert.equal(exact.returnedObservationCount, 2000); assert.equal(exact.observationsTruncated, false); assert.equal(exact.usage.totalTokens, 2000);
  const range = await detail(`provider=codex&mode=custom&timezone=UTC&from=${start}&to=${start + 1000000}`); assert.equal(range.observationCount, 1000); assert.equal(range.observationsTruncated, false);
  const unresolved = await detail('provider=claude&mode=all&timezone=UTC'); assert.equal(unresolved.observationCount, 0); assert.equal(unresolved.returnedObservationCount, 0); assert.equal(unresolved.observationsTruncated, false); assert.equal(unresolved.reconciliation.conflict, 1);
  console.log(JSON.stringify({ status: 'passed', fixtureOnly: true, node: process.version, acceptedCounts: [0, 1000, 2000, 2001], responseLimit: 2000, fullTotalsAndCostsMatchDashboard: true, exactModelAndTimeFilters: true, transcriptRedacted: true }));
  if (process.argv.includes('--serve')) {
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?provider=codex&range=all&timezone=UTC`);
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.resume(); }); process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
