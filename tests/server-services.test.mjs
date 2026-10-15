import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdFrameGuard } from '../server/zstd-frame.mjs';
import { createSummaryCache } from '../server/summary-cache.mjs';
import { compareVersions, createUpdateChecker, validRepository } from '../server/update-checker.mjs';
import { parseEnv, readRuntimeConfig } from '../server/config.mjs';
import { createPricing, matchPricingRule, PRICING } from '../server/pricing.mjs';
import { createPricingRefreshService, parseStandardPricingMarkdown } from '../server/pricing-refresh.mjs';
import { createSessionIndex, parseSessionFile } from '../server/session-index.mjs';
import { parseClaudeSessionFile } from '../server/claude-session.mjs';
import { CLAUDE_PRICING } from '../server/pricing.mjs';
import { createClaudePricingRefreshService, parseClaudePricingMarkdown } from '../server/claude-pricing-refresh.mjs';
import { buildDashboardPayload, buildExport, calculateCost } from '../server/dashboard-data.mjs';
import { pricingBasis, pricingFromBasis, pricingRevision } from '../server/pricing-basis.mjs';
import { readSettings, saveSettings, settingsPayload } from '../server/settings.mjs';
import { bucketFor, nextBucketFor, resolveRange } from '../server/timezone.mjs';
import { createAccountUsageService, normalizeClaudeUsage, normalizeCodexUsage } from '../server/account-usage.mjs';

test('account usage normalizes provider windows without exposing credential or account fields', () => {
  const codex = normalizeCodexUsage({
    plan_type: 'plus',
    email: 'private@example.test',
    rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 60, limit_window_seconds: 604_800, reset_at: 1_800_604_800 },
    },
  }, '2026-08-24T00:00:00.000Z');
  assert.equal(codex.windows[0].kind, 'five-hour');
  assert.equal(codex.windows[0].remainingPercent, 80);
  assert.equal(codex.windows[1].kind, 'secondary');
  assert.equal(JSON.stringify(codex).includes('private@example.test'), false);

  const claude = normalizeClaudeUsage({
    five_hour: { utilization: 12.5, resets_at: '2026-08-24T05:00:00Z' },
    seven_day: { utilization: 44, resets_at: '2026-08-30T00:00:00Z' },
  }, '2026-08-24T00:00:00.000Z', 'pro');
  assert.deepEqual(claude.windows.map((item) => [item.kind, item.remainingPercent]), [['five-hour', 87.5], ['seven-day', 56]]);
});

