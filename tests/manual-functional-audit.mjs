import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionIndex, parseSessionFile } from '../server/session-index.mjs';
import { parseClaudeSessionFile } from '../server/claude-session.mjs';
import { createPricing } from '../server/pricing.mjs';
import { buildDashboardPayload, buildExport, buildSessionDetail, buildSessionsPayload } from '../server/dashboard-data.mjs';
import { bucketFor, resolveRange } from '../server/timezone.mjs';
import { normalizeCodexUsage, normalizeClaudeUsage, createAccountUsageService } from '../server/account-usage.mjs';
import { createProviderRegistry } from '../server/provider-registry.mjs';
import { createSummaryCache } from '../server/summary-cache.mjs';
import { saveSettings } from '../server/settings.mjs';
import { createRequestChannels } from '../public/scripts/request-channels.mjs';
import { zeroUsage, sessionKey } from '../server/usage.mjs';
import { budgetState } from '../public/scripts/state.mjs';

// Audit probes report current behavior. They are not regression expectations.
// All files and credentials are synthetic; all service requests use fake fetch.
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-functional-audit-'));
const reports = [];
const pricing = createPricing({ updatedAt: '2020-01-01', currency: 'USD', unitTokens: 1_000_000, source: 'TEST ONLY', rates: { 'model-a': { input: 1, cachedInput: 0.1, output: 2 }, 'model-b': { input: 2, cachedInput: 0.2, output: 3 } } });
const at = '2026-09-15T12:00:00.000Z';
const filters = { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] };
const request = { range: { mode: 'all', fromMs: null, toMs: null, timezone: 'UTC', interval: '[from,to)' }, q: '', sort: 'recent', offset: 0, limit: 200, filters };
const tokens = (input, output = 0) => ({ ...zeroUsage(), inputTokens: input, uncachedInputTokens: input, outputTokens: output, totalTokens: input + output });
const event = (model, input = 1, extra = {}) => ({ timestamp: at, model, source: 'turn', sequence: 1, usage: tokens(input), ...extra });
const session = (id, events = [event('model-a')]) => ({ provider: 'codex', sessionId: id, sessionKey: sessionKey('codex', `${id}.jsonl`), file: `${id}.jsonl`, model: 'model-a', cwd: '/TEST_ONLY/workspace', firstTimestamp: at, lastTimestamp: at, modifiedAt: at, usageEvents: events, invalidLineCount: 0, reconciliation: { ambiguous: 0 }, usageSource: 'turn' });
const summary = (sessions, selectedPricing = pricing) => ({ provider: 'codex', generatedAt: at, pricing: selectedPricing, sessions, errors: [] });
const report = (id, title, observation) => reports.push({ id, title, ...observation });
async function fixture(name, lines) { const target = path.join(root, name); await writeFile(target, lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n'); return target; }

try {
  const week = resolveRange({ mode: 'week', period: '2026-W01', timezone: 'UTC', nowMs: Date.parse('2026-09-15T12:00:00Z') });
  report('FA01', 'Selected ISO week', { selected: '2026-W01', expectedStart: '2025-12-29T00:00:00.000Z', actualStart: new Date(week.fromMs).toISOString() });

  const invalidDate = resolveRange({ mode: 'custom', start: '2026-02-31T00:00', end: '2026-03-05T00:00', timezone: 'UTC' });
  report('FA02', 'Invalid civil date', { input: '2026-02-31T00:00', expected: 'INVALID_RANGE', actualStart: new Date(invalidDate.fromMs).toISOString() });

  const firstFold = bucketFor(Date.parse('2026-11-01T05:30:00Z'), 'hour', 'America/New_York');
  const secondFold = bucketFor(Date.parse('2026-11-01T06:30:00Z'), 'hour', 'America/New_York');
  report('FA03', 'Repeated DST hour', { expectedDistinct: true, actualDistinct: firstFold !== secondFold, first: new Date(firstFold).toISOString(), second: new Date(secondFold).toISOString() });

  const claudePath = await fixture('claude.jsonl', [{ type: 'assistant', sessionId: 'test', timestamp: at, message: { id: 'response', model: 'model-a', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 70, output_tokens: 5 } } }]);
  const claude = await parseClaudeSessionFile(claudePath, 'workspace/claude.jsonl');
  report('FA04', 'Generic Claude cache writes', { reportedCacheWrite: 70, actualCacheWrite: claude.usage.cacheWriteTokens, expectedTotal: 105, actualTotal: claude.usage.totalTokens });

  const mixed = summary([session('mixed', [event('model-a', 2), event('model-b', 5, { sequence: 2 })])]);
  const mixedDashboard = buildDashboardPayload(mixed, request, {});
  const modelB = buildDashboardPayload(mixed, { ...request, filters: { ...filters, models: ['model-b'] } }, {});
  report('FA05', 'Mixed-model session attribution', { events: [{ model: 'model-a', tokens: 2 }, { model: 'model-b', tokens: 5 }], actualRanking: mixedDashboard.models, actualFacets: mixedDashboard.facets.models, modelBMatched: modelB.matchedSessionCount });

  const modifierPricing = createPricing({ ...pricing, modifiers: { usGeoMultiplier: 1.1, usGeoPattern: '^model-a', fastMultiplier: 6, fastPattern: '^model-a' } });
  const modifierDashboard = buildDashboardPayload(summary([session('modifier')], modifierPricing), request, {});
  report('FA06', 'Partial cost parity', { aggregatePartial: modifierDashboard.cost.pricingCoverage.partial, modelPartial: modifierDashboard.models[0].partialCost, trendPartial: modifierDashboard.trend.points[0].partialCost, unknownModifiers: modifierDashboard.cost.unknownModifiers });

  const manySessions = summary(Array.from({ length: 251 }, (_, i) => session(`session-${i}`)));
  const manyDashboard = buildDashboardPayload(manySessions, request, {});
  const csv = buildExport('csv-sessions', manyDashboard);
  const offsetDashboard = buildDashboardPayload(manySessions, { ...request, offset: 200 }, {});
  report('FA07', 'Session export pagination', { matched: manyDashboard.matchedSessionCount, csvDataRows: csv.body.split('\r\n').length - 1, csvDataRowsWithOffset200: buildExport('csv-sessions', offsetDashboard).body.split('\r\n').length - 1 });

  try {
    const large = session('large', Array.from({ length: 150_000 }, () => event('model-a')));
    const largeDashboard = buildDashboardPayload(summary([large]), request, {});
    report('FA08', 'Large all-time projection', { observations: 150_000, actual: 'completed', total: largeDashboard.totals.totalTokens });
  } catch (error) { report('FA08', 'Large all-time projection', { observations: 150_000, actual: error.name, message: error.message }); }

  const indexRoot = path.join(root, 'index'); await mkdir(indexRoot);
  const indexedPath = path.join(indexRoot, 'session.jsonl');
  const indexLines = [{ type: 'session_meta', payload: { id: 'test-index', model: 'model-a' }, timestamp: at }, { type: 'turn.completed', timestamp: at, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } }];
  await writeFile(indexedPath, indexLines.map(JSON.stringify).join('\n') + '\n');
  const index = createSessionIndex({ sessionsDirectory: indexRoot, maxFiles: 10, parseConcurrency: 1, pricing });
  const before = await index.refresh();
  await writeFile(indexedPath, 'null\n');
  const failed = await index.refresh();
  const repeated = await index.refresh();
  report('FA09', 'Changed-file parse failure', { beforeTotal: before.totals.totalTokens, refreshedTotal: failed.totals.totalTokens, failedFiles: failed.scan.failed, afterRetryTotal: repeated.totals.totalTokens, lastGoodFileRetained: failed.sessions.length > 0, exactLimitMarkedTruncated: before.truncated });

  const reconciliationPath = await fixture('mixed-sources.jsonl', [
    { type: 'session_meta', timestamp: at, payload: { id: 'test-mixed', model: 'model-a' } },
    { type: 'event_msg', timestamp: at, payload: { type: 'token_count', model: 'model-a', info: { total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } },
    { type: 'turn.completed', timestamp: '2026-09-15T13:00:00Z', model: 'model-b', usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } },
  ]);
  const reconciled = await parseSessionFile(reconciliationPath, 'mixed-sources.jsonl');
  report('FA10', 'Mixed-source coverage decision', { inputObservations: ['model-a cumulative 110', 'later model-b turn 6'], actualTotal: reconciled.usage.totalTokens, acceptedModels: reconciled.usageEvents.map((item) => item.model), covered: reconciled.reconciliation.covered, policyNeedsDecision: true });

  const capIndex = createSessionIndex({ sessionsDirectory: indexRoot, maxFiles: 1, parseConcurrency: 1, pricing });
  await writeFile(indexedPath, indexLines.map(JSON.stringify).join('\n') + '\n');
  const exactCap = await capIndex.refresh();
  report('FA11', 'Exact file cap', { existingFiles: 1, maxFiles: 1, actualTruncated: exactCap.truncated });
  const capPayload = buildDashboardPayload(exactCap, request, exactCap.scan);
  report('FA19', 'File cap warning propagation', { indexTruncated: exactCap.truncated, dashboardHasTruncated: Object.hasOwn(capPayload, 'truncated'), qualityHasTruncated: Object.hasOwn(capPayload.quality.scan, 'truncated'), dashboardMaxFiles: capPayload.maxFiles ?? null });

  const codexNull = normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: null, reset_at: null, limit_window_seconds: 18_000 } } }, at);
  const claudeNull = normalizeClaudeUsage({ five_hour: { utilization: null, resets_at: null } }, at);
  report('FA12', 'Null quota fields', { codexRemaining: codexNull.windows[0].remainingPercent, codexReset: codexNull.windows[0].resetsAt, claudeRemaining: claudeNull.windows[0].remainingPercent, expected: 'unknown or unsupported' });

  let clock = Date.parse(at); let calls = 0;
  const auth = await fixture('auth.json', [{ tokens: { access_token: 'TEST_ONLY', account_id: 'TEST_ONLY' } }]);
  const account = createAccountUsageService({ codexAuthPath: auth, now: () => clock, fetchImpl: async () => { calls += 1; return calls === 1 ? new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 25, reset_at: 1_800_000_000, limit_window_seconds: 18_000 } } }), { headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }); } });
  const initialQuota = await account.get('codex'); clock += 61_000;
  const failedQuota = await account.get('codex');
  const cachedFailure = await account.get('codex');
  report('FA13', 'Quota failure after success', { initialStatus: initialQuota.status, failedStatus: failedQuota.status, retainedWindows: failedQuota.windows.length, nextStatus: cachedFailure.status, calls, policyNeedsDecision: true });

  const missingRoot = path.join(root, 'later-directory');
  const registry = createProviderRegistry({ config: { codexSessionsDirectory: missingRoot, claudeSessionsDirectory: missingRoot, maxFiles: 10, parseConcurrency: 1, autoRefresh: true, autoRefreshDebounceMs: 100 }, pricingServices: { codex: { current: () => pricing }, claude: { current: () => pricing } } });
  try {
    await registry.startWatchers(); await mkdir(missingRoot);
    const provider = registry.get('codex');
    report('FA14', 'Watcher recovery after directory appears', { availability: (await provider.availability()).available, watcher: provider.watcher() });
  } finally { registry.close(); }

  let rejectOlder; let fetchCount = 0;
  const channels = createRequestChannels(async () => { fetchCount += 1; if (fetchCount === 1) return new Promise((_, reject) => { rejectOlder = reject; }); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
  const older = channels.request('audit', '/TEST_ONLY/old').catch((error) => ({ thrown: error.name, message: error.message }));
  await channels.request('audit', '/TEST_ONLY/new'); rejectOlder(new Error('TEST ONLY old request failure'));
  report('FA15', 'Superseded failed request', { actualOlder: await older, expected: 'stale or abort signal handling at caller', policyNeedsCallerReview: true }); channels.destroy();

  const settings = { HOST: '127.0.0.1', PORT: '3333', CODEX_SESSIONS_DIR: '/TEST_ONLY/sessions', CLAUDE_SESSIONS_DIR: '/TEST_ONLY/claude', MAX_FILES: '10000', PARSE_CONCURRENCY: '4', ALLOW_REMOTE: '0', EXPOSE_FULL_PATHS: '0', AUTO_REFRESH: '0', AUTO_REFRESH_DEBOUNCE_MS: '1500', UPDATE_REPOSITORY: '' };
  const envPath = path.join(root, '.env'); await writeFile(envPath, '# TEST ONLY\nUNRELATED=keep\nPORT=3333\n');
  await saveSettings(envPath, settings);
  let rejected = false; try { await saveSettings(envPath, { ...settings, PORT: '70000' }); } catch { rejected = true; }
  report('CHECK01', 'Isolated settings persistence', { unrelatedRetained: (await readFile(envPath, 'utf8')).includes('UNRELATED=keep'), invalidRejected: rejected, validPortRetained: (await readFile(envPath, 'utf8')).includes('PORT=3333') });

  let failCache = false;
  const cache = createSummaryCache(async () => { if (failCache) throw new Error('TEST ONLY'); return summary([session('cached')]); });
  await cache.get(); failCache = true; try { await cache.refresh(); } catch {}
  report('CHECK02', 'Whole refresh failure retains snapshot', { version: cache.status().snapshotVersion, retainedSessionCount: (await cache.get()).summary.sessions.length, refreshing: cache.status().refreshing });

  const detail = buildSessionDetail(summary([session('bounded', Array.from({ length: 2_001 }, () => event('model-a')))]), request, sessionKey('codex', 'bounded.jsonl'));
  report('CHECK03', 'Detail observation bound', { returned: detail.observations.length, limit: detail.observationLimit, totalTokens: detail.usage.totalTokens, explicitTruncatedFlag: detail.observationsTruncated ?? null });

  const oldProjection = buildDashboardPayload(summary([session('snapshot', [event('model-a', 1)])]), request, { snapshotVersion: 1 });
  const newPage = buildSessionsPayload(summary([session('snapshot', [event('model-a', 2)])]), request, { snapshotVersion: 2 });
  const mergedProjection = { ...oldProjection, ...newPage };
  report('FA16', 'Client page merge across snapshot versions', { evidence: 'Replay of dashboard load sessionsOnly merge with real builders', snapshotVersion: mergedProjection.scan.snapshotVersion, kpiTokens: mergedProjection.totals.totalTokens, trendTokens: mergedProjection.trend.points[0].tokens, modelTokens: mergedProjection.models[0].tokens, sessionTokens: mergedProjection.sessions[0].usage.totalTokens });

  const markdown = buildExport('markdown-summary', { ...oldProjection, range: { ...oldProjection.range, mode: 'custom', fromMs: 1788624000000, toMs: 1789401600000 } });
  report('FA17', 'Markdown exact interval provenance', { suppliedBounds: [1788624000000, 1789401600000], includesStart: markdown.body.includes('1788624000000'), includesEnd: markdown.body.includes('1789401600000'), body: markdown.body });

  const duplicatePath = await fixture('same-id.jsonl', [{ type: 'session_meta', payload: { id: 'same-id', model: 'model-a' }, timestamp: at }, { type: 'turn.completed', timestamp: at, usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 } }]);
  const duplicateOne = await parseSessionFile(duplicatePath, 'one.jsonl');
  const duplicateTwo = await parseSessionFile(duplicatePath, 'copy.jsonl');
  const duplicateDashboard = buildDashboardPayload(summary([duplicateOne, duplicateTwo]), request, {});
  report('FA18', 'Duplicate session identity across files', { sameSessionId: duplicateOne.sessionId === duplicateTwo.sessionId, distinctKeys: duplicateOne.sessionKey !== duplicateTwo.sessionKey, actualTotal: duplicateDashboard.totals.totalTokens, policyNeedsDecision: true });

  const unchanged = await index.refresh();
  const reused = await index.refresh();
  report('CHECK04', 'Incremental file reuse', { firstTotal: unchanged.totals.totalTokens, nextTotal: reused.totals.totalTokens, reused: reused.scan.reused, changed: reused.scan.changed, added: reused.scan.added });

  const savedNow = Date.now;
  let concurrent;
  try {
    Date.now = () => 1789473600000;
    concurrent = await Promise.allSettled([saveSettings(envPath, { ...settings, PORT: '3334' }), saveSettings(envPath, { ...settings, PORT: '3335' })]);
  } finally { Date.now = savedNow; }
  const envAfterConcurrent = await readFile(envPath, 'utf8');
  report('FA20', 'Concurrent settings saves at same millisecond', { injection: 'Frozen Date.now in this isolated probe only', results: concurrent.map((item) => item.status === 'fulfilled' ? { status: item.status, returnedPort: item.value.PORT } : { status: item.status, code: item.reason?.code }), actualPort: /^PORT=(.*)$/m.exec(envAfterConcurrent)?.[1] });
  report('FA22', 'Partial cost budget classification', { evidence: 'Replay of renderBudgets known-cost input', knownLowerBound: 10, limit: 100, partial: true, actual: budgetState({ limit: 100 }, 10), policyNeedsDecision: true });
  process.stdout.write(`${JSON.stringify({ audit: 'TEST ONLY offline functional probes', reports }, null, 2)}\n`);
} finally { await rm(root, { recursive: true, force: true }); }
