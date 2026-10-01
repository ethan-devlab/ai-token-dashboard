import path from 'node:path';
import { bucketFor, comparisonRanges, nextBucketFor } from './timezone.mjs';
import { matchPricingRule } from './pricing.mjs';
import { addUsage, USAGE_KEYS, zeroUsage } from './usage.mjs';
import { projectionIdentity } from './projection.mjs';
import { pricingBasis, pricingRevision } from './pricing-basis.mjs';
import { createExportPlan } from './export-format.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
// The index publishes a fresh Session array per snapshot. Live scan status is assembled outside this cache.
const selections = new WeakMap();
function modifierState(pricing, event) {
  if (!pricing.modifiers) return { multiplier: 1, unknown: [] };
  const model = String(event.model || 'unknown');
  const values = event.pricingModifiers || {};
  let multiplier = 1;
  const unknown = [];
  if (values.inferenceGeo === 'us' && pricing.modifiers.usGeoPattern?.test(model) && pricing.modifiers.usGeoMultiplier != null) multiplier *= pricing.modifiers.usGeoMultiplier;
  else if (values.inferenceGeo !== 'global') unknown.push(`${model}:inferenceGeo=${values.inferenceGeo || 'missing'}`);
  if (values.speed === 'fast' && pricing.modifiers.fastPattern?.test(model) && pricing.modifiers.fastMultiplier != null) multiplier *= pricing.modifiers.fastMultiplier;
  else if (values.speed !== 'standard') unknown.push(`${model}:speed=${values.speed || 'missing'}`);
  if (values.serviceTier !== 'standard') unknown.push(`${model}:serviceTier=${values.serviceTier || 'missing'}`);
  return { multiplier, unknown };
}