test('account usage reads Codex login credentials server-side and deduplicates cached requests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'account-usage-codex-'));
  try {
    const authPath = path.join(directory, 'auth.json');
    await writeFile(authPath, JSON.stringify({ tokens: { access_token: 'codex-secret', account_id: 'account-secret' } }));
    let calls = 0;
    const service = createAccountUsageService({
      codexAuthPath: authPath,
      now: () => Date.parse('2026-08-24T00:00:00Z'),
      fetchImpl: async (url, options) => {
        calls += 1;
        assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
        assert.equal(options.headers.authorization, 'Bearer codex-secret');
        assert.equal(options.headers['chatgpt-account-id'], 'account-secret');
        return new Response(JSON.stringify({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 604_800, reset_at: 1_800_000_000 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const [first, second] = await Promise.all([service.get('codex'), service.get('codex')]);
    assert.equal(calls, 1);
    assert.equal(first.remainingPercent, undefined);
    assert.equal(first.windows[0].remainingPercent, 75);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first).includes('secret'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('account usage leaves expired Claude credentials to the CLI without network or writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'account-usage-claude-'));
  try {
    const credentialsPath = path.join(directory, '.credentials.json');
    await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { accessToken: 'expired', refreshToken: 'refresh-secret', expiresAt: 1, scopes: ['user:profile'], subscriptionType: 'max' }, preserved: true }));
    const before = await readFile(credentialsPath, 'utf8');
    const urls = [];
    const service = createAccountUsageService({
      claudeCredentialsPath: credentialsPath,
      now: () => Date.parse('2026-08-24T00:00:00Z'),
      fetchImpl: async (url, options) => {
        urls.push(url);
        throw new Error('Expired credentials must not send any request.');
      },
    });
    const result = await service.get('claude');
    assert.deepEqual(urls, []);
    assert.equal(result.reason, 'auth-expired'); assert.deepEqual(result.windows, []);
    assert.equal(await readFile(credentialsPath, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('account usage reports unavailable states without throwing or returning credential data', async () => {
  const service = createAccountUsageService({ codexAuthPath: path.join(os.tmpdir(), `missing-${Date.now()}.json`) });
  const result = await service.get('codex');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'not-signed-in');
  assert.deepEqual(result.windows, []);
});

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
    fetchImpl: async (_url, options) => { assert.equal(options.headers['User-Agent'], 'ai-token-dashboard-update-check'); return new Response(JSON.stringify({
      tag_name: 'v1.1.0', html_url: 'https://github.test/owner/repo/releases/v1.1.0', body: 'Changes',
      assets: [{ name: 'codex-token-dashboard-v1.1.0.zip', browser_download_url: 'https://github.test/download.zip', digest: 'sha256:abc123' }, { name: 'ai-token-dashboard-v1.1.0.zip', browser_download_url: 'https://github.test/new.zip', digest: 'sha256:def456' }],
    }), { status: 200 }); },
  });
  const update = await available.check();
  assert.equal(update.status, 'available');
  assert.equal(update.latestVersion, '1.1.0');
  assert.deepEqual(update.assets, [{ name: 'codex-token-dashboard-v1.1.0.zip', downloadUrl: 'https://github.test/download.zip', sha256: 'abc123' }, { name: 'ai-token-dashboard-v1.1.0.zip', downloadUrl: 'https://github.test/new.zip', sha256: 'def456' }]);

  const offline = createUpdateChecker({ repository: 'owner/repo', currentVersion: '1.0.0', fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await offline.check(), { enabled: true, status: 'unavailable', code: 'network' });

  const current = createUpdateChecker({ repository: 'owner/repo', currentVersion: '1.1.0', fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'v1.1.0', html_url: 'https://github.test/release', assets: [] }), { status: 200 }) });
  assert.equal((await current.check()).status, 'current');

  const invalid = createUpdateChecker({ repository: 'owner/repo', currentVersion: '1.0.0', fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'preview', prerelease: false, draft: false }), { status: 200 }) });
  assert.deepEqual(await invalid.check(), { enabled: true, status: 'unavailable', code: 'invalid-release' });
});

