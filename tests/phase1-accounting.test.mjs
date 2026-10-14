import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSessionIndex, parseSessionFile } from '../server/session-index.mjs';
import { parseClaudeSessionFile } from '../server/claude-session.mjs';
import { CLAUDE_PRICING, PRICING } from '../server/pricing.mjs';
import { buildDashboardPayload, buildExport, buildSessionDetail, buildSessionsPayload, calculateCost } from '../server/dashboard-data.mjs';
import { budgetState } from '../public/scripts/state.mjs';
import { renderExplorerRows } from '../public/scripts/explorer.mjs';
import { renderSessionDrawer } from '../public/scripts/drawer.mjs';
import { usageWarnings } from '../public/scripts/accounting-status.mjs';

const at = '2026-09-15T12:00:00Z';
const meta = (id = 'fixture') => ({ type: 'session_meta', timestamp: at, payload: { id, model: 'gpt-5.6-terra', cwd: '/TEST_ONLY/workspace' } });
const cumulative = (input, output = 0, options = {}) => ({ type: 'event_msg', timestamp: at, ...options, payload: { type: 'token_count', model: options.model || 'gpt-5.6-terra', info: { total_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } } } });
const turn = (input, model = 'gpt-5.6-terra', options = {}) => ({ type: 'turn.completed', timestamp: at, model, usage: { input_tokens: input, output_tokens: 0, total_tokens: input }, ...options });
const assistant = (output, options = {}, rawUsage = {}) => ({ type: 'assistant', sessionId: 'claude-fixture', timestamp: at, ...options, message: { id: 'response', model: 'claude-opus-5', content: 'TEST_ONLY_PRIVATE_CONTENT', usage: { input_tokens: 10, output_tokens: output, inference_geo: 'global', speed: 'standard', service_tier: 'standard', ...rawUsage } } });
const request = { range: { mode: 'all', fromMs: null, toMs: null, timezone: 'UTC' }, q: '', offset: 0, limit: 200, sort: 'recent', filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } };
async function fixture(t, provider = 'codex') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-accounting-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, events) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, events.map(JSON.stringify).join('\n') + '\n'); return file; };
  const index = createSessionIndex({ provider, sessionsDirectory: root, maxFiles: 100, parseConcurrency: 2, pricing: provider === 'claude' ? CLAUDE_PRICING : PRICING });
  return { root, write, index };
}

test('generic Claude cache writes preserve tokens and price only confirmed duration', async (t) => {
  const f = await fixture(t, 'claude');
  const file = await f.write('one.jsonl', [assistant(5, {}, { cache_read_input_tokens: 20, cache_creation_input_tokens: 70 })]);
  const parsed = await parseClaudeSessionFile(file, 'one.jsonl');
  assert.equal(parsed.usage.totalTokens, 105);
  assert.equal(parsed.usage.cacheWriteTokens, 70);
  const dashboard = buildDashboardPayload(await f.index.refresh(), request, {});
  assert.equal(dashboard.cost.pricingCoverage.unpricedTokens, 70);
  assert.equal(dashboard.cost.pricingCoverage.pricedTokens, 35);
  assert.equal(dashboard.cost.total, (10 * 5 + 20 * 0.5 + 5 * 25) / 1_000_000);
  assert.equal(dashboard.trend.partialCost, true);
  assert.equal(dashboard.models[0].partialCost, true);
  assert.equal(budgetState({ scope: 'cost', limit: 100 }, { value: dashboard.cost.total }).status, 'ok');
  const drawer = renderSessionDrawer({ detail: buildSessionDetail(await f.index.refresh(), request, dashboard.sessions[0].sessionKey), status: 'ready', showDetails: true, timezone: 'UTC' });
  assert.match(drawer, /70/);
  assert.doesNotMatch(JSON.stringify(dashboard), /TEST_ONLY_PRIVATE_CONTENT|contentHash|usageObservations|identity/);
});

