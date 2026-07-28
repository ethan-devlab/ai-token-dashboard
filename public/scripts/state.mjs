import { addUsage, isoWeekStart, zeroUsage } from './format.mjs';

export const VIEW_PREFERENCES_KEY = 'codex-token-dashboard:view-preferences:v1';

const RANGE_MODES = new Set(['all', 'last24h', 'today', 'week', 'month', 'year', 'custom']);
const SORT_MODES = new Set(['recent', 'cost', 'total', 'input', 'cache', 'output']);
const UNITS = new Set(['auto', 'exact', 'K', 'M', 'B']);

export function createDashboardState() {
  return {
    source: { data: null, status: 'loading' },
    query: { rangeMode: 'month', weekValue: '', monthValue: '', yearValue: '', customStart: '', customEnd: '', search: '', sort: 'recent' },
    view: {
      unit: 'auto',
      showExact: true,
      showDetails: true,
      trendMetric: 'cost',
      density: 'comfortable',
      visibleColumns: { lastUsed: true, model: true, input: true, output: true, cost: true },
    },
    derived: { explorerSessions: [] },
    page: { offset: 0, limit: 100 },
    lastValidRange: null,
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
    search: controls.search.value.trim(),
    sort: controls.sort.value,
  };
}

export function readViewState(controls) {
  return {
    unit: controls.unit.value,
    showExact: controls.showExact.checked,
    showDetails: controls.showDetails.checked,
    trendMetric: controls.trendMetric.value,
    density: controls.density.value,
    visibleColumns: {
      lastUsed: controls.columnLastUsed.checked,
      model: controls.columnModel.checked,
      input: controls.columnInput.checked,
      output: controls.columnOutput.checked,
      cost: controls.columnCost.checked,
    },
  };
}

export function queryStateFromSearch(defaults, search) {
  const params = new URLSearchParams(search);
  const rangeMode = params.get('range');
  const sort = params.get('sort');
  return {
    ...defaults,
    rangeMode: RANGE_MODES.has(rangeMode) ? rangeMode : defaults.rangeMode,
    weekValue: params.get('week') ?? defaults.weekValue,
    monthValue: params.get('month') ?? defaults.monthValue,
    yearValue: params.get('year') ?? defaults.yearValue,
    customStart: params.get('start') ?? defaults.customStart,
    customEnd: params.get('end') ?? defaults.customEnd,
    search: (params.get('q') ?? defaults.search).trim(),
    sort: SORT_MODES.has(sort) ? sort : defaults.sort,
  };
}

export function queryStateToSearch(query) {
  const params = new URLSearchParams();
  const values = [
    ['range', query.rangeMode], ['week', query.weekValue], ['month', query.monthValue],
    ['year', query.yearValue], ['start', query.customStart], ['end', query.customEnd],
    ['q', query.search], ['sort', query.sort],
  ];
  for (const [name, value] of values) {
    if (value && !(name === 'sort' && value === 'recent')) params.set(name, value);
  }
  return params.toString();
}

export function applyQueryStateToControls(controls, query) {
  controls.rangeMode.value = query.rangeMode;
  controls.weekInput.value = query.weekValue;
  controls.monthInput.value = query.monthValue;
  controls.yearInput.value = query.yearValue;
  controls.customStart.value = query.customStart;
  controls.customEnd.value = query.customEnd;
  controls.search.value = query.search;
  controls.sort.value = query.sort;
}

export function readViewPreferences(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(VIEW_PREFERENCES_KEY) || '{}');
    const visibleColumns = parsed.visibleColumns && typeof parsed.visibleColumns === 'object'
      ? parsed.visibleColumns
      : {};
    return {
      unit: UNITS.has(parsed.unit) ? parsed.unit : null,
      showExact: typeof parsed.showExact === 'boolean' ? parsed.showExact : null,
      showDetails: typeof parsed.showDetails === 'boolean' ? parsed.showDetails : null,
      trendMetric: ['cost', 'tokens'].includes(parsed.trendMetric) ? parsed.trendMetric : null,
      density: ['comfortable', 'compact'].includes(parsed.density) ? parsed.density : null,
      visibleColumns: Object.fromEntries(
        ['lastUsed', 'model', 'input', 'output', 'cost']
          .filter((key) => typeof visibleColumns[key] === 'boolean')
          .map((key) => [key, visibleColumns[key]])
      ),
    };
  } catch {
    return { unit: null, showExact: null, showDetails: null, trendMetric: null, density: null, visibleColumns: {} };
  }
}