test('both pricing providers identify the renamed application on fixed source requests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-token-dashboard-agents-'));
  try {
    for (const [provider, create, baseline] of [['codex', createPricingRefreshService, PRICING], ['claude', createClaudePricingRefreshService, CLAUDE_PRICING]]) {
      let called = false;
      const service = create({ baseline, cachePath: path.join(directory, `${provider}.json`), fetchImpl: async (_url, options) => {
        assert.equal(options.headers['User-Agent'], 'ai-token-dashboard-pricing-check'); called = true; return new Response('', { status: 503 });
      } });
      await assert.rejects(service.refresh({ manual: true }), error => error.code === 'http'); assert.equal(called, true); await service.close();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('codex-auto-review pricing leaves unsupported cache components unavailable', () => {
  assert.deepEqual(PRICING.rates['codex-auto-review'], {
    input: 2.5,
    cachedInput: null,
    cacheWrite: null,
    cacheWrite5m: null,
    cacheWrite1h: null,
    output: 15,
  });
});

test('pricing rules are validated and choose effective aliases deterministically', () => {
  assert.equal(matchPricingRule(PRICING, 'codex-auto-review', '2026-07-30T00:00:00Z').id, 'codex-auto-review');
  assert.throws(() => createPricing({ unitTokens: 1_000_000, updatedAt: '2026-01-01', rules: [
    { id: 'one', aliases: ['shared'], pattern: '^one$', effectiveFrom: '2026-01-01', rates: {} },
    { id: 'two', aliases: ['shared'], pattern: '^two$', effectiveFrom: '2026-01-01', rates: {} },
  ] }), /Overlapping pricing alias/);
});

test('current rates price historical usage and distinguish unknown, partial, free and empty totals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-dashboard-current-rates-'));
  const index = createSessionIndex({ sessionsDirectory: root, maxFiles: 10, parseConcurrency: 1, pricing: PRICING });
  const request = { range: resolveRange({ mode: 'month', period: '2026-06', timezone: 'UTC' }), nowMs: Date.parse('2026-10-14T12:00Z'), q: '', sort: 'recent', offset: 0, limit: 100, filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } };
  const revision = pricingRevision(PRICING);
  const body = (model, input) => JSON.stringify({ type: 'turn.completed', timestamp: '2026-06-15T12:00:00Z', model, usage: { input_tokens: input, output_tokens: 0 } }) + '\n';
  try {
    const historical = matchPricingRule(pricingFromBasis(pricingBasis(PRICING)), 'gpt-5.5', '2026-06-15T12:00Z');
    assert.equal(historical.id, 'gpt-5.5');
    assert.equal(historical.effectiveFrom, PRICING.rules.find((rule) => rule.id === 'gpt-5.5').effectiveFrom);
    await writeFile(path.join(root, 'known.jsonl'), body('gpt-5.5', 10));
    let dashboard = buildDashboardPayload(await index.refresh(), request, {});
    assert.equal(dashboard.cost.total, 10 * historical.rates.input / PRICING.unitTokens);
    assert.equal(dashboard.cost.available, true);
    assert.equal(dashboard.pricingCoverage.partial, false);
    assert.equal(dashboard.pricing.revision, revision);
    assert.equal(dashboard.pricing.calculationPolicy, dashboard.projection.pricingPolicy);
    await writeFile(path.join(root, 'unknown.jsonl'), body('no-public-rate', 20));
    dashboard = buildDashboardPayload(await index.refresh(), request, {});
    assert.equal(dashboard.cost.pricedTokens, 10); assert.equal(dashboard.cost.unpricedTokens, 20);
    assert.equal(dashboard.cost.available, true); assert.equal(dashboard.pricingCoverage.partial, true);
    assert.equal(dashboard.trend.points[0].cost, dashboard.cost.total);
    assert.equal(dashboard.models.find((item) => item.model === 'no-public-rate').cost, null);
    await rm(path.join(root, 'known.jsonl'));
    dashboard = buildDashboardPayload(await index.refresh(), request, {});
    assert.equal(dashboard.cost.total, null); assert.equal(dashboard.cost.available, false);
    assert.equal(dashboard.cost.unavailableReason, 'unpriced-usage'); assert.equal(dashboard.pricingCoverage.ratio, 0);
    assert.equal(dashboard.trend.points[0].cost, null); assert.equal(dashboard.models[0].cost, null);
    assert.equal(dashboard.sessions[0].pricingStatus, 'unknown');
    assert.equal(JSON.parse(buildExport('json-report', dashboard).body).cost.total, null);
    assert.match(buildExport('markdown-summary', dashboard).body, /Known token cost: unknown/);
    for (const format of ['csv-sessions', 'csv-trend']) {
      const [header, row] = buildExport(format, dashboard).body.split('\r\n');
      assert.equal(row.split(',')[header.split(',').indexOf('cost')], '""');
    }
    const event = { model: 'gpt-5.5', timestamp: '2026-06-15T12:00Z', usage: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0 } };
    const free = calculateCost(createPricing({ ...PRICING, rules: [{ ...historical, rates: { ...historical.rates, input: 0 } }] }), [event]);
    assert.equal(free.total, 0); assert.equal(free.available, true); assert.equal(free.pricedTokens, 10);
    assert.equal(calculateCost(PRICING, []).total, 0);
    assert.equal(pricingRevision(PRICING), revision);
  } finally { await index.close(); await rm(root, { recursive: true, force: true }); }
});

