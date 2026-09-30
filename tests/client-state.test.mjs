import assert from 'node:assert/strict';
import test from 'node:test';

import { redactPath, renderSessionDrawer } from '../public/scripts/drawer.mjs';
import { renderExplorerRows } from '../public/scripts/explorer.mjs';
import { createFilterDraft, facetItems } from '../public/scripts/filters.mjs';
import { formatCost, formatDate } from '../public/scripts/format.mjs';
import { detectLocale, setLocale, t } from '../public/scripts/i18n.mjs';
import { createProjectionCache } from '../public/scripts/projection-cache.mjs';
import { projectionLoadState } from '../public/scripts/projection-state.mjs';
import { createRequestChannels } from '../public/scripts/request-channels.mjs';
import { applyTableViewPreferences, budgetState, createDashboardState, customRangeError, densityPageLimit, providerFromSearch, queryStateFromSearch, queryStateToSearch, readProviderPreference, readViewPreferences, requestParameters, saveProviderPreference, saveViewPreferences } from '../public/scripts/state.mjs';
import { nearestPointIndex, pointPositions } from '../public/scripts/trend.mjs';
import { countdownParts, formatCountdown, windowLabelKey } from '../public/scripts/account-usage.mjs';

test('filter drafts apply explicitly and chip removal preserves unrelated edits', () => {
  const filters = createFilterDraft({ models: ['native'], workspaces: ['old'] });
  filters.select('models', 'new', true);
  filters.select('quality', 'invalid', true);
  assert.deepEqual(filters.snapshot().applied.models, ['native']);
  assert.equal(filters.snapshot().dirty, true);
  const removed = filters.remove('models', 'native');
  assert.deepEqual(removed.applied.models, []);
  assert.deepEqual(removed.draft.models, ['new']);
  const cleared = filters.clear();
  assert.deepEqual(cleared.draft.workspaces, []);
  assert.deepEqual(cleared.draft.quality, ['invalid']);
  assert.equal(Object.values(cleared.applied).flat().length, 0);
  const applied = filters.apply();
  assert.deepEqual(applied.applied.models, ['new']);
  assert.equal(applied.dirty, false);
  filters.select('models', 'another', true);
  assert.deepEqual(filters.discard().draft.models, ['new']);
});

test('external query restoration resets provider drafts and retains absent facet values', () => {
  const filters = createFilterDraft({ models: ['codex'] });
  filters.select('workspaces', 'unsaved', true);
  const reset = filters.reset({ models: ['claude'], quality: ['invalid', 'invalid'] });
  assert.deepEqual(reset.draft.models, ['claude']);
  assert.deepEqual(reset.draft.workspaces, []);
  assert.deepEqual(reset.applied.quality, ['invalid']);
  assert.equal(reset.dirty, false);
  assert.deepEqual(facetItems([{ value: 'current', label: 'Current', count: 2 }], ['absent']), [
    { value: 'current', label: 'Current', count: 2 }, { value: 'absent', label: 'absent' },
  ]);
  const restored = queryStateFromSearch(createDashboardState().query, '?models=absent&quality=invalid');
  assert.match(queryStateToSearch(restored), /models=absent/);
  assert.match(requestParameters(restored).toString(), /quality=invalid/);
});

test('session rows provide one named action and scoped exact/detail content', () => {
  const session = { sessionKey: 'key', sessionId: 'session', workspace: '<workspace>', usage: { totalTokens: 12500, inputTokens: 12000, outputTokens: 500 } };
  const html = renderExplorerRows([session], { unit: 'auto', timezone: 'UTC' });
  assert.doesNotMatch(html, /tabindex=/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /aria-label=/);
  assert.match(html, /class="muted detail-col">&lt;workspace&gt;/);
  assert.match(html, /class="cell-exact">12,500/);
  assert.doesNotMatch(renderExplorerRows([session], { unit: 'exact', timezone: 'UTC' }), /cell-exact/);
});

