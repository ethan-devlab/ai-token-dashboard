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
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase3-http-'));
let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const htmlPath = path.join(root, 'public/index.html');
  await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('<main ', '<p role="status">TEST ONLY refresh QA. Isolated failed-file and file-cap fixtures. Synthetic logs; external fetch disabled; isolated settings and credentials.</p><main '));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(codex); await mkdir(claude);
  const write = (directory, name, events) => writeFile(path.join(directory, name), events.map(JSON.stringify).join('\n') + '\n');
  const record = (input) => [{ type: 'turn.completed', timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.5', usage: { input_tokens: input, output_tokens: 0 } }];
  const firstFile = path.join(codex, 'a.jsonl'); await writeFile(firstFile, 'null\n');
  await writeFile(path.join(root, 'offline.mjs'), "globalThis.fetch = async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });\n");
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: path.join(root, 'no-codex-auth'), CLAUDE_CONFIG_DIR: path.join(root, 'no-claude-auth'), AUTO_REFRESH: '0', MAX_FILES: '1', PARSE_CONCURRENCY: '2', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Isolated child exited: ${output}`);
    try { if ((await fetch(`${base}/api/providers`)).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.equal(ready, true);
  const json = async (route, init) => { const response = await fetch(`${base}${route}`, init); assert.equal(response.status, 200); return response.json(); };
  const initial = await fetch(`${base}/api/dashboard?mode=all&timezone=UTC`); assert.equal(initial.status, 503);
  const initialError = (await initial.json()).error; assert.equal(initialError.code, 'SESSION_REFRESH_FAILED'); assert.equal(initialError.retainedSnapshot, false);
  const refresh = () => fetch(`${base}/api/refresh?mode=all&timezone=UTC`, { method: 'POST', headers: { Origin: base } });
  await write(codex, 'a.jsonl', record(110)); assert.equal((await refresh()).status, 200);
  const before = await json('/api/dashboard?mode=all&timezone=UTC'); assert.equal(before.totals.totalTokens, 110); assert.equal(before.scan.snapshotVersion, 1); assert.equal(before.scan.complete, true); assert.equal(before.scan.truncated, false);
  await writeFile(firstFile, 'null\n'); const failed = await refresh(); assert.equal(failed.status, 503);
  const failedError = (await failed.json()).error; assert.equal(failedError.reason, 'file-parse'); assert.equal(failedError.failedFiles, 1); assert.equal(failedError.retainedSnapshot, true);
  const retained = await json('/api/dashboard?mode=all&timezone=UTC'); assert.equal(retained.totals.totalTokens, 110); assert.equal(retained.scan.snapshotVersion, 1); assert.equal(retained.quality.scan.refreshFailure.reason, 'file-parse'); assert.equal(retained.scan.retainedSnapshot, true);
  assert.equal((await json('/api/sessions?mode=all&timezone=UTC')).totals.totalTokens, 110);
  const detail = await json(`/api/sessions/${retained.sessions[0].sessionKey}?mode=all&timezone=UTC`); assert.equal(detail.usage.totalTokens, 110);
  await write(codex, 'a.jsonl', record(120)); await write(codex, 'b.jsonl', record(20)); assert.equal((await refresh()).status, 200);
  const capped = await json('/api/dashboard?mode=all&timezone=UTC'); assert.equal(capped.scan.snapshotVersion, 2); assert.equal(capped.scan.refreshFailure, null); assert.equal(capped.scan.complete, false); assert.equal(capped.quality.scan.truncated, true); assert.equal(capped.quality.scan.maxFiles, 1); assert.equal(capped.scan.omittedFilesAtLeast, 1); assert.equal(capped.totals.totalTokens, 120);
  const exportResponse = await fetch(`${base}/api/export?mode=all&timezone=UTC&format=json-report`); assert.equal(exportResponse.status, 200); assert.equal((await exportResponse.json()).quality.scan.complete, false);
  await rm(path.join(codex, 'b.jsonl')); assert.equal((await refresh()).status, 200); const complete = await json('/api/dashboard?mode=all&timezone=UTC'); assert.equal(complete.scan.complete, true); assert.equal(complete.scan.truncated, false); assert.equal(complete.scan.snapshotVersion, 3);
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST' })).status, 403);
  for (const value of [initialError, failedError, retained, capped]) assert.ok(!JSON.stringify(value).includes(root));
  console.log(JSON.stringify({ status: 'passed', node: process.version, fixtureOnly: true, initialFailureHasNoSnapshot: true, retainedTokens: retained.totals.totalTokens, retainedVersion: retained.scan.snapshotVersion, repairedVersion: capped.scan.snapshotVersion, completeVersion: complete.scan.snapshotVersion, exactCapComplete: before.scan.complete, exceededCapIncomplete: !capped.scan.complete, failureReason: failedError.reason, detailRetained: detail.usage.totalTokens, securityBoundariesRetained: true }, null, 2));
  if (process.argv.includes('--serve')) {
    await write(codex, 'b.jsonl', record(20)); assert.equal((await refresh()).status, 200); await writeFile(firstFile, 'null\n'); assert.equal((await refresh()).status, 503);
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?range=all&timezone=UTC`);
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.once('data', resolve); process.stdin.resume(); });
    process.stdin.pause();
  }
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