const pricingMarkdown = `# Pricing

### Standard pricing data

| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-5.6-sol | $5.00 | $0.50 | $6.25 | $30.00 | $10.00 | $1.00 | $12.50 | $45.00 |
| gpt-5.6-terra | $2.00 | $0.20 | $2.50 | $12.00 | $4.00 | $0.40 | $5.00 | $18.00 |
| gpt-5.6-luna | $0.20 | $0.02 | $0.25 | $1.20 | $0.40 | $0.04 | $0.50 | $1.80 |
| gpt-5.5 (<272K context length) | $5.00 | $0.50 | - | $30.00 | $10.00 | $1.00 | - | $45.00 |
| gpt-5.4 | $2.50 | $0.25 | - | $15.00 | $5.00 | $0.50 | - | $22.50 |
| gpt-5.2 | $1.75 | $0.175 | - | $14.00 | - | - | - | - |
| gpt-5.1 | $1.25 | $0.125 | - | $10.00 | - | - | - | - |
| gpt-5 | $1.25 | $0.125 | - | $10.00 | - | - | - | - |
| gpt-5-mini | $0.25 | $0.025 | - | $2.00 | - | - | - | - |
| gpt-5-nano | $0.05 | $0.005 | - | $0.40 | - | - | - | - |
`;

test('pricing markdown parser reads the official Standard short-context rates', () => {
  const rates = parseStandardPricingMarkdown(pricingMarkdown);
  assert.deepEqual(rates['gpt-5.6-terra'], { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12, contextTier: { aboveInputTokens: 272000, rates: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 18 } } });
  assert.deepEqual(rates['gpt-5.5'], { input: 5, cachedInput: 0.5, cacheWrite: null, output: 30, contextTier: { aboveInputTokens: 272000, rates: { input: 10, cachedInput: 1, cacheWrite: null, output: 45 } } });
});

test('pricing refresh runs automatically once per UTC day across restarts and manual refresh remains unrestricted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-pricing-'));
  const cachePath = path.join(directory, 'pricing-cache.json');
  let currentTime = new Date('2026-08-06T10:00:00Z');
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls += 1; return new Response(pricingMarkdown, { status: 200, headers: { 'content-type': 'text/markdown' } }); };
  try {
    const service = createPricingRefreshService({ baseline: PRICING, cachePath, fetchImpl, now: () => currentTime });
    await service.refresh();
    assert.equal((await service.refresh()).attempted, false);
    await service.refresh({ manual: true });
    await service.refresh({ manual: true });
    assert.equal(fetchCalls, 3);
    assert.deepEqual(service.current().rates['gpt-5.6-terra'], { input: 2, cachedInput: 0.2, cacheWrite: 2.5, cacheWrite5m: null, cacheWrite1h: null, output: 12, contextTier: { aboveInputTokens: 272000, rates: { input: 4, cachedInput: 0.4, cacheWrite: 5, cacheWrite5m: null, cacheWrite1h: null, output: 18 } } });
    assert.deepEqual(service.current().rates['codex-auto-review'], PRICING.rates['codex-auto-review']);

    currentTime = new Date('2026-08-07T10:00:00Z');
    await service.refresh();
    assert.equal(fetchCalls, 4);

    const restarted = createPricingRefreshService({ baseline: PRICING, cachePath, fetchImpl, now: () => currentTime });
    assert.equal((await restarted.refresh()).attempted, false);
    assert.equal(fetchCalls, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed pricing refresh retains the latest valid prices', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-pricing-failure-'));
  const cachePath = path.join(directory, 'pricing-cache.json');
  let fail = false;
  const fetchImpl = async () => {
    if (fail) throw new Error('offline fixture');
    return new Response(pricingMarkdown, { status: 200, headers: { 'content-type': 'text/markdown' } });
  };
  try {
    const service = createPricingRefreshService({ baseline: PRICING, cachePath, fetchImpl });
    await service.refresh({ manual: true });
    const retained = service.current();
    fail = true;
    await assert.rejects(service.refresh({ manual: true }), /Could not reach the pricing source/);
    assert.equal(service.current(), retained);
    assert.equal(service.status().lastError, 'network');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  const defaults = readRuntimeConfig({ environment: { UPDATE_REPOSITORY: 'other/repo' } });
  assert.equal(defaults.updateRepository, 'ethan-devlab/ai-token-dashboard');
  assert.equal(readRuntimeConfig({ environment: {}, localConfig: { UPDATE_REPOSITORY: 'ethan-devlab/codex-token-dashboard' } }).updateRepository, 'ethan-devlab/codex-token-dashboard');
  assert.equal(settingsPayload({}, defaults).settings.UPDATE_REPOSITORY, defaults.updateRepository);
  const disabled = readRuntimeConfig({ environment: {}, localConfig: { UPDATE_REPOSITORY: '' } });
  assert.equal(disabled.updateRepository, '');
  assert.equal(settingsPayload({ UPDATE_REPOSITORY: '' }, disabled).settings.UPDATE_REPOSITORY, '');
  assert.throws(() => readRuntimeConfig({ environment: { HOST: '0.0.0.0' } }), /Non-loopback HOST requires ALLOW_REMOTE=1/);
});