function pricingRule(pricing, event, cache) {
  if (!cache) return matchPricingRule(pricing, event.model, event.timestamp);
  const key = `${event.model}\0${event.timestamp}`;
  if (cache.has(key)) return cache.get(key);
  const rule = matchPricingRule(pricing, event.model, event.timestamp);
  if (cache.size >= 4096) cache.clear();
  cache.set(key, rule); return rule;
}
export function calculateCost(pricing, events, rules) {
  const cost = { total: 0, input: 0, cached: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, pricedTokens: 0, billableTokens: 0, unpricedTokens: 0, unknownModels: new Set(), unavailableComponents: new Set(), unknownModifiers: new Set() };
  cost.available = pricing.archive?.available !== false;
  for (const event of events) {
    const eventUsage = event.usage || zeroUsage();
    const detailedCacheWrite = (eventUsage.cacheWrite5mTokens || 0) + (eventUsage.cacheWrite1hTokens || 0);
    const genericCacheWrite = Math.max(0, (eventUsage.cacheWriteTokens || 0) - detailedCacheWrite);
    const billable = eventUsage.uncachedInputTokens + eventUsage.cachedInputTokens + genericCacheWrite + detailedCacheWrite + eventUsage.outputTokens;
    cost.billableTokens += billable;
    if (!cost.available) { cost.unpricedTokens += billable; continue; }
    const matched = pricingRule(pricing, event, rules);
    if (!matched) { cost.unpricedTokens += billable; cost.unknownModels.add(event.model || 'unknown'); continue; }
    const rate = matched.rates;
    const modifier = modifierState(pricing, event);
    for (const item of modifier.unknown) cost.unknownModifiers.add(item);
    // Unknown modifiers can change every rate. A base-rate guess is not a known subtotal.
    if (modifier.unknown.length) { cost.unpricedTokens += billable; continue; }
    for (const [name, tokens, price] of [['input', eventUsage.uncachedInputTokens, rate.input], ['cached', eventUsage.cachedInputTokens, rate.cachedInput], ['cacheWrite', genericCacheWrite, pricing.provider === 'claude' ? null : rate.cacheWrite], ['cacheWrite5m', eventUsage.cacheWrite5mTokens, rate.cacheWrite5m], ['cacheWrite1h', eventUsage.cacheWrite1hTokens, rate.cacheWrite1h], ['output', eventUsage.outputTokens, rate.output]]) {
      if (!tokens) continue;
      if (price == null) { cost.unpricedTokens += tokens; cost.unavailableComponents.add(`${matched.id}:${name}`); continue; }
      const amount = tokens / pricing.unitTokens * price * modifier.multiplier;
      cost[name] += amount; cost.total += amount; cost.pricedTokens += tokens;
      if (name === 'cacheWrite5m' || name === 'cacheWrite1h') cost.cacheWrite += amount;
    }
  }
  if (!cost.available) for (const key of ['total', 'input', 'cached', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h', 'output']) cost[key] = null;
  return cost;
}
function serialiseCost(cost) {
  const unknownModels = [...cost.unknownModels].sort();
  const unavailableComponents = [...cost.unavailableComponents].sort();
  const unknownModifiers = [...cost.unknownModifiers].sort();
  return { ...cost, unknownModels, unavailableComponents, unknownModifiers, pricingCoverage: { available: cost.available, billableTokens: cost.billableTokens, pricedTokens: cost.pricedTokens, unpricedTokens: cost.unpricedTokens, ratio: cost.available ? cost.billableTokens ? cost.pricedTokens / cost.billableTokens : 1 : null, unknownModels, unavailableComponents, unknownModifiers, partial: !cost.available || cost.unpricedTokens > 0 || unknownModifiers.length > 0 } };
}
function inRange(event, range) {
  const value = Date.parse(event.timestamp);
  return Number.isFinite(value) && (range.fromMs == null || value >= range.fromMs) && (range.toMs == null || value < range.toMs);
}
function normalise(value) { return String(value || '').toLowerCase(); }
function valuesMatch(selected, value) { return !selected.length || selected.includes(String(value || 'unknown')); }
function usageQuality(reconciliation = {}) {
  const reasons = ['partialReset', 'mixedSource', 'conflict', 'incomplete', 'invalidUsage', 'possibleDuplicate', 'cacheWriteInconsistent'].filter((key) => reconciliation[key] > 0);
  return { incomplete: Boolean(reconciliation.partialReset || reconciliation.mixedSource || reconciliation.conflict || reconciliation.incomplete || reconciliation.invalidUsage), possibleDuplicate: Boolean(reconciliation.possibleDuplicate), cacheWriteInconsistent: Boolean(reconciliation.cacheWriteInconsistent), reasons };
}
function redact(value, options) {
  if (value == null) return null;
  if (options.exposeFullPaths) return String(value);
  const raw = String(value).replaceAll('\\', '/');
  if (/^\\\\|^\/\//.test(raw)) return '<redacted-network-path>';
  const base = path.posix.basename(raw);
  return base && base !== '.' ? base : '<redacted-path>';
}
function filteredSessions(summary, request, options) {
  let cache = selections.get(summary.sessions);
  if (!cache || cache.pricing !== summary.pricing || cache.available !== summary.pricing.archive?.available) { cache = { pricing: summary.pricing, available: summary.pricing.archive?.available, entries: new Map() }; selections.set(summary.sessions, cache); }
  const key = JSON.stringify([summary.provider, request.range, request.q, request.filters, Boolean(options.exposeFullPaths)]);
  if (cache.entries.has(key)) { const result = cache.entries.get(key); cache.entries.delete(key); cache.entries.set(key, result); return result; }
  const result = summary.sessions.map((session) => {
    const usageEvents = session.usageEvents.filter((event) => inRange(event, request.range) && valuesMatch(request.filters.models, event.model));
    const usage = usageEvents.reduce((sum, event) => addUsage(sum, event.usage), zeroUsage());
    const cost = serialiseCost(calculateCost(summary.pricing, usageEvents, options.rules));
    let lastTimestamp = null; let latest = -Infinity;
    for (const event of usageEvents) { const time = Date.parse(event.timestamp); if (time > latest) { latest = time; lastTimestamp = event.timestamp; } }
    const models = [...new Set(usageEvents.map((event) => event.model || 'unknown'))].sort();
    const hasRelevantObservation = (session.usageObservations || session.usageEvents).some((event) => inRange(event, request.range) && valuesMatch(request.filters.models, event.model));
    return { ...session, usageEvents, usage, cost, models, hasRelevantObservation, usageQuality: usageQuality(session.reconciliation), lastTimestamp, pricingStatus: !cost.available ? 'unknown' : cost.pricingCoverage.partial ? 'partial' : 'priced', workspace: redact(session.cwd, options) };
  }).filter((session) => session.hasRelevantObservation).filter((session) => {
    const filters = request.filters;
    const text = request.q ? [session.sessionId, session.model, ...session.models, session.workspace, session.originator, session.cliVersion, session.executionType].map(normalise).join(' ') : '';
    return (!request.q || text.includes(normalise(request.q))) && valuesMatch(filters.workspaces, session.workspace) && valuesMatch(filters.pricingStatus, session.pricingStatus) && valuesMatch(filters.usageSource, session.usageSource) && valuesMatch(filters.cliVersion, session.cliVersion) && valuesMatch(filters.originator, session.originator) && valuesMatch(filters.executionType || [], session.executionType) && (!filters.quality.length || filters.quality.some((value) => value === 'invalid' && session.invalidLineCount > 0 || value === 'reconciled' && (session.usageQuality.incomplete || session.usageQuality.possibleDuplicate)));
  });
  if (cache.entries.size >= 2) cache.entries.delete(cache.entries.keys().next().value);
  cache.entries.set(key, result); return result;
}
function sessionSummary(session, options) {
  return { provider: session.provider, sessionKey: session.sessionKey, sessionId: session.sessionId, file: redact(session.file, options), workspace: session.workspace, model: session.model, models: session.models, usageQuality: session.usageQuality, originator: session.originator, cliVersion: session.cliVersion, executionType: session.executionType || 'main', parentSessionKey: session.parentSessionKey || null, agentId: session.agentId || null, gitBranch: session.gitBranch || null, entrypoint: session.entrypoint || null, firstTimestamp: session.firstTimestamp, lastTimestamp: session.lastTimestamp, usage: session.usage, cost: session.cost, pricingStatus: session.pricingStatus, usageSource: session.usageSource, invalidLineCount: session.invalidLineCount, reconciliation: session.reconciliation };
}
function sorted(sessions, sort) {
  const keys = { total: 'totalTokens', input: 'inputTokens', cache: 'cachedInputTokens', output: 'outputTokens' };
  return [...sessions].sort((left, right) => {
    const delta = sort === 'cost' ? right.cost.total - left.cost.total : keys[sort] ? right.usage[keys[sort]] - left.usage[keys[sort]] : (Date.parse(right.lastTimestamp || 0) || 0) - (Date.parse(left.lastTimestamp || 0) || 0);
    return delta || left.sessionKey.localeCompare(right.sessionKey);
  });
}
function eventCost(pricing, event, rules) {
  const value = event.usage || zeroUsage();
  const generic = Math.max(0, (value.cacheWriteTokens || 0) - (value.cacheWrite5mTokens || 0) - (value.cacheWrite1hTokens || 0));
  if (pricing.archive?.available === false) return { total: null, partial: true };
  const rule = pricingRule(pricing, event, rules);
  if (!rule) return { total: 0, partial: (value.uncachedInputTokens + value.cachedInputTokens + generic + value.cacheWrite5mTokens + value.cacheWrite1hTokens + value.outputTokens) > 0 };
  const modifier = modifierState(pricing, event);
  if (modifier.unknown.length) return { total: 0, partial: true };
  let total = 0; let partial = false;
  for (const [tokens, price] of [[value.uncachedInputTokens, rule.rates.input], [value.cachedInputTokens, rule.rates.cachedInput], [generic, pricing.provider === 'claude' ? null : rule.rates.cacheWrite], [value.cacheWrite5mTokens, rule.rates.cacheWrite5m], [value.cacheWrite1hTokens, rule.rates.cacheWrite1h], [value.outputTokens, rule.rates.output]]) {
    if (!tokens) continue;
    if (price == null) partial = true; else total += tokens / pricing.unitTokens * price * modifier.multiplier;
  }
  return { total, partial };
}
function trend(sessions, range, rules) {
  const events = sessions.flatMap((session) => session.usageEvents);
  if (!events.length) return { points: [], unit: 'day', partialCost: false };
  let earliest = Infinity; let latest = -Infinity;
  for (const event of events) { const time = Date.parse(event.timestamp); earliest = Math.min(earliest, time); latest = Math.max(latest, time); }
  const span = (range.toMs ?? latest) - (range.fromMs ?? earliest);
  const unit = range.mode === 'last24h' || range.mode === 'today' || span <= 2 * DAY_MS ? 'hour' : range.mode === 'week' || range.mode === 'month' || span <= 400 * DAY_MS ? 'day' : range.mode === 'year' || span <= 6 * 366 * DAY_MS ? 'month' : 'year';
  const points = new Map(); const buckets = new Map();
  for (const session of sessions) for (const event of session.usageEvents) {
    const instant = Date.parse(event.timestamp);
    let time = buckets.get(instant);
    if (time == null) { time = bucketFor(instant, unit, range.timezone); if (buckets.size >= 4096) buckets.clear(); buckets.set(instant, time); }
    const point = points.get(time) || { fromMs: time, toMs: nextBucketFor(time, unit, range.timezone), label: new Intl.DateTimeFormat('en-CA', { timeZone: range.timezone, month: unit === 'year' ? undefined : '2-digit', day: unit === 'hour' || unit === 'day' ? '2-digit' : undefined, year: unit === 'month' || unit === 'year' ? 'numeric' : undefined, hour: unit === 'hour' ? '2-digit' : undefined, hourCycle: 'h23', timeZoneName: unit === 'hour' ? 'shortOffset' : undefined }).format(new Date(time)), tokens: 0, cost: 0, partialCost: false };
    point.tokens += event.usage.totalTokens;
    const itemCost = eventCost(session.__pricing, event, rules);
    point.cost = itemCost.total == null || point.cost == null ? null : point.cost + itemCost.total; point.partialCost ||= itemCost.partial;
    points.set(time, point);
  }
  return { points: [...points.values()].sort((left, right) => left.fromMs - right.fromMs), unit, partialCost: [...points.values()].some((point) => point.partialCost) };
}
function models(sessions, rules) {
  const map = new Map();
  for (const session of sessions) for (const event of session.usageEvents) {
    const entry = map.get(event.model || 'unknown') || { model: event.model || 'unknown', tokens: 0, cost: 0, partialCost: false };
    const cost = eventCost(session.__pricing, event, rules);
    entry.tokens += event.usage.totalTokens; entry.cost = cost.total == null || entry.cost == null ? null : entry.cost + cost.total; entry.partialCost ||= cost.partial; map.set(entry.model, entry);
  }
  return [...map.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}
function facets(sessions) { const values = (key) => [...new Set(sessions.map((session) => String(session[key] || 'unknown')))].sort(); return { models: [...new Set(sessions.flatMap((session) => session.models))].sort(), workspaces: values('workspace'), pricingStatus: values('pricingStatus'), usageSource: values('usageSource'), cliVersion: values('cliVersion'), originator: values('originator'), executionType: values('executionType') }; }
function context(summary, request, scan, sessions, options) {
  const events = sessions.flatMap((session) => session.usageEvents);
  const totals = sessions.reduce((sum, session) => addUsage(sum, session.usage), zeroUsage());
  const cost = serialiseCost(calculateCost(summary.pricing, events, options.rules));
  const reconciliation = sessions.reduce((sum, session) => { for (const [key, value] of Object.entries(session.reconciliation || {})) sum[key] = (sum[key] || 0) + value; return sum; }, {});
  return { provider: summary.provider || 'codex', generatedAt: summary.generatedAt, range: request.range, pricing: { provider: summary.pricing.provider || summary.provider || 'codex', updatedAt: summary.pricing.updatedAt, checkedAt: summary.pricing.checkedAt || null, source: summary.pricing.source, currency: summary.pricing.currency, unitTokens: summary.pricing.unitTokens, rates: summary.pricing.rates, basis: pricingBasis(summary.pricing), revision: pricingRevision(summary.pricing), archive: summary.pricing.archive || null, policy: 'current-basis', costDisclaimer: summary.pricing.costDisclaimer || null, toolFeesExcluded: summary.pricing.provider === 'claude' }, totals, cost, pricingCoverage: cost.pricingCoverage, quality: { scan: { invalidLines: summary.sessions.reduce((sum, session) => sum + session.invalidLineCount, 0), failedFiles: summary.errors.length, ...scan }, range: { estimatedTimestamps: events.filter((event) => event.timestampEstimated).length, reconciliation, usage: usageQuality(reconciliation), pricingCoverage: cost.pricingCoverage } }, scan, facets: options.skipFacets ? undefined : facets(sessions) };
}
function comparison(summary, request, options) {
  const periods = comparisonRanges(request.range, request.nowMs);
  if (!periods || !periods.available) return periods;
  const sum = (range) => filteredSessions(summary, { ...request, range }, options).reduce((total, session) => addUsage(total, session.usage), zeroUsage());
  const totals = sum(periods.range); const currentTotals = sum(periods.currentRange);
  return { ...periods, totals, currentTotals, percentTotalTokens: totals.totalTokens ? ((currentTotals.totalTokens - totals.totalTokens) / totals.totalTokens) * 100 : null };
}
function page(sessions, request, options) { const matched = sorted(sessions, request.sort); const items = matched.slice(request.offset, request.offset + request.limit).map((session) => sessionSummary(session, options)); return { sessions: items, matchedSessionCount: matched.length, offset: request.offset, limit: request.limit, hasPrevious: request.offset > 0, hasNext: request.offset + items.length < matched.length }; }

export function buildDashboardPayload(summary, request, scan, options = {}) {
  options = { ...options, rules: new Map() };
  const sessions = filteredSessions(summary, request, options).map((session) => ({ ...session, __pricing: summary.pricing }));
  const base = context(summary, request, scan, sessions, options);
  const modelFacets = options.skipFacets ? undefined : request.filters.models.length ? facets(filteredSessions(summary, { ...request, filters: { ...request.filters, models: [] } }, options)).models : base.facets.models;
  return { ...base, projection: projectionIdentity(summary, request, scan), facets: options.skipFacets ? undefined : { ...base.facets, models: modelFacets }, sessionCount: sessions.length, trend: options.skipTrend ? undefined : trend(sessions, request.range, options.rules), models: options.skipModels ? undefined : models(sessions, options.rules), comparison: options.skipComparison ? undefined : comparison(summary, request, options), ...(options.noPage ? { sessions: [], matchedSessionCount: sessions.length } : page(sessions, request, options)), ...(options.exportAllSessions ? { sessions: sorted(sessions, request.sort).map((session) => sessionSummary(session, options)), offset: 0, hasPrevious: false, hasNext: false } : {}) };
}
export function buildExportPayload(summary, request, scan, format, options = {}) {
  const payload = buildDashboardPayload(summary, request, scan, { ...options, noPage: true, skipComparison: true, skipFacets: true, skipTrend: format !== 'csv-trend', skipModels: format !== 'json-report', exportAllSessions: format === 'csv-sessions' });
  return { ...payload, exportedSessionCount: payload.matchedSessionCount };
}
export function buildSessionsPayload(summary, request, scan, options = {}) { options = { ...options, rules: new Map() }; const sessions = filteredSessions(summary, request, options); return { ...context(summary, request, scan, sessions, options), projection: projectionIdentity(summary, request, scan), ...page(sessions, request, options) }; }
export function buildSessionDetail(summary, request, sessionKey, options = {}) {
  const candidate = summary.sessions.find((item) => item.sessionKey === sessionKey);
  const session = candidate && filteredSessions({ ...summary, sessions: [candidate] }, request, options)[0];
  if (!session) return null;
  const observationLimit = 2_000;
  const observationCount = session.usageEvents.length;
  const observations = session.usageEvents.slice(0, observationLimit).map((event) => ({ timestamp: event.timestamp, timestampEstimated: event.timestampEstimated, model: event.model, source: event.source, sequence: event.sequence, usage: event.usage }));
  return { ...sessionSummary(session, options), lineCount: session.lineCount, observations, observationLimit, observationCount, returnedObservationCount: observations.length, observationsTruncated: observations.length < observationCount, pricingDiagnostics: session.cost.pricingCoverage };
}
export function buildExport(format, dashboard) { const plan = createExportPlan(format, dashboard); return { ...plan, body: [...plan.chunks()].join('') }; }
