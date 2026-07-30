export const VIEW_PREFERENCES_KEY = 'codex-token-dashboard:view-preferences:v2';

const RANGE_MODES = new Set(['all', 'last24h', 'today', 'week', 'month', 'year', 'custom']);
const SORT_MODES = new Set(['recent', 'cost', 'total', 'input', 'cache', 'output']);
const UNITS = new Set(['auto', 'exact', 'K', 'M', 'B']);
const FILTER_KEYS = Object.freeze(['models', 'workspaces', 'pricingStatus', 'usageSource', 'cliVersion', 'originator', 'quality']);
const DENSITY_LIMITS = Object.freeze({ comfortable: 100, compact: 150, dense: 200 });
const VIEW_COLUMN_KEYS = Object.freeze(['lastUsed', 'model', 'input', 'output', 'cost']);

function stringList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
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
    source: { data: null, status: 'loading', error: '', projectionStale: false },
    query: { rangeMode: 'month', weekValue: '', monthValue: '', yearValue: '', customStart: '', customEnd: '', search: '', sort: 'recent', timezone: 'UTC', filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, []])) },
    view: { unit: 'auto', showExact: true, showDetails: true, trendMetric: 'cost', locale: 'zh-Hant', density: 'comfortable', visibleColumns: Object.fromEntries(VIEW_COLUMN_KEYS.map((key) => [key, true])), budgets: [] },
    page: { offset: 0, limit: 100 },
    drawer: { sessionKey: null, trigger: null, detail: null, status: 'idle', error: '' },
  };
}

export function readQueryState(controls) {
  return {
    rangeMode: controls.rangeMode.value,
    weekValue: controls.weekInput.value,
    monthValue: controls.monthInput.value,
    yearValue: controls.yearInput.value,
    customStart: controls.customStart.value,
    customEnd: controls.customEnd.value,
    search: controls.search.value.trim().slice(0, 256),
    sort: SORT_MODES.has(controls.sort.value) ? controls.sort.value : 'recent',
    timezone: safeTimezone(controls.timezone.value, controls.timezone.dataset.fallback || 'UTC'),
    filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, stringList([...controls[`filter${key[0].toUpperCase()}${key.slice(1)}`].selectedOptions].map((option) => option.value))])),
  };
}

export function readViewState(controls) {
  return {
    unit: UNITS.has(controls.unit.value) ? controls.unit.value : 'auto', showExact: controls.showExact.checked, showDetails: controls.showDetails.checked,
    trendMetric: controls.trendMetric.value === 'tokens' ? 'tokens' : 'cost', locale: controls.locale?.value || 'zh-Hant', density: densityValue(controls.density.value),
    visibleColumns: { lastUsed: controls.columnLastUsed.checked, model: controls.columnModel.checked, input: controls.columnInput.checked, output: controls.columnOutput.checked, cost: controls.columnCost.checked },
  };
}

export function queryStateFromSearch(defaults, search) {
  const params = new URLSearchParams(search);
  const rangeMode = params.get('range');
  const sort = params.get('sort');
  return {
    ...defaults,
    rangeMode: RANGE_MODES.has(rangeMode) ? rangeMode : defaults.rangeMode,
    weekValue: params.get('week') ?? defaults.weekValue, monthValue: params.get('month') ?? defaults.monthValue, yearValue: params.get('year') ?? defaults.yearValue,
    customStart: params.get('start') ?? defaults.customStart, customEnd: params.get('end') ?? defaults.customEnd,
    search: (params.get('q') ?? defaults.search).trim().slice(0, 256), sort: SORT_MODES.has(sort) ? sort : defaults.sort,
    timezone: safeTimezone(params.get('timezone'), defaults.timezone),
    filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, stringList(params.getAll(key))])),
  };
}

export function queryStateToSearch(query) {
  const params = new URLSearchParams();
  const values = [['range', query.rangeMode], ['week', query.weekValue], ['month', query.monthValue], ['year', query.yearValue], ['start', query.customStart], ['end', query.customEnd], ['q', query.search], ['sort', query.sort], ['timezone', query.timezone]];
  for (const [name, value] of values) if (value && !(name === 'sort' && value === 'recent')) params.set(name, value);
  for (const key of FILTER_KEYS) for (const value of stringList(query.filters?.[key])) params.append(key, value);
  return params.toString();
}