export function applyViewPreferencesToControls(controls, preferences) {
  if (preferences.unit) controls.unit.value = preferences.unit;
  if (preferences.showExact != null) controls.showExact.checked = preferences.showExact;
  if (preferences.showDetails != null) controls.showDetails.checked = preferences.showDetails;
  if (preferences.trendMetric) controls.trendMetric.value = preferences.trendMetric;
  if (preferences.density) controls.density.value = preferences.density;
  const columns = {
    lastUsed: controls.columnLastUsed, model: controls.columnModel, input: controls.columnInput,
    output: controls.columnOutput, cost: controls.columnCost,
  };
  for (const [key, control] of Object.entries(columns)) {
    if (preferences.visibleColumns[key] != null) control.checked = preferences.visibleColumns[key];
  }
}

export function saveViewPreferences(storage, view) {
  try {
    storage.setItem(VIEW_PREFERENCES_KEY, JSON.stringify({
      unit: view.unit,
      showExact: view.showExact,
      showDetails: view.showDetails,
      trendMetric: view.trendMetric,
      density: view.density,
      visibleColumns: view.visibleColumns,
    }));
    return true;
  } catch {
    return false;
  }
}

export function restoreCost(cost = {}) {
  return {
    total: Number(cost.total || 0),
    input: Number(cost.input || 0),
    cached: Number(cost.cached || 0),
    cacheWrite: Number(cost.cacheWrite || 0),
    output: Number(cost.output || 0),
    pricedTokens: Number(cost.pricedTokens || 0),
    unknownModels: new Set(cost.unknownModels || []),
    unavailableComponents: new Set(cost.unavailableComponents || []),
  };
}

function validTime(rawValue) {
  if (!rawValue) return { value: null, error: '' };
  const value = new Date(rawValue).getTime();
  return Number.isFinite(value)
    ? { value, error: '' }
    : { value: null, error: '請輸入有效的日期時間。' };
}

export function resolveRange(query, now = new Date()) {
  const mode = query.rangeMode;
  let fromMs = null;
  let toMs = null;
  let label = '全部時間';
  const errors = { start: '', end: '' };

  if (mode === 'last24h') {
    fromMs = now.getTime() - 24 * 3600_000;
    toMs = now.getTime();
    label = '最近 24 小時';
  } else if (mode === 'today') {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    fromMs = from.getTime();
    toMs = now.getTime();
    label = '當日使用';
  } else if (mode === 'week') {
    const from = isoWeekStart(query.weekValue);
    if (!from) errors.start = '請選擇有效週別。';
    else {
      fromMs = from.getTime();
      toMs = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7).getTime();
      label = query.weekValue;
    }
  } else if (mode === 'month') {
    const match = /^(\d{4})-(\d{2})$/.exec(query.monthValue);
    if (!match) errors.start = '請選擇有效月份。';
    else {
      const year = Number(match[1]);
      const month = Number(match[2]);
      fromMs = new Date(year, month - 1, 1).getTime();
      toMs = new Date(year, month, 1).getTime();
      label = `${year} 年 ${month} 月`;
    }
  } else if (mode === 'year') {
    const year = Number(query.yearValue);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) errors.start = '請輸入 2000 至 2200 的年份。';
    else {
      fromMs = new Date(year, 0, 1).getTime();
      toMs = new Date(year + 1, 0, 1).getTime();
      label = `${year} 年`;
    }
  } else if (mode === 'custom') {
    const start = validTime(query.customStart);
    const end = validTime(query.customEnd);
    fromMs = start.value;
    toMs = end.value;
    errors.start = start.error;
    errors.end = end.error;
    if (!errors.start && !errors.end && fromMs != null && toMs != null && fromMs >= toMs) {
      errors.end = '結束時間必須晚於起始時間。';
    }
    label = '自訂範圍';
  }

  return { mode, fromMs, toMs, label, errors, valid: !errors.start && !errors.end };
}

export function filterEvents(session, range) {
  return session.usageEvents.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return (Number.isFinite(timestamp) || range.mode === 'all')
      && (range.fromMs == null || timestamp >= range.fromMs)
      && (range.toMs == null || timestamp < range.toMs);
  });
}

export function findRate(pricing, model) {
  const normalized = String(model || '').trim().toLowerCase();
  return Object.keys(pricing?.rates || {})
    .sort((left, right) => right.length - left.length)
    .find((key) => normalized === key || normalized.startsWith(`${key}-`)) || null;
}