test('session directories expand only a leading home shorthand for either provider', () => {
  for (const slash of ['/', '\\']) {
    const config = readRuntimeConfig({ environment: {}, localConfig: parseEnv(`CODEX_SESSIONS_DIR=~${slash}.codex${slash}sessions\nCLAUDE_SESSIONS_DIR=~${slash}.claude${slash}projects`) });
    assert.equal(config.codexSessionsDirectory, path.join(os.homedir(), '.codex', 'sessions'));
    assert.equal(config.claudeSessionsDirectory, path.join(os.homedir(), '.claude', 'projects'));
  }
  const home = readRuntimeConfig({ environment: { CODEX_SESSIONS_DIR: '~', CLAUDE_SESSIONS_DIR: '~' } });
  assert.equal(home.codexSessionsDirectory, os.homedir());
  assert.equal(home.claudeSessionsDirectory, os.homedir());
  const relative = readRuntimeConfig({ environment: {}, localConfig: { CODEX_SESSIONS_DIR: './sessions/~literal', CLAUDE_SESSIONS_DIR: '~another/projects' } });
  assert.equal(relative.codexSessionsDirectory, path.resolve('./sessions/~literal'));
  assert.equal(relative.claudeSessionsDirectory, path.resolve('~another/projects'));
});

test('detail observation limit validates env configuration without changing parse limits', () => {
  assert.equal(readRuntimeConfig({ environment: {} }).detailObservationLimit, 2000);
  const config = readRuntimeConfig({ environment: {}, localConfig: parseEnv('DETAIL_OBSERVATION_LIMIT=5000\nMAX_FILES=42') });
  assert.equal(config.detailObservationLimit, 5000);
  assert.equal(config.maxFiles, 42);
  assert.equal(readRuntimeConfig({ environment: { DETAIL_OBSERVATION_LIMIT: '1' }, localConfig: { DETAIL_OBSERVATION_LIMIT: '5000' } }).detailObservationLimit, 1);
  assert.equal(readRuntimeConfig({ environment: { DETAIL_OBSERVATION_LIMIT: '100000' } }).detailObservationLimit, 100000);
  for (const invalid of ['0', '-1', '1.5', '100001', '', 'NaN']) {
    assert.throws(() => readRuntimeConfig({ environment: {}, localConfig: { DETAIL_OBSERVATION_LIMIT: invalid } }), /Invalid DETAIL_OBSERVATION_LIMIT/);
  }
});

