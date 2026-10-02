import { zonedDateTimeValue } from './format.mjs';

export const VIEW_PREFERENCES_KEY = 'codex-token-dashboard:view-preferences:v2';
export const PROVIDER_PREFERENCE_KEY = 'codex-token-dashboard:provider:v1';

const RANGE_MODES = new Set(['all', 'last24h', 'today', 'week', 'month', 'year', 'custom']);
const SORT_MODES = new Set(['recent', 'cost', 'total', 'input', 'cache', 'output']);
const CHART_MODES = new Set(['single', 'stacked', 'dual']);
const CHART_MARKS = new Set(['bar', 'line']);
const UNITS = new Set(['auto', 'exact', 'K', 'M', 'B']);
export const FILTER_KEYS = Object.freeze(['models', 'workspaces', 'pricingStatus', 'usageSource', 'cliVersion', 'originator', 'quality', 'executionType']);
const PROVIDERS = new Set(['codex', 'claude']);
const DENSITY_LIMITS = Object.freeze({ comfortable: 100, compact: 150, dense: 200 });
const VIEW_COLUMN_KEYS = Object.freeze(['lastUsed', 'model', 'input', 'output', 'cost']);

function stringList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
}

export function normalizeFilters(filters = {}) {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, stringList(filters[key])]));
}

function safeTimezone(value, fallback = 'UTC') {
  const timezone = String(value || '').trim();
  try {
    if (timezone) Intl.DateTimeFormat('en', { timeZone: timezone });
    return timezone || fallback;
  } catch {
    return fallback;
  }
}

export function normalizeMonthValue(value) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{1,2})$/.exec(text);
  return match && Number(match[1]) > 0 && Number(match[2]) >= 1 && Number(match[2]) <= 12
    ? `${match[1]}-${match[2].padStart(2, '0')}` : text;
}

function densityValue(value, fallback = 'comfortable') { return Object.hasOwn(DENSITY_LIMITS, value) ? value : fallback; }

function columnDatasetKey(key) { return `column${key[0].toUpperCase()}${key.slice(1)}`; }

export function densityPageLimit(value) { return DENSITY_LIMITS[densityValue(value)]; }

export function applyTableViewPreferences(target, view) {
  const density = densityValue(view?.density);
  target.dataset.tableDensity = density;
  for (const key of VIEW_COLUMN_KEYS) target.dataset[columnDatasetKey(key)] = String(view?.visibleColumns?.[key] !== false);
  return densityPageLimit(density);
}

export function createDashboardState() {
  return {
    provider: 'codex',
    source: { data: null, status: 'loading', error: '', projectionStale: false },
    query: { rangeMode: 'month', weekValue: '', monthValue: '', yearValue: '', customStart: '', customEnd: '', search: '', sort: 'recent', timezone: 'UTC', filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, []])) },
    view: { unit: 'auto', showExact: true, showDetails: true, trendMetric: 'cost', trendMode: 'single', trendMark: 'bar', locale: 'zh-Hant', density: 'comfortable', visibleColumns: Object.fromEntries(VIEW_COLUMN_KEYS.map((key) => [key, true])), budgets: [], budgetsByProvider: { codex: [], claude: [] } },
    page: { offset: 0, limit: 100 },
    drawer: { sessionKey: null, trigger: null, detail: null, status: 'idle', error: '' },
  };
}

export function validIntervalBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 2 && bounds.every((value) => Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000) && bounds[0] < bounds[1];
}

