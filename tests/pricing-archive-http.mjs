import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { pricingFromBasis, pricingRevision } from '../server/pricing-basis.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-pricing-archive-http-')); let child;
try {
  await Promise.all(['server', 'public'].map((name) => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map((name) => cp(path.join(source, name), path.join(root, name))));
  const html = path.join(root, 'public', 'index.html'); await writeFile(html, (await readFile(html, 'utf8')).replace('<main ', '<p role="status">TEST ONLY pricing archive QA. Synthetic usage and rates, isolated archive/cache, no external requests.</p><main '));
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude'); await mkdir(codex); await mkdir(claude);
  await writeFile(path.join(codex, 'fixture.jsonl'), [{ type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { id: 'TEST_ONLY_PRICING', model: 'gpt-5.5', cwd: '/TEST_ONLY/workspace' } }, { type: 'turn.completed', timestamp: '2026-10-01T00:00:01Z', model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 0 } }].map(JSON.stringify).join('\n') + '\n');
  const archive = path.join(root, '.pricing-archive', 'codex'); const backup = path.join(root, 'archive-backup'); await mkdir(path.dirname(archive)); await writeFile(archive, 'TEST ONLY blocked directory');
  let blocked = true; let backedUp = false;
  const block = async () => { if (blocked) return; await rename(archive, backup); backedUp = true; await writeFile(archive, 'TEST ONLY blocked directory'); blocked = true; };
  const unblock = async () => { if (!blocked) return; await rm(archive); if (backedUp) { await rename(backup, archive); backedUp = false; } blocked = false; };
  const stateFile = path.join(root, 'fixture-state.json'); const mode = (input) => writeFile(stateFile, JSON.stringify({ input })); await mode(5);
  await writeFile(path.join(root, 'offline.mjs'), `import { readFile } from 'node:fs/promises';
import { PRICING } from './server/pricing.mjs';
globalThis.fetch = async (url) => {
  if (!String(url).includes('developers.openai.com')) return Response.json({}, { status: 503 });
  const { input } = JSON.parse(await readFile(new URL('./fixture-state.json', import.meta.url), 'utf8'));
  const price = (v) => v == null ? '-' : '$' + v;
  const rows = Object.entries(PRICING.rates).map(([id, r]) => '| ' + [id, price(id === 'gpt-5.5' ? input : r.input), price(r.cachedInput), price(r.cacheWrite), price(r.output)].join(' | ') + ' |');
  return new Response('### Standard pricing data\\n| Model | Short context input | Short context cached input | Short context cache writes | Short context output |\\n|---|---|---|---|---|\\n' + rows.join('\\n'), { headers: { 'content-type': 'text/markdown' } });
};\n`);
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; probe.close(); await once(probe, 'close'); const base = `http://127.0.0.1:${port}`;
  const start = async () => {
    child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root, env: { HOST: '127.0.0.1', PORT: String(port), CODEX_SESSIONS_DIR: codex, CLAUDE_SESSIONS_DIR: claude, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, AUTO_REFRESH: '0', MAX_FILES: '100', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 60; attempt++) { if (child.exitCode != null) throw new Error(output); try { if ((await fetch(base + '/api/providers')).ok) return; } catch {} await delay(50); }
    throw new Error('Isolated pricing server did not start.');
  };
  const stop = async () => { if (child?.exitCode == null) { child.kill(); await once(child, 'exit'); } };
  await start();
  const json = async (route) => { const response = await fetch(base + route); assert.equal(response.status, 200, route); return response.json(); };
  const query = 'provider=codex&mode=all&timezone=UTC'; const dashboard = () => json('/api/dashboard?' + query);
  const refresh = () => fetch(base + '/api/pricing/refresh?' + query, { method: 'POST', headers: { Origin: base } });
  const unknown = await dashboard(); assert.equal(unknown.totals.totalTokens, 10); assert.equal(unknown.cost.total, null); assert.equal(unknown.models[0].cost, null); assert.equal(unknown.trend.points[0].cost, null);
  assert.equal((await refresh()).status, 502);
  await unblock(); assert.equal((await refresh()).status, 200); const known = await dashboard(); assert.equal(known.cost.total, 0.00005); assert.equal(known.pricing.archive.available, true);
  const versionRoute = '/api/pricing/versions/' + known.pricing.revision + '?provider=codex'; const record = await json(versionRoute); assert.equal(pricingRevision(pricingFromBasis(record.basis)), known.pricing.revision);
  assert.equal((await json('/api/pricing/versions?provider=codex')).total, 1);
  assert.equal((await fetch(base + versionRoute.replace('provider=codex', 'provider=claude'))).status, 404); assert.equal((await fetch(base + '/api/pricing/versions/bad?provider=codex')).status, 400); assert.equal((await fetch(base + '/api/pricing/versions?limit=101')).status, 400);
  const pin = `projection=${known.projection.key}&projectionAt=${known.projection.at}`;
  assert.equal((await refresh()).status, 200); assert.equal((await fetch(base + '/api/sessions?' + query + '&' + pin)).status, 200);
  await mode(7); assert.equal((await refresh()).status, 200); const changed = await dashboard(); assert.ok(Math.abs(changed.cost.total - 0.00007) < 1e-12); assert.notEqual(changed.pricing.revision, known.pricing.revision); assert.equal((await fetch(base + '/api/sessions?' + query + '&' + pin)).status, 409); assert.equal((await json(versionRoute)).revision, known.pricing.revision);
  await block(); await mode(9); assert.equal((await refresh()).status, 502); const retained = await dashboard(); assert.equal(retained.cost.total, null); assert.equal(retained.totals.totalTokens, 10); assert.equal(retained.pricing.revision, changed.pricing.revision); assert.equal(retained.pricing.archive.error, 'archive');
  await unblock(); assert.equal((await refresh()).status, 200); const recovered = await dashboard(); assert.ok(Math.abs(recovered.cost.total - 0.00009) < 1e-12); assert.equal((await json('/api/pricing/versions?provider=codex')).total, 3);
  const report = await json('/api/export?' + query + '&format=json-report'); assert.equal(pricingRevision(pricingFromBasis(report.metadata.pricing.basis)), recovered.pricing.revision); assert.equal(report.metadata.pricing.archive.available, true);
  await stop(); await start(); assert.equal((await dashboard()).pricing.revision, recovered.pricing.revision); assert.equal((await json(versionRoute)).firstArchivedAt, record.firstArchivedAt);
  console.log(JSON.stringify({ status: 'passed', fixtureOnly: true, node: process.version, startupUnknown: true, tokenCount: 10, versionCounts: [1, 2, 3], archivedBeforeActivation: true, sameBasisGuardStable: true, changedBasisConflict: true, providerIsolation: true, restartAndFullExportBasis: true }));
  if (process.argv.includes('--serve')) {
    await block(); await stop(); await start();
    console.log(`TEST ONLY desktop QA: http://localhost:${port}/?provider=codex&range=all&timezone=UTC`);
    console.log('Commands: unblock (restore storage), block (fail new basis writes, input=11). Then use UI price update.');
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.on('data', async (chunk) => { const command = String(chunk).trim(); if (command === 'unblock') await unblock(); if (command === 'block') { await block(); await mode(11); } console.log('TEST ONLY command completed: ' + command); }); process.stdin.resume(); }); process.stdin.pause();
  }
} finally { if (child?.exitCode == null) { child.kill(); await once(child, 'exit'); } await rm(root, { recursive: true, force: true }); }
