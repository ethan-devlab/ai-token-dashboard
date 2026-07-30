const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 31 * DAY_MS;
const YEAR_MS = 366 * DAY_MS;

function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(sum, usage) {
  for (const key of Object.keys(sum)) sum[key] += Number(usage?.[key] || 0);
  return sum;
}

function findRate(pricing, model) {
  const normalized = String(model || '').trim().toLowerCase();
  return Object.keys(pricing.rates)
    .sort((left, right) => right.length - left.length)
    .find((key) => normalized === key || normalized.startsWith(`${key}-`)) || null;
}

function createCost() {
  return {
    total: 0,
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    pricedTokens: 0,
    unknownModels: new Set(),
    unavailableComponents: new Set(),
  };
}

function addCost(sum, cost) {
  for (const key of ['total', 'input', 'cached', 'cacheWrite', 'output', 'pricedTokens']) {
    sum[key] += cost[key];
  }
  for (const model of cost.unknownModels) sum.unknownModels.add(model);
  for (const component of cost.unavailableComponents) sum.unavailableComponents.add(component);
  return sum;
}

function calculateCost(pricing, events) {
  const result = createCost();
  for (const event of events) {
    const matchedModel = findRate(pricing, event.model);
    if (!matchedModel) {
      result.unknownModels.add(event.model || 'unknown');
      continue;
    }
    const rate = pricing.rates[matchedModel];
    for (const [name, tokens, price] of [
      ['input', event.usage.uncachedInputTokens, rate.input],
      ['cached', event.usage.cachedInputTokens, rate.cachedInput],
      ['cacheWrite', event.usage.cacheWriteTokens, rate.cacheWrite],
      ['output', event.usage.outputTokens, rate.output],
    ]) {
      if (!tokens) continue;
      if (price == null) {
        result.unavailableComponents.add(`${matchedModel}:${name}`);
        continue;
      }
      const amount = tokens / pricing.unitTokens * price;
      result[name] += amount;
      result.total += amount;
      result.pricedTokens += tokens;
    }
  }
  return result;
}

function serialiseCost(cost) {
  return {
    ...cost,
    unknownModels: [...cost.unknownModels].sort(),
    unavailableComponents: [...cost.unavailableComponents].sort(),
  };
}

function eventInRange(event, range) {
  const timestamp = Date.parse(event.timestamp);
  if (!Number.isFinite(timestamp)) return range.mode === 'all';
  return (range.fromMs == null || timestamp >= range.fromMs) &&
    (range.toMs == null || timestamp < range.toMs);
}

function filterSession(session, range) {
  const usageEvents = session.usageEvents.filter((event) => eventInRange(event, range));
  const lastEvent = usageEvents.reduce((latest, event) => (
    Date.parse(event.timestamp) > Date.parse(latest?.timestamp || 0) ? event : latest
  ), null);
  return {
    ...session,
    usage: usageEvents.reduce((sum, event) => addUsage(sum, event.usage), zeroUsage()),
    usageEvents,
    filteredLastTimestamp: lastEvent?.timestamp || null,
  };
}

function filterSessions(summary, range) {
  return summary.sessions
    .map((session) => filterSession(session, range))
    .filter((session) => session.usageEvents.length > 0);
}

function searchMatches(session, search) {
  if (!search) return true;
  const haystack = [session.sessionId, session.file, session.model, session.cwd, session.originator]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(search);
}

function sortSessions(sessions, pricing, sort) {
  const key = { cost: 'total', total: 'totalTokens', input: 'inputTokens', cache: 'cachedInputTokens', output: 'outputTokens' }[sort];
  return [...sessions].sort((left, right) => {
    if (sort === 'cost') return calculateCost(pricing, right.usageEvents).total - calculateCost(pricing, left.usageEvents).total;
    if (key) return right.usage[key] - left.usage[key];
    return (Date.parse(right.filteredLastTimestamp || right.lastTimestamp || right.modifiedAt) || 0) -
      (Date.parse(left.filteredLastTimestamp || left.lastTimestamp || left.modifiedAt) || 0);
  });
}

function granularity(range, events) {
  if (range.mode === 'last24h' || range.mode === 'today') return 'hour';
  if (range.mode === 'week' || range.mode === 'month') return 'day';
  if (range.mode === 'year') return 'month';
  const times = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  const from = range.fromMs ?? Math.min(...times);
  const to = range.toMs ?? Math.max(...times);
  const span = Math.max(0, to - from);
  if (span <= 2 * DAY_MS) return 'hour';
  if (span <= 13 * MONTH_MS) return 'day';
  if (span <= 6 * YEAR_MS) return 'month';
  return 'year';
}

function bucketStart(value, unit) {
  const date = new Date(value);
  if (unit === 'hour') date.setMinutes(0, 0, 0);
  if (unit === 'day') date.setHours(0, 0, 0, 0);
  if (unit === 'month') date.setDate(1), date.setHours(0, 0, 0, 0);
  if (unit === 'year') date.setMonth(0, 1), date.setHours(0, 0, 0, 0);
  return date;
}