test('account usage countdown and provider window labels remain deterministic', () => {
  const now = Date.parse('2026-08-24T00:00:00Z');
  assert.deepEqual(countdownParts('2026-08-25T02:03:04Z', now), { expired: false, days: 1, hours: 2, minutes: 3, seconds: 4 });
  assert.equal(formatCountdown('2026-08-24T02:03:04Z', (_key, values) => values ? `${values.days}d ${values.time}` : 'unknown', now), '02:03:04');
  assert.equal(formatCountdown(null, () => 'unknown', now), 'unknown');
  assert.equal(windowLabelKey({ kind: 'five-hour' }), 'accountUsage.window.fiveHour');
  assert.equal(windowLabelKey({ id: 'primary', windowSeconds: 604_800 }), 'accountUsage.window.weekly');
});

test('v2 query state preserves timezone and multi-select filters in the URL', () => {
  const defaults = createDashboardState().query;
  const query = queryStateFromSearch(defaults, '?range=custom&start=2026-07-01T00%3A00&end=2026-07-02T00%3A00&timezone=Asia%2FTaipei&models=gpt-5&models=gpt-5-mini&workspaces=repo&q=alpha&sort=total');

  assert.equal(query.timezone, 'Asia/Taipei');
  assert.deepEqual(query.filters.models, ['gpt-5', 'gpt-5-mini']);
  assert.equal(new URLSearchParams(queryStateToSearch(query)).getAll('models').length, 2);
  const params = requestParameters(query, { offset: 100, limit: 100 });
  assert.equal(params.get('timezone'), 'Asia/Taipei');
  assert.equal(params.get('q'), 'alpha');
  assert.equal(params.get('start'), '2026-07-01T00:00');
});

test('server receives selected periods and local custom values without client bucket boundaries', () => {
  const params = requestParameters({ rangeMode: 'month', monthValue: '2026-02', timezone: 'Asia/Taipei', search: '', sort: 'recent', filters: {} });
  assert.equal(params.get('period'), '2026-02');
  assert.equal(params.has('from'), false);
  const custom = requestParameters({ rangeMode: 'custom', customStart: '2026-02-01T09:00', customEnd: '2026-02-02T09:00', timezone: 'Asia/Taipei', search: '', sort: 'recent', filters: {} });
  assert.equal(custom.get('start'), '2026-02-01T09:00');
  assert.equal(custom.get('end'), '2026-02-02T09:00');
});

test('invalid timezone falls back to the supplied default without losing safe filters', () => {
  const defaults = { ...createDashboardState().query, timezone: 'UTC' };
  const query = queryStateFromSearch(defaults, '?timezone=not-a-timezone&models=%20alpha%20&models=alpha');

  assert.equal(query.timezone, 'UTC');
  assert.deepEqual(query.filters.models, ['alpha']);
});

test('budget thresholds only classify a server-provided aggregate', () => {
  assert.deepEqual(budgetState({ limit: 100 }, { value: 79 }), { actual: 79, limit: 100, ratio: 0.79, status: 'ok' });
  assert.equal(budgetState({ limit: 100 }, { value: 80 }).status, 'warning');
  assert.equal(budgetState({ limit: 100 }, { value: 100 }).status, 'exceeded');
  assert.equal(budgetState({ limit: 0 }, { value: 100 }).status, 'disabled');
});

test('view preferences retain local budgets but never put them in query state', () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const view = { unit: 'M', showExact: false, showDetails: true, trendMetric: 'tokens', locale: 'en', density: 'compact', visibleColumns: { lastUsed: false, model: true, input: false, output: true, cost: false }, budgets: [{ id: 'cost', scope: 'cost', limit: 10 }] };

  assert.equal(saveViewPreferences(storage, view), true);
  assert.deepEqual(readViewPreferences(storage).budgets, view.budgets);
  assert.equal(queryStateToSearch({ ...createDashboardState().query, filters: {} }).includes('budget'), false);
});