test('settings persistence validates before atomically replacing the local env file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-token-dashboard-settings-'));
  const envPath = path.join(directory, '.env');
  const values = {
    HOST: '127.0.0.1', PORT: '3344', CODEX_SESSIONS_DIR: directory, CLAUDE_SESSIONS_DIR: directory, MAX_FILES: '100', PARSE_CONCURRENCY: '2',
    ALLOW_REMOTE: '0', EXPOSE_FULL_PATHS: '0', AUTO_REFRESH: '1', AUTO_REFRESH_DEBOUNCE_MS: '250', UPDATE_REPOSITORY: 'owner/repo',
  };
  try {
    await writeFile(envPath, '# local settings\nCUSTOM_VALUE=preserve\nPORT=3333\nDETAIL_OBSERVATION_LIMIT=5000\n');
    const current = await readSettings(envPath, readRuntimeConfig({ environment: {}, localConfig: {} }));
    const { localConfig: saved, revision } = await saveSettings(envPath, values, { revision: current.revision });
    const persisted = await readFile(envPath, 'utf8');
    assert.match(persisted, /^# local settings\nCUSTOM_VALUE=preserve\nPORT=3344/m);
    assert.equal(saved.UPDATE_REPOSITORY, 'owner/repo');
    assert.equal(saved.DETAIL_OBSERVATION_LIMIT, '5000');
    assert.equal(readRuntimeConfig({ environment: {}, localConfig: saved }).detailObservationLimit, 5000);
    assert.equal(settingsPayload(saved, readRuntimeConfig({ environment: {}, localConfig: saved })).restartRequired, true);

    const beforeInvalidSave = persisted;
    assert.throws(() => saveSettings(envPath, { ...values, HOST: '0.0.0.0' }, { revision }), (error) => error?.code === 'INVALID_SETTINGS');
    assert.equal(await readFile(envPath, 'utf8'), beforeInvalidSave);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('timezone ranges use the selected IANA calendar boundary and preserve a half-open interval', () => {
  const range = resolveRange({ mode: 'today', timezone: 'Asia/Taipei', nowMs: Date.parse('2026-07-30T16:00:00.000Z') });
  assert.equal(range.timezone, 'Asia/Taipei');
  assert.equal(new Date(range.fromMs).toISOString(), '2026-07-30T16:00:00.000Z');
  assert.equal(new Date(range.toMs).toISOString(), '2026-07-31T16:00:00.000Z');
  assert.throws(() => resolveRange({ mode: 'today', timezone: 'Not/A_Timezone' }), (error) => error.code === 'INVALID_TIMEZONE');
  const monthStart = bucketFor(Date.parse('2026-07-30T16:00:00.000Z'), 'month', 'Asia/Taipei');
  assert.equal(new Date(nextBucketFor(monthStart, 'month', 'Asia/Taipei')).toISOString(), '2026-07-31T16:00:00.000Z');
  const hourlyStart = bucketFor(Date.parse('2026-07-30T10:54:06.000Z'), 'hour', 'Asia/Singapore');
  assert.equal(new Date(hourlyStart).toISOString(), '2026-07-30T10:00:00.000Z');
  assert.equal(new Date(nextBucketFor(hourlyStart, 'hour', 'Asia/Singapore')).toISOString(), '2026-07-30T11:00:00.000Z');
  const selectedMonth = resolveRange({ mode: 'month', period: '2026-02', timezone: 'America/New_York' });
  assert.equal(new Date(selectedMonth.fromMs).toISOString(), '2026-02-01T05:00:00.000Z');
  assert.equal(new Date(selectedMonth.toMs).toISOString(), '2026-03-01T05:00:00.000Z');

  const now = Date.parse('2026-07-30T10:54:06.000Z');
  const periods = Object.fromEntries(['all', 'last24h', 'today', 'week', 'month', 'year'].map((mode) => [mode, resolveRange({ mode, timezone: 'Asia/Singapore', nowMs: now })]));
  assert.equal(periods.all.fromMs, undefined);
  assert.equal(periods.all.toMs, undefined);
  assert.equal(periods.last24h.toMs - periods.last24h.fromMs, 86_400_000);
  assert.equal(new Date(periods.today.fromMs).toISOString(), '2026-07-29T16:00:00.000Z');
  assert.equal(new Date(periods.today.toMs).toISOString(), '2026-07-30T16:00:00.000Z');
  assert.equal(new Date(periods.week.fromMs).toISOString(), '2026-07-26T16:00:00.000Z');
  assert.equal(new Date(periods.week.toMs).toISOString(), '2026-08-02T16:00:00.000Z');
  assert.equal(new Date(periods.month.fromMs).toISOString(), '2026-06-30T16:00:00.000Z');
  assert.equal(new Date(periods.month.toMs).toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(new Date(periods.year.fromMs).toISOString(), '2025-12-31T16:00:00.000Z');
  assert.equal(new Date(periods.year.toMs).toISOString(), '2026-12-31T16:00:00.000Z');
  const custom = resolveRange({ mode: 'custom', start: '2026-07-30T00:00', end: '2026-07-31T00:00', timezone: 'Asia/Singapore' });
  assert.equal(custom.fromMs, periods.today.fromMs);
  assert.equal(custom.toMs, periods.today.toMs);

  const dstDay = resolveRange({ mode: 'today', timezone: 'America/New_York', nowMs: Date.parse('2026-03-08T16:00:00.000Z') });
  assert.equal(new Date(dstDay.fromMs).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(dstDay.toMs).toISOString(), '2026-03-09T04:00:00.000Z');
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
    assert.equal(parsed.reconciliation.covered, 0);
    assert.equal(parsed.reconciliation.mixedSource, 1);
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

test('Zstandard frame guard accepts chunked and concatenated frames but rejects every truncated boundary', async () => {
  const frames = [zstdCompressSync('test'), zstdCompressSync('checksummed', { params: { [(await import('node:zlib')).constants.ZSTD_c_checksumFlag]: 1 } })];
  // A valid single-segment frame with one RLE block.
  frames.push(Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0x20, 3, 27, 0, 0, 65]));
  const skip = Buffer.from([0x50, 0x2A, 0x4D, 0x18, 2, 0, 0, 0, 65, 66]);
  const combined = Buffer.concat([frames[0], skip, ...frames.slice(1)]);
  const verify = (chunks) => pipeline(Readable.from(chunks), createZstdFrameGuard(), async (stream) => { for await (const chunk of stream) assert.ok(chunk.length); });
  await verify([...combined].map((byte) => Buffer.from([byte])));
  for (const frame of [...frames, skip]) for (let size = 0; size < frame.length; size += 1) await assert.rejects(verify([frame.subarray(0, size)]), { code: 'INVALID_ZSTD_FRAME' });
  await assert.rejects(verify([Buffer.concat([frames[0], frames[1].subarray(0, -1)])]), { code: 'INVALID_ZSTD_FRAME' });
});

test('compressed Codex history uses event dates, deduplicates decoded copies and retains snapshots on decode failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-token-dashboard-zstd-'));
  const index = createSessionIndex({ sessionsDirectory: root, maxFiles: 10, parseConcurrency: 2, pricing: PRICING });
  const cache = createSummaryCache(() => index.prepareRefresh());
  try {
    const body = [
      { type: 'session_meta', payload: { id: 'compressed-history', model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/history' } },
      ...[['2026-09-02T00:00:00Z', 7], ['2026-10-02T00:00:00Z', 20]].map(([timestamp, input_tokens]) => ({ type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens, output_tokens: 0 } } } })),
    ].map(JSON.stringify).join('\n') + '\n';
    const compressed = zstdCompressSync(body);
    const file = path.join(root, 'history.jsonl.zst');
    await writeFile(file, compressed);
    const parsed = await parseSessionFile(file, 'history.jsonl.zst');
    await writeFile(path.join(root, 'copy.jsonl'), body);
    const plain = await parseSessionFile(path.join(root, 'copy.jsonl'), 'copy.jsonl');
    assert.equal(parsed.contentHash, plain.contentHash);
    assert.deepEqual(parsed.usage, plain.usage);
    const first = await cache.refresh();
    assert.equal(first.summary.scannedFileCount, 2);
    assert.equal(first.summary.totals.totalTokens, 20);
    const month = (summary, period) => buildDashboardPayload(summary, { range: resolveRange({ mode: 'month', period, timezone: 'Asia/Taipei' }), nowMs: Date.parse('2026-10-14T12:00Z'), q: '', sort: 'recent', offset: 0, limit: 100, filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } }, first.summary.scan);
    assert.equal(month(first.summary, '2026-09').totals.totalTokens, 7);
    assert.equal(month(first.summary, '2026-10').totals.totalTokens, 13);
    assert.equal((await cache.refresh()).summary.scan.reused, 2);
    for (const invalid of [Buffer.from('invalid zstd'), compressed.subarray(0, compressed.length - 1)]) {
      await writeFile(file, invalid);
      await assert.rejects(cache.refresh(), { code: 'SESSION_REFRESH_FAILED', reason: 'file-parse' });
      const retained = await cache.get();
      assert.equal(retained.summary.totals.totalTokens, 20);
      assert.equal(month(retained.summary, '2026-09').totals.totalTokens, 7);
      assert.equal(retained.metadata.retainedSnapshot, true);
    }
    await writeFile(file, compressed);
    await rm(path.join(root, 'copy.jsonl'));
    const restored = await cache.refresh();
    assert.equal(restored.summary.totals.totalTokens, 20);
    assert.equal(cache.status().retainedSnapshot, false);
    assert.deepEqual(await readdir(root), ['history.jsonl.zst']);
  } finally {
    await cache.close(); await index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session parser deduplicates responses and separates cache durations without exposing content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-ai-dashboard-claude-parser-'));
  try {
    const relativePath = 'workspace/session-id/subagents/agent-example.jsonl';
    const file = path.join(root, 'agent-example.jsonl');
    const shared = { type: 'assistant', sessionId: 'session-id', cwd: 'C:/private/workspace', version: '2.1.0', entrypoint: 'cli', timestamp: '2026-08-18T10:00:00Z' };
    await writeFile(file, [
      JSON.stringify({ ...shared, message: { id: 'message-1', model: 'claude-opus-5', content: 'must-not-leak', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 70, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40 }, output_tokens_details: { thinking_tokens: 1 }, inference_geo: 'global', speed: 'standard', service_tier: 'standard' } } }),
      JSON.stringify({ ...shared, timestamp: '2026-08-18T10:00:01Z', message: { id: 'message-1', model: 'claude-opus-5', content: 'final-secret', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40 }, output_tokens_details: { thinking_tokens: 2 }, inference_geo: 'global', speed: 'standard', service_tier: 'standard', server_tool_use: { web_search_requests: 3 } } } }),
    ].join('\n'));

    const session = await parseClaudeSessionFile(file, relativePath);

    assert.equal(session.reconciliation.duplicate, 1);
    assert.equal(session.usageEvents.length, 1);
    assert.deepEqual(session.usage, { inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 70, cacheWrite5mTokens: 30, cacheWrite1hTokens: 40, uncachedInputTokens: 10, outputTokens: 5, reasoningOutputTokens: 2, totalTokens: 105 });
    assert.equal(session.executionType, 'subagent');
    assert.equal(session.agentId, 'agent-example');
    assert.ok(session.parentSessionKey);
    assert.equal(session.usageEvents[0].serverToolUse.web_search_requests, 3);
    assert.doesNotMatch(JSON.stringify(session), /must-not-leak|final-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const claudePricingMarkdown = `# Pricing

| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Opus 4.8 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Opus 4.7 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Opus 4.6 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Sonnet 5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok |
| Claude Sonnet 4.6 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |
| Claude Sonnet 4.5 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |
| Claude Haiku 4.5 | $1 / MTok | $1.25 / MTok | $2 / MTok | $0.10 / MTok | $5 / MTok |
`;

test('Claude pricing parser and cost calculator preserve cache duration and explicit modifiers', () => {
  const rates = parseClaudePricingMarkdown(claudePricingMarkdown);
  assert.deepEqual(rates['claude-sonnet-5'], { input: 2, cachedInput: 0.2, cacheWrite: null, cacheWrite5m: 2.5, cacheWrite1h: 4, output: 10 });
  const baseUsage = { inputTokens: 1_000_000, uncachedInputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 1_000_000 };
  const explicit = calculateCost(CLAUDE_PRICING, [{ model: 'claude-opus-5', timestamp: '2026-08-18T00:00:00Z', usage: baseUsage, pricingModifiers: { inferenceGeo: 'us', speed: 'fast', serviceTier: 'standard' } }]);
  assert.equal(explicit.total, 11);
  assert.equal(explicit.unknownModifiers.size, 0);
  const unknown = calculateCost(CLAUDE_PRICING, [{ model: 'claude-opus-5', timestamp: '2026-08-18T00:00:00Z', usage: baseUsage, pricingModifiers: { inferenceGeo: 'not_available', speed: 'standard', serviceTier: 'standard' } }]);
  assert.equal(unknown.total, 5);
  assert.equal(unknown.available, true);
  assert.equal(unknown.unavailableReason, null);
  assert.equal(unknown.unpricedTokens, 0);
  assert.deepEqual([...unknown.unknownModifiers], ['claude-opus-5:legacy geography/speed surcharge not reported; base-rate lower bound']);
});