test('partial and inconsistent Claude duration breakdowns do not discard or double-charge writes', async (t) => {
  const f = await fixture(t, 'claude');
  for (const [total, five, hour, expectedKnown] of [[70, 30, 0, 30], [70, 30, 40, 70], [50, 30, 40, 0]]) {
    const file = await f.write('one.jsonl', [assistant(5, {}, { cache_creation_input_tokens: total, cache_creation: { ephemeral_5m_input_tokens: five, ephemeral_1h_input_tokens: hour } })]);
    const parsed = await parseClaudeSessionFile(file, 'one.jsonl');
    assert.equal(parsed.usage.totalTokens, 15 + total);
    const cost = calculateCost(CLAUDE_PRICING, parsed.usageEvents);
    assert.equal(cost.unpricedTokens, total - expectedKnown);
    assert.equal(cost.pricedTokens + cost.unpricedTokens, cost.billableTokens);
    assert.equal(parsed.reconciliation.cacheWriteInconsistent, total === five + hour ? 0 : 1);
  }
  const file = await f.write('malformed-duration.jsonl', [assistant(5, {}, { cache_read_input_tokens: 20, cache_creation_input_tokens: 70, cache_creation: { ephemeral_5m_input_tokens: -30, ephemeral_1h_input_tokens: 40 }, server_tool_use: null })]);
  const parsed = await parseClaudeSessionFile(file, 'malformed-duration.jsonl');
  assert.equal(parsed.usage.totalTokens, 105);
  assert.equal(parsed.usage.cacheWrite1hTokens, 0);
  assert.equal(calculateCost(CLAUDE_PRICING, parsed.usageEvents).unpricedTokens, 70);
});

test('legacy missing Claude surcharges retain a lower bound across all projections', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(5, {}, { inference_geo: 'not_available', speed: undefined })]);
  const summary = await f.index.refresh(); const dashboard = buildDashboardPayload(summary, request, {});
  assert.equal(dashboard.cost.total, 0.000175);
  assert.equal(dashboard.cost.pricingCoverage.partial, true);
  assert.equal(dashboard.models[0].cost, dashboard.cost.total);
  assert.equal(dashboard.trend.points[0].cost, dashboard.cost.total);
  assert.equal(dashboard.trend.points[0].partialCost, true);
  assert.equal(buildSessionDetail(summary, request, dashboard.sessions[0].sessionKey).cost.total, dashboard.cost.total);
  assert.match(buildExport('markdown-summary', dashboard).body, /Partial pricing: true/);
});

test('unknown pricing modifiers remain unpriced in aggregate, models, trend and exports', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(5, {}, { inference_geo: 'unknown' })]);
  const dashboard = buildDashboardPayload(await f.index.refresh(), request, {});
  assert.equal(dashboard.cost.total, null);
  assert.equal(dashboard.cost.unavailableReason, 'unpriced-usage');
  assert.equal(dashboard.models[0].cost, null);
  assert.equal(dashboard.trend.points[0].cost, null);
  assert.equal(dashboard.cost.unpricedTokens, 15);
  assert.equal(dashboard.cost.pricingCoverage.partial, true);
  assert.equal(dashboard.models[0].partialCost, true);
  assert.equal(dashboard.trend.points[0].partialCost, true);
  assert.match(buildExport('csv-trend', dashboard).body, /"true"/);
  assert.match(buildExport('markdown-summary', dashboard).body, /Partial pricing: true/);
});

