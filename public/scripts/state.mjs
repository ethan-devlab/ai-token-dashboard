import { addUsage, isoWeekStart, zeroUsage } from './format.mjs';

export function createDashboardState() {
  return {
    source: { data: null, status: 'loading' },
    query: { rangeMode: 'month', weekValue: '', monthValue: '', yearValue: '', customStart: '', customEnd: '', search: '', sort: 'recent' },
    view: {
      unit: 'auto',
      showExact: true,
      showDetails: true,
      density: 'comfortable',
      visibleColumns: { lastUsed: true, model: true, input: true, output: true, cost: true },
    },
    derived: { explorerSessions: [] },
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
  const invalidLines = source.sessions.reduce((sum, session) => sum + session.invalidLineCount, 0);
  const resets = source.sessions.reduce((sum, session) => sum + session.cumulativeResetCount, 0);
  if (source.errors.length) messages.push(`${source.errors.length} 個 JSONL 檔案無法解析`);
  if (invalidLines) messages.push(`${invalidLines} 行 JSONL 已略過`);
  if (resets) messages.push(`${resets} 次累積計數器重設已以增量修正`);
  if (cost.unknownModels.size) messages.push(`未定價模型：${[...cost.unknownModels].join(', ')}`);
  if (cost.unavailableComponents.size) messages.push('部分計價元件未提供公開單價');
  if (source.truncated) messages.push(`已達 MAX_FILES=${source.maxFiles}`);
  return messages;
}