export function calculateCost(pricing, events) {
  const result = { total: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, unknownModels: new Set(), unavailableComponents: new Set(), pricedTokens: 0 };
  for (const event of events) {
    const matchedModel = findRate(pricing, event.model);
    if (!matchedModel) { result.unknownModels.add(event.model || 'unknown'); continue; }
    const rate = pricing.rates[matchedModel];
    for (const [name, tokens, price] of [['input', event.usage.uncachedInputTokens, rate.input], ['cached', event.usage.cachedInputTokens, rate.cachedInput], ['cacheWrite', event.usage.cacheWriteTokens, rate.cacheWrite], ['output', event.usage.outputTokens, rate.output]]) {
      if (!tokens) continue;
      if (price == null) { result.unavailableComponents.add(`${matchedModel}:${name}`); continue; }
      const amount = tokens / pricing.unitTokens * price;
      result[name] += amount;
      result.total += amount;
      result.pricedTokens += tokens;
    }
  }
  return result;
}

export function deriveSessions(source, range) {
  return source.sessions.map((session) => {
    const filteredEvents = filterEvents(session, range);
    const filteredUsage = filteredEvents.reduce((sum, event) => addUsage(sum, event.usage), zeroUsage());
    const filteredCost = calculateCost(source.pricing, filteredEvents);
    const latest = filteredEvents.reduce((current, event) => (
      Date.parse(event.timestamp) > Date.parse(current?.timestamp || 0) ? event : current
    ), null);
    return { ...session, filteredEvents, filteredUsage, filteredCost, filteredLastTimestamp: latest?.timestamp || null };
  }).filter((session) => session.filteredEvents.length);
}

export function aggregateSessions(sessions) {
  const usage = sessions.reduce((sum, session) => addUsage(sum, session.filteredUsage), zeroUsage());
  const cost = sessions.reduce((sum, session) => {
    for (const key of ['total', 'input', 'cached', 'cacheWrite', 'output', 'pricedTokens']) sum[key] += session.filteredCost[key];
    for (const model of session.filteredCost.unknownModels) sum.unknownModels.add(model);
    for (const item of session.filteredCost.unavailableComponents) sum.unavailableComponents.add(item);
    return sum;
  }, { total: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, pricedTokens: 0, unknownModels: new Set(), unavailableComponents: new Set() });
  return { usage, cost };
}

export function selectExplorerSessions(sessions, query) {
  const search = query.search.toLowerCase();
  const matched = sessions.filter((session) => !search || [session.sessionId, session.file, session.model, session.cwd, session.originator]
    .filter(Boolean).join(' ').toLowerCase().includes(search));
  const sortKey = { cost: 'total', total: 'totalTokens', input: 'inputTokens', cache: 'cachedInputTokens', output: 'outputTokens' }[query.sort];
  return [...matched].sort((left, right) => {
    if (sortKey) return query.sort === 'cost'
      ? right.filteredCost.total - left.filteredCost.total
      : right.filteredUsage[sortKey] - left.filteredUsage[sortKey];
    return (Date.parse(right.filteredLastTimestamp || right.lastTimestamp || right.modifiedAt) || 0)
      - (Date.parse(left.filteredLastTimestamp || left.lastTimestamp || left.modifiedAt) || 0);
  });
}

export function qualityMessages(source, cost) {
  const messages = [];
  const invalidLines = source.quality?.invalidLines ?? source.sessions.reduce((sum, session) => sum + session.invalidLineCount, 0);
  const resets = source.quality?.cumulativeResets ?? source.sessions.reduce((sum, session) => sum + session.cumulativeResetCount, 0);
  if (source.errors.length) messages.push(`${source.errors.length} 個 JSONL 檔案無法解析`);
  if (invalidLines) messages.push(`${invalidLines} 行 JSONL 已略過`);
  if (resets) messages.push(`${resets} 次累積計數器重設已以增量修正`);
  if (source.quality?.estimatedTimestamps) messages.push(`${source.quality.estimatedTimestamps} 筆使用事件採估算時間戳`);
  if (cost.unknownModels.size) messages.push(`未定價模型：${[...cost.unknownModels].join(', ')}`);
  if (cost.unavailableComponents.size) messages.push('部分計價元件未提供公開單價');
  if (source.truncated) messages.push(`已達 MAX_FILES=${source.maxFiles}`);
  return messages;
}