test('model projection agrees across KPI, facets, ranking, page, detail, search and export', async (t) => {
  const f = await fixture(t);
  await f.write('mixed.jsonl', [meta(), turn(2), turn(5, 'gpt-5.5', { timestamp: '2026-09-15T12:00:01Z' })]);
  const summary = await f.index.refresh();
  const all = buildDashboardPayload(summary, request, {});
  assert.deepEqual(all.models.map(({ model, tokens }) => [model, tokens]), [['gpt-5.5', 5], ['gpt-5.6-terra', 2]]);
  const selected = { ...request, filters: { ...request.filters, models: ['gpt-5.5'] } };
  const dashboard = buildDashboardPayload(summary, selected, {});
  assert.equal(dashboard.totals.totalTokens, 5);
  assert.equal(dashboard.trend.points.reduce((sum, point) => sum + point.tokens, 0), 5);
  assert.equal(dashboard.sessions[0].usage.totalTokens, 5);
  assert.equal(dashboard.sessions[0].model, 'gpt-5.6-terra');
  assert.deepEqual(dashboard.sessions[0].models, ['gpt-5.5']);
  assert.deepEqual(dashboard.facets.models, ['gpt-5.5', 'gpt-5.6-terra']);
  assert.equal(buildSessionsPayload(summary, selected, {}).totals.totalTokens, 5);
  const detail = buildSessionDetail(summary, selected, dashboard.sessions[0].sessionKey);
  assert.equal(detail.observations.length, 1);
  assert.equal(detail.observations[0].model, 'gpt-5.5');
  assert.equal(buildDashboardPayload(summary, { ...request, q: 'gpt-5.5' }, {}).matchedSessionCount, 1);
  assert.match(buildExport('csv-sessions', dashboard).body, /"5",/);
  const html = renderExplorerRows(dashboard.sessions, { unit: 'exact', timezone: 'UTC' });
  assert.match(html, />gpt-5.5</);
  assert.doesNotMatch(html, />gpt-5.6-terra</);
});

test('cumulative priority is per model and never infers coverage from numeric size', async (t) => {
  const f = await fixture(t);
  const file = await f.write('mixed.jsonl', [meta(), cumulative(100, 10), turn(6, 'gpt-5.5'), turn(2)]);
  const session = await parseSessionFile(file, 'mixed.jsonl');
  assert.equal(session.usage.totalTokens, 116);
  assert.equal(session.reconciliation.covered, 0);
  assert.equal(session.reconciliation.mixedSource, 1);
  assert.equal(session.usageEvents[1].model, 'gpt-5.5');
  const dashboard = buildDashboardPayload(await f.index.refresh(), request, {});
  assert.equal(dashboard.quality.range.usage.incomplete, true);
  assert.equal(usageWarnings(dashboard.quality.range.reconciliation).length, 1);
});

test('partial counter decrease skips one increment and advances the baseline', async (t) => {
  const f = await fixture(t);
  const file = await f.write('reset.jsonl', [meta(), cumulative(100, 10), cumulative(100, 5), cumulative(110, 8)]);
  const session = await parseSessionFile(file, 'reset.jsonl');
  assert.equal(session.usage.totalTokens, 123);
  assert.equal(session.usage.inputTokens, 110);
  assert.equal(session.reconciliation.partialReset, 1);
  assert.equal(session.reconciliation.fullReset, 0);
  assert.equal(session.usageEvents[1].usage.totalTokens, 13);
});

test('verified full counter restart and repeated counters remain distinct', async (t) => {
  const f = await fixture(t);
  const file = await f.write('reset.jsonl', [meta(), cumulative(100, 10), cumulative(100, 10), cumulative(2, 1)]);
  const session = await parseSessionFile(file, 'reset.jsonl');
  assert.equal(session.usage.totalTokens, 113);
  assert.equal(session.reconciliation.duplicate, 1);
  assert.equal(session.reconciliation.fullReset, 1);
  const inputOnly = await f.write('input-only.jsonl', [meta(), cumulative(100), cumulative(80), cumulative(90)]);
  const uncertain = await parseSessionFile(inputOnly, 'input-only.jsonl');
  assert.equal(uncertain.usage.totalTokens, 110);
  assert.equal(uncertain.reconciliation.partialReset, 1);
});

test('byte-identical copies deduplicate without event IDs and retain a stable owner', async (t) => {
  const f = await fixture(t);
  const events = [meta(), cumulative(100)];
  await f.write('original.jsonl', events);
  const initial = await f.index.refresh();
  const key = initial.sessions[0].sessionKey;
  await f.write('a-copy.jsonl', events);
  const copied = await f.index.refresh();
  assert.equal(copied.totals.totalTokens, 100);
  assert.equal(copied.sessions.length, 1);
  assert.equal(copied.sessions[0].sessionKey, key);
  assert.equal(copied.sessions[0].reconciliation.duplicateFiles, 1);
});