export function customRangeError(query) {
  if (query.rangeMode !== 'custom' || validIntervalBounds(query.intervalBounds)) return '';
  const localTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
  if (![query.customStart, query.customEnd].every((value) => localTime.test(value || ''))) return 'range.invalidDate';
  // Compare civil values only. The server resolves the selected timezone and DST.
  const start = Date.parse(`${query.customStart}Z`); const end = Date.parse(`${query.customEnd}Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || [query.customStart, query.customEnd].some((value) => new Date(Date.parse(`${value}Z`)).toISOString().slice(0, value.length) !== value || Number(value.slice(0, 4)) < 1)) return 'range.invalidDate';
  return start >= end ? 'range.endBeforeStart' : '';
}

export function readQueryState(controls, filters = {}, previous = null) {
  const query = {
    rangeMode: controls.rangeMode.value,
    weekValue: controls.weekInput.value,
    monthValue: normalizeMonthValue(controls.monthInput.value),
    yearValue: controls.yearInput.value,
    customStart: controls.customStart.value,
    customEnd: controls.customEnd.value,
    search: controls.search.value.trim().slice(0, 256),
    sort: SORT_MODES.has(controls.sort.value) ? controls.sort.value : 'recent',
    timezone: safeTimezone(controls.timezone.value, controls.timezone.dataset.fallback || 'UTC'),
    filters: normalizeFilters(filters),
  };
  // datetime-local removes zero seconds. Keep exact server bounds until a civil field changes.
  const civil = (value) => String(value || '').replace(/(T\d{2}:\d{2}):00$/, '$1');
  if (previous && query.rangeMode === 'custom' && query.timezone === previous.timezone && ['customStart', 'customEnd'].every((key) => civil(query[key]) === civil(previous[key])) && validIntervalBounds(previous.intervalBounds)) query.intervalBounds = previous.intervalBounds;
  return query;
}

export function readViewState(controls) {
  return {
    unit: UNITS.has(controls.unit.value) ? controls.unit.value : 'auto', showExact: controls.showExact.checked, showDetails: controls.showDetails.checked,
    trendMetric: controls.trendMetric.value === 'tokens' ? 'tokens' : 'cost', trendMode: CHART_MODES.has(controls.trendMode?.value) ? controls.trendMode.value : 'single', trendMark: CHART_MARKS.has(controls.trendMark?.value) ? controls.trendMark.value : 'bar', locale: controls.locale?.value || 'zh-Hant', density: densityValue(controls.density.value),
    visibleColumns: { lastUsed: controls.columnLastUsed.checked, model: controls.columnModel.checked, input: controls.columnInput.checked, output: controls.columnOutput.checked, cost: controls.columnCost.checked },
  };
}

export function queryStateFromSearch(defaults, search) {
  const params = new URLSearchParams(search);
  const rangeMode = params.get('range');
  const sort = params.get('sort');
  const bounds = [params.get('from'), params.get('to')];
  const intervalBounds = rangeMode === 'custom' && bounds.every((value) => /^-?\d+$/.test(value || '')) && validIntervalBounds(bounds.map(Number)) ? bounds.map(Number) : null;
  const timezone = safeTimezone(params.get('timezone'), defaults.timezone);
  return {
    ...defaults, intervalBounds,
    rangeMode: RANGE_MODES.has(rangeMode) ? rangeMode : defaults.rangeMode,
    weekValue: params.get('week') ?? defaults.weekValue, monthValue: normalizeMonthValue(params.get('month') ?? defaults.monthValue), yearValue: params.get('year') ?? defaults.yearValue,
    customStart: intervalBounds ? zonedDateTimeValue(intervalBounds[0], timezone) : params.get('start') ?? defaults.customStart, customEnd: intervalBounds ? zonedDateTimeValue(intervalBounds[1], timezone) : params.get('end') ?? defaults.customEnd,
    search: (params.get('q') ?? defaults.search).trim().slice(0, 256), sort: SORT_MODES.has(sort) ? sort : defaults.sort,
    timezone,
    filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, stringList(params.getAll(key))])),
  };
}

export function providerFromSearch(search, saved = 'codex') {
  const value = new URLSearchParams(search).get('provider');
  return PROVIDERS.has(value) ? value : PROVIDERS.has(saved) ? saved : 'codex';
}

export function readProviderPreference(storage) {
  try { const value = storage.getItem(PROVIDER_PREFERENCE_KEY); return PROVIDERS.has(value) ? value : 'codex'; } catch { return 'codex'; }
}

export function saveProviderPreference(storage, provider) {
  if (!PROVIDERS.has(provider)) return false;
  try { storage.setItem(PROVIDER_PREFERENCE_KEY, provider); return true; } catch { return false; }
}

export function queryStateToSearch(query, provider = 'codex') {
  const params = new URLSearchParams();
  if (provider !== 'codex') params.set('provider', provider);
  const values = [['range', query.rangeMode], ['week', query.weekValue], ['month', normalizeMonthValue(query.monthValue)], ['year', query.yearValue], ['start', query.customStart], ['end', query.customEnd], ['q', query.search], ['sort', query.sort], ['timezone', query.timezone]];
  for (const [name, value] of values) if (value && !(name === 'sort' && value === 'recent')) params.set(name, value);
  if (query.rangeMode === 'custom' && validIntervalBounds(query.intervalBounds)) { params.set('from', String(query.intervalBounds[0])); params.set('to', String(query.intervalBounds[1])); }
  for (const key of FILTER_KEYS) for (const value of stringList(query.filters?.[key])) params.append(key, value);
  return params.toString();
}

export function applyQueryStateToControls(controls, query) {
  controls.rangeMode.value = query.rangeMode; controls.weekInput.value = query.weekValue; controls.monthInput.value = normalizeMonthValue(query.monthValue); controls.yearInput.value = query.yearValue;
  controls.customStart.value = query.customStart; controls.customEnd.value = query.customEnd; controls.search.value = query.search; controls.sort.value = query.sort; controls.timezone.value = query.timezone;
}

export function requestParameters(query, page = {}, provider = 'codex') {
  const params = new URLSearchParams({ provider, mode: query.rangeMode, timezone: query.timezone, q: query.search, sort: query.sort, offset: String(page.offset || 0), limit: String(page.limit || 100) });
  const period = query.rangeMode === 'week' ? query.weekValue : query.rangeMode === 'month' ? normalizeMonthValue(query.monthValue) : query.rangeMode === 'year' ? query.yearValue : '';
  if (period) params.set('period', period);
  if (query.rangeMode === 'custom' && !validIntervalBounds(query.intervalBounds)) for (const [name, value] of [['start', query.customStart], ['end', query.customEnd]]) if (value) params.set(name, value);
  if (query.rangeMode === 'custom' && validIntervalBounds(query.intervalBounds)) { params.set('from', String(query.intervalBounds[0])); params.set('to', String(query.intervalBounds[1])); }
  for (const key of FILTER_KEYS) for (const value of stringList(query.filters?.[key])) params.append(key, value);
  return params;
}

export function readViewPreferences(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(VIEW_PREFERENCES_KEY) || '{}'); const columns = parsed.visibleColumns && typeof parsed.visibleColumns === 'object' ? parsed.visibleColumns : {};
    const legacy = Array.isArray(parsed.budgets) ? parsed.budgets.slice(0, 50) : []; const source = parsed.budgetsByProvider && typeof parsed.budgetsByProvider === 'object' ? parsed.budgetsByProvider : {};
    const budgetsByProvider = { codex: Array.isArray(source.codex) ? source.codex.slice(0, 50) : legacy, claude: Array.isArray(source.claude) ? source.claude.slice(0, 50) : [] };
    return { unit: UNITS.has(parsed.unit) ? parsed.unit : null, showExact: typeof parsed.showExact === 'boolean' ? parsed.showExact : null, showDetails: typeof parsed.showDetails === 'boolean' ? parsed.showDetails : null, trendMetric: ['cost', 'tokens'].includes(parsed.trendMetric) ? parsed.trendMetric : null, trendMode: CHART_MODES.has(parsed.trendMode) ? parsed.trendMode : 'single', trendMark: CHART_MARKS.has(parsed.trendMark) ? parsed.trendMark : 'bar', locale: ['en', 'zh-Hant'].includes(parsed.locale) ? parsed.locale : null, density: Object.hasOwn(DENSITY_LIMITS, parsed.density) ? parsed.density : null, visibleColumns: Object.fromEntries(VIEW_COLUMN_KEYS.filter((key) => typeof columns[key] === 'boolean').map((key) => [key, columns[key]])), budgets: budgetsByProvider.codex, budgetsByProvider };
  } catch { return { unit: null, showExact: null, showDetails: null, trendMetric: null, trendMode: 'single', trendMark: 'bar', locale: null, density: null, visibleColumns: {}, budgets: [], budgetsByProvider: { codex: [], claude: [] } }; }
}

export function applyViewPreferencesToControls(controls, preferences) {
  if (preferences.unit) controls.unit.value = preferences.unit; if (preferences.showExact != null) controls.showExact.checked = preferences.showExact; if (preferences.showDetails != null) controls.showDetails.checked = preferences.showDetails;
  if (controls.trendMode) controls.trendMode.value = preferences.trendMode || 'single'; if (controls.trendMark) controls.trendMark.value = preferences.trendMark || 'bar';
  if (preferences.trendMetric) controls.trendMetric.value = preferences.trendMetric; if (preferences.locale) controls.locale.value = preferences.locale; if (preferences.density) controls.density.value = preferences.density;
  for (const key of VIEW_COLUMN_KEYS) if (preferences.visibleColumns[key] != null) controls[columnDatasetKey(key)].checked = preferences.visibleColumns[key];
}

export function saveViewPreferences(storage, view) {
  try { storage.setItem(VIEW_PREFERENCES_KEY, JSON.stringify({ unit: view.unit, showExact: view.showExact, showDetails: view.showDetails, trendMetric: view.trendMetric, trendMode: view.trendMode || 'single', trendMark: view.trendMark || 'bar', locale: view.locale, density: view.density, visibleColumns: view.visibleColumns, budgetsByProvider: view.budgetsByProvider || { codex: view.budgets || [], claude: [] } })); return true; } catch { return false; }
}

export function budgetState(budget, aggregate) {
  const limit = Number(budget?.limit); const actual = Number(aggregate?.value ?? aggregate ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return { actual, limit: null, ratio: null, status: 'disabled' };
  const ratio = actual / limit;
  return { actual, limit, ratio, status: ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : 'ok' };
}