export function applyQueryStateToControls(controls, query) {
  controls.rangeMode.value = query.rangeMode; controls.weekInput.value = query.weekValue; controls.monthInput.value = query.monthValue; controls.yearInput.value = query.yearValue;
  controls.customStart.value = query.customStart; controls.customEnd.value = query.customEnd; controls.search.value = query.search; controls.sort.value = query.sort; controls.timezone.value = query.timezone;
  for (const key of FILTER_KEYS) {
    const selected = new Set(query.filters?.[key] || []);
    for (const value of selected) {
      if (![...controls[`filter${key[0].toUpperCase()}${key.slice(1)}`].options].some((option) => option.value === value)) {
        controls[`filter${key[0].toUpperCase()}${key.slice(1)}`].append(new Option(value, value, true, true));
      }
    }
    for (const option of controls[`filter${key[0].toUpperCase()}${key.slice(1)}`].options) option.selected = selected.has(option.value);
  }
}

export function requestParameters(query, page = {}) {
  const params = new URLSearchParams({ mode: query.rangeMode, timezone: query.timezone, q: query.search, sort: query.sort, offset: String(page.offset || 0), limit: String(page.limit || 100) });
  const period = query.rangeMode === 'week' ? query.weekValue : query.rangeMode === 'month' ? query.monthValue : query.rangeMode === 'year' ? query.yearValue : '';
  if (period) params.set('period', period);
  if (query.rangeMode === 'custom') for (const [name, value] of [['start', query.customStart], ['end', query.customEnd]]) if (value) params.set(name, value);
  for (const key of FILTER_KEYS) for (const value of stringList(query.filters?.[key])) params.append(key, value);
  return params;
}

export function setFacetOptions(select, values, selected) {
  const active = new Set(selected || []);
  const items = Array.isArray(values) ? values : [];
  const normalised = items.map((item) => typeof item === 'string' ? { value: item, label: item } : { value: String(item.value ?? item.key ?? ''), label: String(item.label ?? item.value ?? item.key ?? ''), count: item.count }).filter((item) => item.value);
  select.replaceChildren(...normalised.map((item) => {
    const option = document.createElement('option'); option.value = item.value; option.textContent = item.count == null ? item.label : `${item.label} (${item.count})`; option.selected = active.has(item.value); return option;
  }));
}

export function readViewPreferences(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(VIEW_PREFERENCES_KEY) || '{}'); const columns = parsed.visibleColumns && typeof parsed.visibleColumns === 'object' ? parsed.visibleColumns : {};
    return { unit: UNITS.has(parsed.unit) ? parsed.unit : null, showExact: typeof parsed.showExact === 'boolean' ? parsed.showExact : null, showDetails: typeof parsed.showDetails === 'boolean' ? parsed.showDetails : null, trendMetric: ['cost', 'tokens'].includes(parsed.trendMetric) ? parsed.trendMetric : null, locale: ['en', 'zh-Hant'].includes(parsed.locale) ? parsed.locale : null, density: Object.hasOwn(DENSITY_LIMITS, parsed.density) ? parsed.density : null, visibleColumns: Object.fromEntries(VIEW_COLUMN_KEYS.filter((key) => typeof columns[key] === 'boolean').map((key) => [key, columns[key]])), budgets: Array.isArray(parsed.budgets) ? parsed.budgets.slice(0, 50) : [] };
  } catch { return { unit: null, showExact: null, showDetails: null, trendMetric: null, locale: null, density: null, visibleColumns: {}, budgets: [] }; }
}

export function applyViewPreferencesToControls(controls, preferences) {
  if (preferences.unit) controls.unit.value = preferences.unit; if (preferences.showExact != null) controls.showExact.checked = preferences.showExact; if (preferences.showDetails != null) controls.showDetails.checked = preferences.showDetails;
  if (preferences.trendMetric) controls.trendMetric.value = preferences.trendMetric; if (preferences.locale) controls.locale.value = preferences.locale; if (preferences.density) controls.density.value = preferences.density;
  for (const key of VIEW_COLUMN_KEYS) if (preferences.visibleColumns[key] != null) controls[columnDatasetKey(key)].checked = preferences.visibleColumns[key];
}

export function saveViewPreferences(storage, view) {
  try { storage.setItem(VIEW_PREFERENCES_KEY, JSON.stringify({ unit: view.unit, showExact: view.showExact, showDetails: view.showDetails, trendMetric: view.trendMetric, locale: view.locale, density: view.density, visibleColumns: view.visibleColumns, budgets: view.budgets })); return true; } catch { return false; }
}

export function budgetState(budget, aggregate) {
  const limit = Number(budget?.limit); const actual = Number(aggregate?.value ?? aggregate ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return { actual, limit: null, ratio: null, status: 'disabled' };
  const ratio = actual / limit;
  return { actual, limit, ratio, status: ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : 'ok' };
}