test('shared explicit identities reconcile copied and appended raw cumulative states before deltas', async (t) => {
  const f = await fixture(t);
  const events = [meta(), cumulative(100, 0, { id: 'first' })];
  await f.write('original.jsonl', events);
  const initial = await f.index.refresh();
  await f.write('copy.jsonl', [...events, cumulative(120, 0, { id: 'second', timestamp: '2026-09-15T12:00:01Z' })]);
  const appended = await f.index.refresh();
  assert.equal(appended.totals.totalTokens, 120);
  assert.equal(appended.sessions.length, 1);
  assert.equal(appended.sessions[0].sessionKey, initial.sessions[0].sessionKey);
  assert.deepEqual(appended.sessions[0].usageEvents.map((event) => event.usage.totalTokens), [100, 20]);
});

test('same Session ID alone preserves independent files with a possible-duplicate warning', async (t) => {
  const f = await fixture(t);
  await f.write('one.jsonl', [meta(), turn(10)]);
  await f.write('two.jsonl', [meta(), turn(10, 'gpt-5.6-terra', { timestamp: '2026-09-15T12:00:01Z' })]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 20);
  assert.equal(summary.sessions.length, 2);
  const dashboard = buildDashboardPayload(summary, request, {});
  assert.equal(dashboard.quality.range.usage.possibleDuplicate, true);
  assert.equal(dashboard.quality.range.usage.incomplete, false);
});

test('a copied file with an unproven appended observation is retained and marked possible duplicate', async (t) => {
  const f = await fixture(t);
  const first = [meta(), cumulative(100)];
  await f.write('one.jsonl', first);
  await f.write('two.jsonl', [...first, cumulative(120, 0, { timestamp: '2026-09-15T12:00:01Z' })]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 220);
  assert.equal(summary.sessions.length, 2);
  assert.equal(summary.sessions.every((session) => session.reconciliation.possibleDuplicate > 0), true);
});

test('cumulative source priority applies across a shared execution scope without claiming deduplication', async (t) => {
  const f = await fixture(t);
  await f.write('one.jsonl', [meta(), cumulative(100)]);
  await f.write('two.jsonl', [meta(), turn(10), turn(6, 'gpt-5.5')]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 106);
  assert.equal(summary.sessions.length, 2);
  assert.equal(summary.sessions.reduce((sum, session) => sum + session.reconciliation.mixedSource, 0), 1);
  assert.equal(summary.sessions.every((session) => session.reconciliation.covered === 0), true);
});

test('shared identity and same-file sequence order appended cumulative states without timestamps', async (t) => {
  const f = await fixture(t);
  const first = [meta(), cumulative(100, 0, { id: 'first', timestamp: undefined })];
  await f.write('one.jsonl', first);
  await f.write('two.jsonl', [...first, cumulative(120, 0, { id: 'second', timestamp: undefined })]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 120);
  assert.equal(summary.sessions[0].reconciliation.incomplete, 0);
});

test('unorderable cumulative branches keep the canonical chain and flag incomplete usage', async (t) => {
  const f = await fixture(t);
  const first = [meta(), cumulative(100, 0, { id: 'first', timestamp: undefined })];
  await f.write('one.jsonl', [...first, cumulative(110, 0, { id: 'left', timestamp: undefined })]);
  await f.write('two.jsonl', [...first, cumulative(120, 0, { id: 'right', timestamp: undefined })]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 110);
  assert.equal(summary.sessions.length, 1);
  assert.equal(summary.sessions[0].reconciliation.incomplete, 1);
});

test('turn IDs group updates but only explicit usage-event IDs deduplicate them', async (t) => {
  const f = await fixture(t);
  const file = await f.write('one.jsonl', [meta(), turn(2, undefined, { id: 'turn-context', turn_id: 'same-turn' }), turn(5, undefined, { id: 'turn-context', turn_id: 'same-turn' })]);
  assert.equal((await parseSessionFile(file, 'one.jsonl')).usage.totalTokens, 7);
  await f.write('one.jsonl', [meta(), turn(2, undefined, { event_id: 'usage-update' }), turn(5, undefined, { event_id: 'usage-update' })]);
  assert.equal((await parseSessionFile(file, 'one.jsonl')).usage.totalTokens, 5);
});

test('latest reliable cross-file response version replaces earlier usage without summing versions', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(2)]);
  await f.write('two.jsonl', [assistant(5, { timestamp: '2026-09-15T12:00:01Z' })]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 15);
  assert.equal(summary.sessions.length, 1);
  assert.equal(summary.sessions[0].reconciliation.conflict, 0);
});

