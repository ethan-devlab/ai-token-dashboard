import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { PRICING, createPricing } from '../server/pricing.mjs';
import { pricingBasis, pricingRevision } from '../server/pricing-basis.mjs';

const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error('Usage: node tests/performance-baseline.mjs <result.json>');
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-performance-'));
const runFile = promisify(execFile);
const results = { version: 1, date: new Date().toISOString(), node: process.version, platform: process.platform,
  arch: process.arch, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), samples: [], workloads: [] };
let child; let base; let blockedFetches = 0; let generation = 0;
const metrics = new Map();
const preload = `import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
const original=http.createServer;
http.createServer=function(listener) { return original.call(this,async(req,res)=>{
 const before=process.memoryUsage(), start=performance.now();
 try { await listener(req,res); }
 finally { process.send?.({type:'metric',url:req.url,serverMs:performance.now()-start,before,after:process.memoryUsage()}); }
}); };
syncBuiltinESMExports();
globalThis.fetch=async()=>{process.send?.({type:'blocked'});return Response.json({}, {status:503});};
`;
async function stop() {
  if (!child) return;
  const current = child; child = null;
  if (current.exitCode != null || current.signalCode != null) return;
  const exit = once(current, 'exit'); current.kill('SIGTERM');
  await Promise.race([exit, delay(5000, null, { ref: false }).then(() => { current.kill('SIGKILL'); throw new Error('Fixture shutdown timed out.'); })]);
}
async function start() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; const closed = once(probe, 'close'); probe.close(); await closed;
  base = `http://127.0.0.1:${port}`;
  const started = performance.now(); let ready = false;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], {
    cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_HOME: path.join(root, 'codex'),
      CLAUDE_CONFIG_DIR: path.join(root, 'claude'), TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', (chunk) => { if (String(chunk).includes('Local AI Token Dashboard:')) ready = true; });
  child.stderr.on('data', () => undefined);
  child.on('message', (message) => { if (message.type === 'blocked') blockedFetches++; else if (message.type === 'metric') metrics.set(message.url, message); });
  for (let i = 0; i < 400; i++) {
    if (child.exitCode != null || child.signalCode != null) throw new Error('Fixture exited before readiness.');
    if (ready) return performance.now() - started;
    await delay(25);
  }
  throw new Error('Fixture readiness timed out.');
}
async function request(workload, operation, route, expectedStatus = 200) {
  const url = route + (route.includes('?') ? '&' : '?') + `benchmarkSample=${++generation}`;
  let sampling = true; let rssMaxBytes = 0; let rssSamples = 0;
  const pid = child.pid;
  const sampler = (async () => {
    while (sampling) {
      const { stdout } = await runFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)]);
      const rss = Number(stdout.trim()) * 1024;
      assert.ok(Number.isFinite(rss) && rss > 0); rssMaxBytes = Math.max(rssMaxBytes, rss); rssSamples++;
      if (sampling) await delay(100);
    }
  })();
  const started = performance.now(); let response; let body; let elapsedMs;
  try {
    response = await fetch(base + url, { signal: AbortSignal.timeout(180000) });
    body = Buffer.from(await response.arrayBuffer()); elapsedMs = performance.now() - started;
  } finally { sampling = false; await sampler; }
  assert.equal(response.status, expectedStatus, `${workload}: ${operation}`);
  for (let i = 0; !metrics.has(url) && i < 100; i++) await delay(10);
  const metric = metrics.get(url); assert.ok(metric, 'Server completion metric missing.'); metrics.delete(url);
  results.samples.push({ workload, operation, elapsedMs, responseBytes: body.length, status: response.status,
    serverMs: metric.serverMs, before: metric.before, after: metric.after, sampledRssMaxBytes: rssMaxBytes, rssSamples });
  console.log(`${workload} ${operation}: ${elapsedMs.toFixed(1)} ms, ${body.length} bytes, sampled RSS ${(rssMaxBytes / 1048576).toFixed(1)} MiB`);
  return { body, response, json: () => JSON.parse(body.toString()) };
}
async function logs(sessions, perSession, idPadding = 0) {
  await rm(path.join(root, 'codex'), { recursive: true, force: true }); await mkdir(path.join(root, 'codex'));
  let bytes = 0;
  for (let s = 0; s < sessions; s++) {
    const lines = [JSON.stringify({ type: 'session_meta', timestamp: '2026-09-01T00:00:00Z', payload: {
      id: `TEST_ONLY_${String(s).padStart(6, '0')}${'x'.repeat(idPadding)}`, cwd: `/TEST_ONLY/workspace-${s % 10}`, model: 'gpt-5.5' } })];
    for (let e = 0; e < perSession; e++) lines.push(JSON.stringify({ type: 'turn.completed', event_id: `${s}-${e}`,
      timestamp: new Date(Date.UTC(2026, 8, 1) + e * 3600000).toISOString(), model: e % 2 ? 'gpt-5.5' : 'gpt-5',
      usage: { input_tokens: 10, output_tokens: 2 } }));
    const content = lines.join('\n') + '\n'; bytes += Buffer.byteLength(content);
    await writeFile(path.join(root, 'codex', `${String(s).padStart(6, '0')}.jsonl`), content);
  }
  return bytes;
}
function pinned(dashboard) { return `mode=all&timezone=UTC&projectionAt=${dashboard.projection.at}&projection=${dashboard.projection.key}`; }
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  await mkdir(path.join(root, 'claude')); await writeFile(path.join(root, 'offline.mjs'), preload);
  await writeFile(path.join(root, '.env'), `CODEX_SESSIONS_DIR=${path.join(root, 'codex')}\nCLAUDE_SESSIONS_DIR=${path.join(root, 'claude')}\nAUTO_REFRESH=0\nMAX_FILES=10000\nPARSE_CONCURRENCY=2\n`);
  for (const sessions of [100, 500, 1500]) {
    const name = `${sessions * 100}-observations`; const inputBytes = await logs(sessions, 100);
    const startupMs = await start();
    const dashboard = (await request(name, 'first-dashboard', '/api/dashboard?mode=all&timezone=UTC')).json();
    assert.equal(dashboard.matchedSessionCount, sessions); assert.equal(dashboard.totals.totalTokens, sessions * 100 * 12);
    assert.equal(dashboard.quality.scan.complete, true); assert.equal(dashboard.quality.scan.failedFiles, 0);
    assert.equal(dashboard.quality.range.usage.incomplete, false); assert.equal(dashboard.quality.range.usage.possibleDuplicate, false);
    assert.equal(dashboard.cost.pricedTokens, dashboard.totals.totalTokens);
    results.workloads.push({ name, sessions, observations: sessions * 100, inputBytes, startupMs, scan: dashboard.scan,
      verifiedTotalTokens: dashboard.totals.totalTokens, verifiedPricedTokens: dashboard.cost.pricedTokens });
    for (let repeat = 0; repeat < 2; repeat++) {
      const warm = (await request(name, 'warm-dashboard', '/api/dashboard?' + pinned(dashboard))).json();
      assert.equal(warm.totals.totalTokens, dashboard.totals.totalTokens);
      const page = (await request(name, 'last-session-page', `/api/sessions?${pinned(dashboard)}&offset=${sessions - 100}`)).json();
      assert.equal(page.sessions.length, 100); assert.equal(page.matchedSessionCount, sessions);
    }
    const filtered = (await request(name, 'model-filter-dashboard', '/api/dashboard?mode=all&timezone=UTC&models=gpt-5')).json();
    assert.equal(filtered.totals.totalTokens, dashboard.totals.totalTokens / 2);
    const detail = (await request(name, 'session-detail', `/api/sessions/${dashboard.sessions[0].sessionKey}?${pinned(dashboard)}`)).json();
    assert.equal(detail.observationCount, 100); assert.equal(detail.usage.totalTokens, 1200);
    const csv = await request(name, 'csv-sessions', '/api/export?format=csv-sessions&' + pinned(dashboard));
    assert.equal(csv.body.toString().split('\r\n').length, sessions + 1);
    const report = (await request(name, 'json-report', '/api/export?format=json-report&' + pinned(dashboard))).json();
    assert.equal(report.totals.totalTokens, dashboard.totals.totalTokens); assert.equal(report.metadata.exportedSessionCount, sessions);
    const trend = await request(name, 'csv-trend', '/api/export?format=csv-trend&' + pinned(dashboard));
    assert.equal(trend.body.toString().split('\r\n').length, dashboard.trend.points.length + 1);
    const markdown = await request(name, 'markdown-summary', '/api/export?format=markdown-summary&' + pinned(dashboard));
    assert.ok(markdown.body.toString().includes(`Total tokens: ${dashboard.totals.totalTokens}`));
    await stop();
  }
  const name = 'oversized-csv'; const inputBytes = await logs(500, 1, 70000); const startupMs = await start();
  const dashboard = (await request(name, 'first-dashboard', '/api/dashboard?mode=all&timezone=UTC')).json();
  assert.equal(dashboard.totals.totalTokens, 6000); assert.equal(dashboard.matchedSessionCount, 500);
  results.workloads.push({ name, sessions: 500, observations: 500, sessionIdPadding: 70000, inputBytes, startupMs });
  const rejected = (await request(name, 'csv-sessions-rejected', '/api/export?format=csv-sessions&' + pinned(dashboard), 413)).json();
  assert.equal(rejected.error.code, 'EXPORT_TOO_LARGE');
  const after = (await request(name, 'providers-after-rejection', '/api/providers')).json(); assert.equal(after.providers.length, 2);
  await stop();

  await logs(1, 1); await start();
  const archiveDirectory = path.join(root, '.pricing-archive', 'codex');
  const baselineRevision = pricingRevision(PRICING); let archived = 1;
  for (const count of [1, 100, 1000, 10000]) {
    while (archived < count) {
      const basis = pricingBasis(PRICING); basis.rules[0].rates.input = 1000 + archived;
      const pricing = createPricing(basis); const revision = pricingRevision(pricing);
      assert.notEqual(revision, baselineRevision);
      await writeFile(path.join(archiveDirectory, revision + '.json'), JSON.stringify({ version: 1, provider: 'codex', revision,
        basis: pricingBasis(pricing), firstArchivedAt: '2026-09-01T00:00:00Z', origin: 'bundled' }) + '\n');
      archived++;
    }
    const workload = `${count}-pricing-versions`; results.workloads.push({ name: workload, pricingVersions: count, activeBaselineRetained: true });
    for (let repeat = 0; repeat < 2; repeat++) for (const offset of [...new Set([0, Math.max(0, count - 100)])]) {
      const listing = (await request(workload, offset ? 'last-version-page' : 'first-version-page', `/api/pricing/versions?provider=codex&limit=100&offset=${offset}`)).json();
      assert.equal(listing.total, count); assert.equal(listing.items.length, Math.min(100, count));
      assert.ok(listing.items.every((item) => item.status === 'verified'));
    }
  }
  await stop(); results.blockedExternalFetches = blockedFetches;
  results.method = { rss: 'External ps RSS in KiB converted to bytes; nominal 100 ms interval plus process cost. In-flight sample can complete after response. Sampled maximum, not exact peak.',
    serverMemory: 'process.memoryUsage before and after the HTTP handler, bytes; retained process, no forced GC.',
    elapsed: 'Parent fetch through complete body consumption; excludes assertions and sampler shutdown.',
    isolation: 'Copied app, synthetic logs and valid archives, all child fetch calls blocked, sequential requests, fresh server for each log workload.',
    limits: 'Two warm repeats; no p95, concurrent load, true cold disk cache, browser render/download, live logs, or Windows claims.' };
  await writeFile(path.resolve(output), JSON.stringify(results, null, 2) + '\n');
  console.log('PASS: workload counts, selected model totals, full CSV rows, detail counts, pinned reports, 413 rejection, post-rejection service, and verified archive pages.');
} finally { await stop(); await rm(root, { recursive: true, force: true }); }
