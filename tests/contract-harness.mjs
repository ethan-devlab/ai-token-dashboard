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

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const { port } = address;
  server.close();
  await once(server, 'close');
  return port;
}

function startDashboard({ port, sessionsDirectory, updateRepository }) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CODEX_SESSIONS_DIR: sessionsDirectory,
      ...(updateRepository ? { UPDATE_REPOSITORY: updateRepository } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function stopDashboard(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = once(server.child, 'exit');
  server.child.kill();
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out stopping dashboard: ${server.output()}`)), 5_000)),
  ]);
}

async function requestWhenReady(uri, expectedStatus) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(uri);
      if (response.status === expectedStatus) return response;
      lastError = new Error(`Expected ${expectedStatus} from ${uri}, received ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Dashboard did not become reachable at ${uri}.`);
}

function assertSecurityHeaders(response, csp) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), csp);
}

test('local dashboard contract fixture', async () => {
  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `codex-token-dashboard-contract-${timestamp}-`));
  const sessionsDirectory = path.join(temporaryRoot, 'sessions');
  const missingSessionsDirectory = path.join(temporaryRoot, 'missing-sessions');
  const servers = [];

  try {
    await mkdir(sessionsDirectory, { recursive: true });
    await writeFile(path.join(sessionsDirectory, 'reset.jsonl'), [
      '{"timestamp":"2026-07-29T00:00:00Z","type":"session_meta","payload":{"id":"fixture-reset","cwd":"C:\\\\fixture","model":"gpt-5.6-sol"}}',
      '{"timestamp":"2026-07-29T00:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":40,"total_tokens":140}}}}',
      '{"timestamp":"2026-07-29T00:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":40,"total_tokens":140}}}}',
      'not valid json',
      '{"timestamp":"2026-07-29T00:00:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"cached_input_tokens":4,"output_tokens":12,"total_tokens":42}}}}',
      '{"timestamp":"2026-07-29T00:00:04Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":50,"cached_input_tokens":8,"output_tokens":16,"total_tokens":66}}}}',
    ].join('\n'));
    await writeFile(path.join(sessionsDirectory, 'partial.jsonl'), [
      '{"timestamp":"2026-07-29T00:01:00Z","type":"session_meta","payload":{"id":"fixture-partial","model":"gpt-5.5-pro"}}',
      '{"timestamp":"2026-07-29T00:01:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":5,"output_tokens":5,"total_tokens":15}}}}',
    ].join('\n'));
    await writeFile(path.join(sessionsDirectory, 'unknown.jsonl'), [
      '{"timestamp":"2026-07-29T00:02:00Z","type":"session_meta","payload":{"id":"fixture-unknown","model":"fixture-unknown-model"}}',
      '{"timestamp":"2026-07-29T00:02:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}}}}',
    ].join('\n'));

    const port = await getAvailablePort();
    const dashboard = startDashboard({ port, sessionsDirectory });
    servers.push(dashboard);
    const baseUri = `http://127.0.0.1:${port}`;
    await requestWhenReady(`${baseUri}/api/summary`, 200);

    const homeResponse = await fetch(`${baseUri}/`);
    assert.equal(homeResponse.status, 200);
    const homeDocument = await homeResponse.text();
    assert.match(homeDocument, /Codex Token Dashboard/);
    assert.match(homeDocument, /href="\/styles\/tokens\.css"/);
    assert.match(homeDocument, /src="\/scripts\/dashboard\.mjs"/);
    assert.doesNotMatch(homeDocument, /<style|<script(?! type="module" src=)/);
    assertSecurityHeaders(homeResponse, "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

    const cssResponse = await fetch(`${baseUri}/styles/tokens.css`);
    assert.equal(cssResponse.status, 200);
    assert.match(cssResponse.headers.get('content-type') ?? '', /^text\/css/);
    assertSecurityHeaders(cssResponse, "default-src 'none'; frame-ancestors 'none'");
    assert.match(await cssResponse.text(), /--color-canvas/);

    const scriptResponse = await fetch(`${baseUri}/scripts/dashboard.mjs`);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type') ?? '', /^text\/javascript/);
    assertSecurityHeaders(scriptResponse, "default-src 'none'; frame-ancestors 'none'");
    assert.match(await scriptResponse.text(), /from '\.\/format\.mjs'/);

    const traversalResponse = await fetch(`${baseUri}/styles/%2e%2e%2f%2e%2e%2fserver.mjs`);
    assert.equal(traversalResponse.status, 404);
    assert.deepEqual(await traversalResponse.json(), { error: 'Not found' });

    const summaryResponse = await fetch(`${baseUri}/api/summary`);
    assert.equal(summaryResponse.status, 200);
    assert.match(summaryResponse.headers.get('content-type') ?? '', /^application\/json/);
    assertSecurityHeaders(summaryResponse, "default-src 'none'; frame-ancestors 'none'");
    const summary = await summaryResponse.json();

    assert.equal(summary.scan.snapshotVersion, 1);
    assert.equal(summary.scan.refreshing, false);

    const resetSession = summary.sessions.find((session) => session.sessionId === 'fixture-reset');
    assert.ok(resetSession);
    assert.equal(resetSession.invalidLineCount, 1);
    assert.equal(resetSession.duplicateTokenCountEventCount, 1);
    assert.equal(resetSession.cumulativeResetCount, 1);
    assert.equal(resetSession.usage.inputTokens, 150);
    assert.equal(resetSession.usage.outputTokens, 56);
    assert.equal(resetSession.usage.totalTokens, 206);
    assert.ok(resetSession.usageEvents.every((event) => (
      event.usage.inputTokens >= 0 && event.usage.outputTokens >= 0 && event.usage.totalTokens >= 0
    )));

    const partialSession = summary.sessions.find((session) => session.sessionId === 'fixture-partial');
    const unknownSession = summary.sessions.find((session) => session.sessionId === 'fixture-unknown');
    assert.equal(partialSession?.model, 'gpt-5.5-pro');
    assert.equal(summary.pricing.rates['gpt-5.5-pro'].cachedInput, null);
    assert.equal(unknownSession?.model, 'fixture-unknown-model');
    assert.equal(Object.hasOwn(summary.pricing.rates, 'fixture-unknown-model'), false);

    const dashboardResponse = await fetch(`${baseUri}/api/dashboard?mode=all&limit=1&sort=recent`);
    assert.equal(dashboardResponse.status, 200);
    assertSecurityHeaders(dashboardResponse, "default-src 'none'; frame-ancestors 'none'");
    const dashboardData = await dashboardResponse.json();
    assert.equal(dashboardData.totals.totalTokens, 231);
    assert.equal(dashboardData.sessionCount, 3);
    assert.equal(dashboardData.matchedSessionCount, 3);
    assert.equal(dashboardData.sessions.length, 1);
    assert.equal(dashboardData.hasNext, true);
    assert.equal(dashboardData.sessions[0].usageEvents.some((event) => Object.hasOwn(event, 'payload')), false);
    assert.equal(dashboardData.cost.unknownModels.includes('fixture-unknown-model'), true);
    assert.equal(dashboardData.scan.snapshotVersion, 1);

    const sessionsResponse = await fetch(`${baseUri}/api/sessions?mode=all&limit=1&offset=1&sort=recent`);
    assert.equal(sessionsResponse.status, 200);
    assertSecurityHeaders(sessionsResponse, "default-src 'none'; frame-ancestors 'none'");
    const sessionsData = await sessionsResponse.json();
    assert.equal(sessionsData.offset, 1);
    assert.equal(sessionsData.sessions.length, 1);
    assert.equal(sessionsData.hasPrevious, true);
    assert.equal(sessionsData.scan.snapshotVersion, 1);

    await writeFile(path.join(sessionsDirectory, 'later.jsonl'), [
      '{"timestamp":"2026-07-29T00:03:00Z","type":"session_meta","payload":{"id":"fixture-later","model":"gpt-5.6-terra"}}',
      '{"timestamp":"2026-07-29T00:03:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":25,"output_tokens":5,"total_tokens":30}}}}',
    ].join('\n'));
    const cachedDashboardResponse = await fetch(`${baseUri}/api/dashboard?mode=all`);
    const cachedDashboard = await cachedDashboardResponse.json();
    assert.equal(cachedDashboard.sessionCount, 3);
    assert.equal(cachedDashboard.scan.snapshotVersion, 1);

    const refreshResponse = await fetch(`${baseUri}/api/refresh?mode=all`, { method: 'POST' });
    assert.equal(refreshResponse.status, 200);
    const refreshedDashboard = await refreshResponse.json();
    assert.equal(refreshedDashboard.sessionCount, 4);
    assert.equal(refreshedDashboard.scan.snapshotVersion, 2);

    const updateDisabledResponse = await fetch(`${baseUri}/api/update`);
    assert.deepEqual(await updateDisabledResponse.json(), { enabled: false, status: 'disabled' });

    const invalidRangeResponse = await fetch(`${baseUri}/api/dashboard?from=4&to=4`);
    assert.equal(invalidRangeResponse.status, 400);
    assert.deepEqual(await invalidRangeResponse.json(), { error: 'The from timestamp must be earlier than to.' });
    assertSecurityHeaders(invalidRangeResponse, "default-src 'none'; frame-ancestors 'none'");

    const notFoundResponse = await fetch(`${baseUri}/not-found`);
    assert.equal(notFoundResponse.status, 404);
    assert.deepEqual(await notFoundResponse.json(), { error: 'Not found' });
    assertSecurityHeaders(notFoundResponse, "default-src 'none'; frame-ancestors 'none'");

    await stopDashboard(dashboard);

    const missingPort = await getAvailablePort();
    const missingDashboard = startDashboard({ port: missingPort, sessionsDirectory: missingSessionsDirectory });
    servers.push(missingDashboard);
    const missingResponse = await requestWhenReady(`http://127.0.0.1:${missingPort}/api/summary`, 500);
    assert.match((await missingResponse.json()).error, /^Sessions directory does not exist:/);
    assertSecurityHeaders(missingResponse, "default-src 'none'; frame-ancestors 'none'");
  } finally {
    await Promise.all(servers.map((server) => stopDashboard(server)));
    await rm(temporaryRoot, { recursive: true, force: true });
    console.log(`CLEANUP removed temporary fixture directory: ${temporaryRoot}`);
  }
});