test('provider selection prefers a valid URL and persists only supported providers', () => {
  const values = new Map([['codex-token-dashboard:provider:v1', 'claude']]); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(providerFromSearch('?provider=codex', readProviderPreference(storage)), 'codex');
  assert.equal(providerFromSearch('', readProviderPreference(storage)), 'claude');
  assert.equal(saveProviderPreference(storage, 'unknown'), false);
  assert.equal(saveProviderPreference(storage, 'codex'), true);
});

test('legacy budgets migrate once to Codex while Claude budgets stay isolated', () => {
  const legacy = [{ id: 'legacy', scope: 'cost', limit: 5 }]; const values = new Map([['codex-token-dashboard:view-preferences:v2', JSON.stringify({ budgets: legacy })]]); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const migrated = readViewPreferences(storage);
  assert.deepEqual(migrated.budgetsByProvider, { codex: legacy, claude: [] });
  saveViewPreferences(storage, { ...migrated, budgetsByProvider: { codex: legacy, claude: [{ id: 'claude', scope: 'total-tokens', limit: 100 }] } });
  assert.equal(JSON.parse(values.get('codex-token-dashboard:view-preferences:v2')).budgets, undefined);
  assert.equal(readViewPreferences(storage).budgetsByProvider.claude.length, 1);
});

test('table preferences expose selected columns and make density change page capacity', () => {
  const target = { dataset: {} };
  const limit = applyTableViewPreferences(target, { density: 'dense', visibleColumns: { lastUsed: false, model: true, input: false, output: true, cost: false } });

  assert.equal(limit, 200);
  assert.equal(densityPageLimit('compact'), 150);
  assert.equal(densityPageLimit('unknown'), 100);
  assert.deepEqual(target.dataset, { tableDensity: 'dense', columnLastUsed: 'false', columnModel: 'true', columnInput: 'false', columnOutput: 'true', columnCost: 'false' });
});

test('same request channel marks an older completed response stale', async () => {
  const pending = [];
  const fetchImpl = () => new Promise((resolve) => pending.push(resolve));
  const channels = createRequestChannels(fetchImpl);
  const first = channels.request('dashboard', '/api/dashboard');
  const second = channels.request('dashboard', '/api/dashboard?next=1');
  const response = (value) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => value });

  pending[0](response({ version: 1 }));
  pending[1](response({ version: 2 }));
  assert.equal((await first).stale, true);
  assert.deepEqual((await second).payload, { version: 2 });
});

test('projection cache restores the last unfiltered dashboard projection without retaining every query', () => {
  const cache = createProjectionCache(2);
  const all = { sessions: [{ sessionKey: 'all' }] };
  cache.set('/api/dashboard?mode=all', all);
  cache.set('/api/dashboard?mode=all&models=model-a', { sessions: [{ sessionKey: 'filtered' }] });
  assert.equal(cache.get('/api/dashboard?mode=all'), all);
  cache.set('/api/dashboard?mode=all&workspaces=workspace-a', { sessions: [] });
  assert.equal(cache.get('/api/dashboard?mode=all&models=model-a'), null);
  cache.clear();
  assert.equal(cache.get('/api/dashboard?mode=all'), null);
});

test('a cache miss keeps prior dashboard data visibly stale while the replacement loads', () => {
  assert.deepEqual(projectionLoadState({ hasData: true, cached: null, refresh: false }), { status: 'loading', projectionStale: true });
  assert.deepEqual(projectionLoadState({ hasData: true, cached: { sessions: [] }, refresh: false }), { status: 'ready', projectionStale: false });
  assert.deepEqual(projectionLoadState({ hasData: true, cached: null, refresh: true }), { status: 'refreshing', projectionStale: false });
});

test('drawer redacts home directories before rendering', () => {
  assert.equal(redactPath('C:\\Users\\fixture\\secret-workspace'), '~/secret-workspace');
  assert.equal(redactPath('/Users/fixture/secret-workspace'), '~/secret-workspace');
});