test('same-file sequence resolves tied response versions and invalid updates cannot replace valid usage', async (t) => {
  const f = await fixture(t, 'claude');
  const file = await f.write('one.jsonl', [assistant(2), assistant(5), assistant(-1)]);
  const session = await parseClaudeSessionFile(file, 'one.jsonl');
  assert.equal(session.usage.outputTokens, 5);
  assert.equal(session.reconciliation.invalidUsage, 1);
});

test('unordered cross-file versions remain unresolved without a previously confirmed version', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(2)]);
  await f.write('two.jsonl', [assistant(5)]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 0);
  assert.equal(summary.sessions[0].reconciliation.conflict, 1);
  const dashboard = buildDashboardPayload(summary, request, {});
  assert.equal(dashboard.quality.range.usage.incomplete, true);
  assert.equal(dashboard.sessions.length, 1);
});

test('unordered or invalid cross-file updates retain the previously confirmed version across refreshes', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(2)]);
  const initial = await f.index.refresh();
  await f.write('two.jsonl', [assistant(5)]);
  const conflict = await f.index.refresh();
  assert.equal(conflict.totals.totalTokens, initial.totals.totalTokens);
  assert.equal((await f.index.refresh()).totals.totalTokens, 12);
  await f.write('two.jsonl', [assistant(5, { timestamp: '2026-09-15T12:00:02Z' })]);
  assert.equal((await f.index.refresh()).totals.totalTokens, 15);
  await f.write('two.jsonl', [assistant(-1, { timestamp: '2026-09-15T12:00:03Z' })]);
  await rm(path.join(f.root, 'one.jsonl'));
  const invalid = await f.index.refresh();
  assert.equal(invalid.totals.totalTokens, 15);
  assert.equal(invalid.sessions[0].reconciliation.invalidUsage, 1);
});

test('estimated cross-file timestamps cannot order conflicting response versions', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(2, { timestamp: undefined })]);
  await f.write('two.jsonl', [assistant(5, { timestamp: undefined })]);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 0);
  assert.equal(summary.sessions[0].reconciliation.conflict, 1);
});

test('identical response usage uses the latest reliable timestamp for range attribution', async (t) => {
  const f = await fixture(t, 'claude');
  await f.write('one.jsonl', [assistant(5)]);
  await f.write('two.jsonl', [assistant(5, { timestamp: '2026-09-15T12:00:01Z' })]);
  const summary = await f.index.refresh();
  assert.equal(summary.sessions[0].usageEvents[0].timestamp, '2026-09-15T12:00:01.000Z');
  const range = { ...request.range, fromMs: Date.parse('2026-09-15T12:00:01Z'), toMs: Date.parse('2026-09-15T12:00:02Z') };
  assert.equal(buildDashboardPayload(summary, { ...request, range }, {}).totals.totalTokens, 15);
});

test('Claude responses without message identity keep usage and warn about possible duplication', async (t) => {
  const f = await fixture(t, 'claude');
  const events = [assistant(2), assistant(5)];
  for (const event of events) delete event.message.id;
  await f.write('one.jsonl', events);
  const summary = await f.index.refresh();
  assert.equal(summary.totals.totalTokens, 27);
  assert.equal(summary.sessions[0].reconciliation.possibleDuplicate, 1);
});

test('main and distinct agents remain separate deduplication scopes', async (t) => {
  const f = await fixture(t, 'claude');
  const events = [assistant(5)];
  await f.write('workspace/parent.jsonl', events);
  await f.write('workspace/parent/subagents/agent-one.jsonl', events);
  await f.write('workspace/parent/subagents/agent-two.jsonl', events);
  const summary = await f.index.refresh();
  assert.equal(summary.sessions.length, 3);
  assert.equal(summary.totals.totalTokens, 45);
  assert.deepEqual(summary.sessions.map((session) => session.executionType).sort(), ['main', 'subagent', 'subagent']);
  assert.equal(summary.sessions.every((session) => session.reconciliation.possibleDuplicate === 0), true);
});