function nextBucket(date, unit) {
  const next = new Date(date);
  if (unit === 'hour') next.setHours(next.getHours() + 1);
  if (unit === 'day') next.setDate(next.getDate() + 1);
  if (unit === 'month') next.setMonth(next.getMonth() + 1);
  if (unit === 'year') next.setFullYear(next.getFullYear() + 1);
  return next;
}

function bucketLabel(value, unit) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  if (unit === 'hour') return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:00`;
  if (unit === 'day') return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  if (unit === 'month') return `${date.getFullYear()}/${pad(date.getMonth() + 1)}`;
  return String(date.getFullYear());
}

function buildTrend(events, pricing, range) {
  const validEvents = events.filter((event) => Number.isFinite(Date.parse(event.timestamp)));
  if (!validEvents.length) return { points: [], unit: 'day', partialCost: false };
  const unit = granularity(range, validEvents);
  const times = validEvents.map((event) => Date.parse(event.timestamp));
  const from = range.fromMs ?? Math.min(...times);
  const to = range.toMs ?? Math.max(...times);
  const start = bucketStart(from, unit);
  const end = range.toMs == null
    ? nextBucket(bucketStart(Math.max(...times), unit), unit)
    : bucketStart(to, unit);
  const boundsEnd = end > start ? end : nextBucket(start, unit);
  const pointMap = new Map();
  for (let cursor = start; cursor < boundsEnd; cursor = nextBucket(cursor, unit)) {
    pointMap.set(cursor.getTime(), { time: cursor.getTime(), label: bucketLabel(cursor, unit), tokens: 0, cost: 0 });
  }

  let partialCost = false;
  for (const event of validEvents) {
    const key = bucketStart(Date.parse(event.timestamp), unit).getTime();
    const point = pointMap.get(key);
    if (!point) continue;
    point.tokens += event.usage.totalTokens;
    const eventCost = calculateCost(pricing, [event]);
    point.cost += eventCost.total;
    partialCost ||= eventCost.unknownModels.size > 0 || eventCost.unavailableComponents.size > 0;
  }
  return { points: [...pointMap.values()], unit, partialCost };
}

function buildModels(sessions, pricing) {
  const models = new Map();
  for (const session of sessions) {
    for (const event of session.usageEvents) {
      const model = event.model || session.model || 'unknown';
      const entry = models.get(model) || { model, tokens: 0, cost: 0, partialCost: false };
      entry.tokens += event.usage.totalTokens;
      const eventCost = calculateCost(pricing, [{ ...event, model }]);
      entry.cost += eventCost.total;
      entry.partialCost ||= eventCost.unknownModels.size > 0 || eventCost.unavailableComponents.size > 0;
      models.set(model, entry);
    }
  }
  return [...models.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}

function quality(summary, sessions) {
  return {
    invalidLines: summary.sessions.reduce((sum, session) => sum + session.invalidLineCount, 0),
    cumulativeResets: summary.sessions.reduce((sum, session) => sum + session.cumulativeResetCount, 0),
    estimatedTimestamps: sessions.flatMap((session) => session.usageEvents)
      .filter((event) => event.timestampEstimated).length,
  };
}

function pageSessions(sessions, pricing, { search, sort, offset, limit }) {
  const matched = sortSessions(
    sessions.filter((session) => searchMatches(session, search.toLowerCase())),
    pricing,
    sort
  );
  const page = matched.slice(offset, offset + limit);
  return {
    sessions: page,
    matchedSessionCount: matched.length,
    offset,
    limit,
    hasPrevious: offset > 0,
    hasNext: offset + page.length < matched.length,
  };
}

function publicContext(summary, range, scan = null) {
  return {
    generatedAt: summary.generatedAt,
    durationMs: summary.durationMs,
    scannedFileCount: summary.scannedFileCount,
    parsedSessionCount: summary.parsedSessionCount,
    maxFiles: summary.maxFiles,
    truncated: summary.truncated,
    errors: summary.errors,
    pricing: summary.pricing,
    range,
    scan,
  };
}

export function buildDashboardPayload(summary, request, scan) {
  const sessions = filterSessions(summary, request.range);
  const events = sessions.flatMap((session) => session.usageEvents);
  const totals = sessions.reduce((sum, session) => addUsage(sum, session.usage), zeroUsage());
  const cost = events.reduce((sum, event) => addCost(sum, calculateCost(summary.pricing, [event])), createCost());
  return {
    ...publicContext(summary, request.range, scan),
    sessionCount: sessions.length,
    totals,
    cost: serialiseCost(cost),
    trend: buildTrend(events, summary.pricing, request.range),
    models: buildModels(sessions, summary.pricing),
    quality: quality(summary, sessions),
    ...pageSessions(sessions, summary.pricing, request),
  };
}

export function buildSessionsPayload(summary, request, scan) {
  const sessions = filterSessions(summary, request.range);
  return {
    ...publicContext(summary, request.range, scan),
    ...pageSessions(sessions, summary.pricing, request),
  };
}