test('i18n selects a saved language and resolves v2 messages', () => {
  const saved = new Map([['codex-token-dashboard:locale:v1', 'en']]);
  assert.equal(detectLocale({ getItem: (key) => saved.get(key) || null }, ['zh-TW']), 'en');
  setLocale('en'); assert.equal(t('v2.filter.clear'), 'Clear all filters');
  assert.equal(t('v2.projection.stale'), 'Updating the selected projection. The figures below are from the previous selection.');
  assert.equal(t('trend.detail.cost'), 'Estimated cost');
  setLocale('zh-Hant'); assert.equal(t('v2.timezone'), '時區');
  assert.equal(t('v2.budget.scopeTokens'), '總 Token');
  assert.equal(t('trend.detail.tokens'), '總 Token');
});

test('canvas trend selection remains pointer and keyboard safe at bounds', () => {
  const points = [0, 1, 2, 3].map((fromMs) => ({ fromMs }));
  assert.equal(nearestPointIndex(points, 16, 216), 0);
  assert.equal(nearestPointIndex(points, 116, 216), 2);
  assert.equal(nearestPointIndex(points, 999, 216), 3);
});

test('sparse trend geometry and pointer selection use actual elapsed time', () => {
  const points = [0, 1, 8].map((day) => ({ fromMs: day * 86_400_000 }));
  assert.deepEqual(pointPositions(points, 216), [16, 39, 200]);
  assert.equal(nearestPointIndex(points, 120, 216), 2);
  assert.equal(nearestPointIndex([], 120, 216), -1);
  assert.deepEqual(pointPositions([{ fromMs: 50 }], 216), [108]);
  const dst = ['2026-10-31T04:00:00Z', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'].map((time) => ({ fromMs: Date.parse(time) }));
  assert.deepEqual(pointPositions(dst, 1012), [16, 496, 996]);
});

test('session row and drawer dates follow the projection timezone in both languages', () => {
  const lastUsed = '2026-09-22T19:38:00Z';
  const detail = { sessionId: 'timezone-check', lastUsed, cost: { total: 0, partial: false } };
  setLocale('en');
  assert.equal(formatDate(lastUsed, 'America/New_York'), 'Sep 22, 2026, 3:38 PM');
  assert.equal(formatDate(lastUsed, 'Asia/Taipei'), 'Sep 23, 2026, 3:38 AM');
  const options = { timezone: 'America/New_York', unit: 'exact', status: 'ready' };
  assert.match(renderExplorerRows([detail], options), /Sep 22, 2026, 3:38 PM/);
  assert.match(renderSessionDrawer({ detail, ...options }), /Sep 22, 2026, 3:38 PM/);
  setLocale('zh-Hant');
  const date = formatDate(lastUsed, 'America/New_York');
  assert.ok(date.includes('22'));
  assert.ok(renderExplorerRows([detail], options).includes(date));
  assert.ok(renderSessionDrawer({ detail, ...options }).includes(date));
  assert.equal(formatDate('invalid', 'UTC'), '—');
});

test('cost labels distinguish unknown, zero and a partial lower bound', () => {
  setLocale('en');
  assert.equal(formatCost(null, true), '—');
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(2.903042, true), '≥ $2.903042');
  const detail = { sessionId: 'partial-check', cost: { total: 2.903042, partial: true } };
  assert.match(renderExplorerRows([detail], { unit: 'exact', timezone: 'UTC' }), /≥ \$2\.903042/);
  assert.match(renderSessionDrawer({ detail, status: 'ready', timezone: 'UTC' }), /≥ \$2\.903042/);
  setLocale('zh-Hant');
});

test('custom range validation names missing, reversed and equal civil times', () => {
  const query = { rangeMode: 'custom', customStart: '2026-09-23T00:00', customEnd: '2026-09-24T00:00' };
  assert.equal(customRangeError(query), '');
  assert.equal(customRangeError({ ...query, customEnd: '' }), 'range.invalidDate');
  assert.equal(customRangeError({ ...query, customEnd: '2026-09-22T00:00' }), 'range.endBeforeStart');
  assert.equal(customRangeError({ ...query, customEnd: '2026-09-23T00:00:00' }), 'range.endBeforeStart');
  assert.equal(customRangeError({ ...query, rangeMode: 'month', customEnd: '' }), '');
});
