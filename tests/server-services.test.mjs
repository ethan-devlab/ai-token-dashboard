import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSummaryCache } from '../server/summary-cache.mjs';
import { compareVersions, createUpdateChecker, validRepository } from '../server/update-checker.mjs';
import { parseEnv, readRuntimeConfig } from '../server/config.mjs';
import { PRICING } from '../server/pricing.mjs';
import { createSessionIndex, parseSessionFile } from '../server/session-index.mjs';
import { resolveRange } from '../server/timezone.mjs';

test('summary cache reuses its latest successful in-memory snapshot', async () => {
  let calls = 0;
  const cache = createSummaryCache(async () => ({ marker: ++calls }), () => new Date('2026-07-30T10:00:00Z'));

  const initial = await cache.get();
  const reused = await cache.get();

  assert.equal(calls, 1);
  assert.equal(initial.summary.marker, 1);
  assert.equal(reused.metadata.snapshotVersion, 1);
  assert.equal(reused.metadata.scannedAt, '2026-07-30T10:00:00.000Z');
});

test('summary cache atomically replaces only successful refreshes and deduplicates concurrent refreshes', async () => {
  let calls = 0;
  let shouldFail = false;
  const cache = createSummaryCache(async () => {
    calls += 1;
    if (shouldFail) throw new Error('fixture failure');
    return { marker: calls };
  });

  await cache.get();
  const [first, second] = await Promise.all([cache.refresh(), cache.refresh()]);
  assert.equal(calls, 2);
  assert.equal(first, second);
  assert.equal(first.version, 2);

  shouldFail = true;
  await assert.rejects(cache.refresh(), /fixture failure/);
  const retained = await cache.get();
  assert.equal(retained.summary.marker, 2);
  assert.equal(retained.metadata.snapshotVersion, 2);
});

test('update checker validates its fixed GitHub repository and handles stable releases', async () => {
  assert.equal(validRepository('owner/repo'), true);
  assert.equal(validRepository('https://example.test/repo'), false);
  assert.equal(compareVersions('v1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('invalid', '1.1.9'), null);

  const disabled = createUpdateChecker({ repository: '', currentVersion: '1.0.0' });
  assert.deepEqual(await disabled.check(), { enabled: false, status: 'disabled' });

  const available = createUpdateChecker({
    repository: 'owner/repo',
    currentVersion: '1.0.0',
    fetchImpl: async () => new Response(JSON.stringify({
      tag_name: 'v1.1.0', html_url: 'https://github.test/owner/repo/releases/v1.1.0', body: 'Changes',
      assets: [{ name: 'codex-token-dashboard-v1.1.0.zip', browser_download_url: 'https://github.test/download.zip', digest: 'sha256:abc123' }],
    }), { status: 200 }),
  });
  const update = await available.check();
  assert.equal(update.status, 'available');
  assert.equal(update.latestVersion, '1.1.0');
  assert.deepEqual(update.assets, [{ name: 'codex-token-dashboard-v1.1.0.zip', downloadUrl: 'https://github.test/download.zip', sha256: 'abc123' }]);

  const offline = createUpdateChecker({ repository: 'owner/repo', currentVersion: '1.0.0', fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await offline.check(), { enabled: true, status: 'unavailable', code: 'network' });

  const current = createUpdateChecker({ repository: 'owner/repo', currentVersion: '1.1.0', fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'v1.1.0', html_url: 'https://github.test/release', assets: [] }), { status: 200 }) });
  assert.equal((await current.check()).status, 'current');

  const invalid = createUpdateChecker({ repository: 'owner/repo', currentVersion: '1.0.0', fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'preview', prerelease: false, draft: false }), { status: 200 }) });
  assert.deepEqual(await invalid.check(), { enabled: true, status: 'unavailable', code: 'invalid-release' });
});

test('codex-auto-review pricing leaves unsupported cache components unavailable', () => {
  assert.deepEqual(PRICING.rates['codex-auto-review'], {
    input: 2.5,
    cachedInput: null,
    cacheWrite: null,
    output: 15,
  });
});

test('local env parser accepts only simple uppercase configuration entries', () => {
  assert.deepEqual(parseEnv('# comment\nUPDATE_REPOSITORY="ethan-devlab/codex-token-dashboard"\nlowercase=ignored\nINVALID LINE'), {
    UPDATE_REPOSITORY: 'ethan-devlab/codex-token-dashboard',
  });
});

test('runtime configuration keeps update repository local and rejects an accidental remote bind', () => {
  const localConfig = parseEnv('UPDATE_REPOSITORY=owner/repo\nHOST=127.0.0.1');
  const config = readRuntimeConfig({ environment: { PORT: '4242', UPDATE_REPOSITORY: 'other/repo' }, localConfig });
  assert.equal(config.updateRepository, 'owner/repo');
  assert.equal(config.port, 4242);
  assert.throws(() => readRuntimeConfig({ environment: { HOST: '0.0.0.0' } }), /Non-loopback HOST requires ALLOW_REMOTE=1/);
});

test('timezone ranges use the selected IANA calendar boundary and preserve a half-open interval', () => {
  const range = resolveRange({ mode: 'today', timezone: 'Asia/Taipei', nowMs: Date.parse('2026-07-30T16:00:00.000Z') });
  assert.equal(range.timezone, 'Asia/Taipei');
  assert.equal(new Date(range.fromMs).toISOString(), '2026-07-30T16:00:00.000Z');
  assert.equal(new Date(range.toMs).toISOString(), '2026-07-31T16:00:00.000Z');
  assert.throws(() => resolveRange({ mode: 'today', timezone: 'Not/A_Timezone' }), (error) => error.code === 'INVALID_TIMEZONE');
});

test('session index reconciles observations and incrementally reuses an unchanged file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-index-'));
  try {
    const file = path.join(root, 'fixture.jsonl');
    await writeFile(file, [
      '{"timestamp":"2026-07-30T00:00:00Z","type":"session_meta","payload":{"id":"fixture","model":"gpt-5.6-terra"}}',
      '{"timestamp":"2026-07-30T00:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}',
      '{"timestamp":"2026-07-30T00:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}',
      '{"timestamp":"2026-07-30T00:00:03Z","type":"turn.completed","usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}',
    ].join('\n'));
    const parsed = await parseSessionFile(file, 'fixture.jsonl');
    assert.equal(parsed.reconciliation.duplicate, 1);
    assert.equal(parsed.reconciliation.covered, 1);
    assert.equal(parsed.usage.totalTokens, 15);
    const index = createSessionIndex({ sessionsDirectory: root, maxFiles: 10, parseConcurrency: 2, pricing: PRICING });
    const first = await index.refresh();
    const second = await index.refresh();
    assert.deepEqual([first.scan.added, first.scan.changed, first.scan.reused], [1, 0, 0]);
    assert.deepEqual([second.scan.added, second.scan.changed, second.scan.reused], [0, 0, 1]);
    await writeFile(path.join(root, 'added.jsonl'), '{"type":"session_meta","payload":{"id":"added"}}\n');
    const third = await index.refresh();
    assert.equal(third.scan.added, 1);
    assert.equal(third.scan.reused, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
