import path from 'node:path';
import { bucketFor, nextBucketFor } from './timezone.mjs';
import { matchPricingRule } from './pricing.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const USAGE_KEYS = Object.freeze(['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'uncachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens']);

function zeroUsage() { return Object.fromEntries(USAGE_KEYS.map((key) => [key, 0])); }
function addUsage(left, right) { for (const key of USAGE_KEYS) left[key] += Number(right?.[key] || 0); return left; }
export function calculateCost(pricing, events) {
  const cost = { total: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, pricedTokens: 0, billableTokens: 0, unpricedTokens: 0, unknownModels: new Set(), unavailableComponents: new Set() };
  for (const event of events) {
    const eventUsage = event.usage || zeroUsage();
    const billable = eventUsage.uncachedInputTokens + eventUsage.cachedInputTokens + eventUsage.cacheWriteTokens + eventUsage.outputTokens;
    cost.billableTokens += billable;
    const matched = matchPricingRule(pricing, event.model, event.timestamp);
    if (!matched) { cost.unpricedTokens += billable; cost.unknownModels.add(event.model || 'unknown'); continue; }
    const rate = matched.rates;
    for (const [name, tokens, price] of [['input', eventUsage.uncachedInputTokens, rate.input], ['cached', eventUsage.cachedInputTokens, rate.cachedInput], ['cacheWrite', eventUsage.cacheWriteTokens, rate.cacheWrite], ['output', eventUsage.outputTokens, rate.output]]) {
      if (!tokens) continue;
      if (price == null) { cost.unpricedTokens += tokens; cost.unavailableComponents.add(`${matched.id}:${name}`); continue; }
      const amount = tokens / pricing.unitTokens * price;
      cost[name] += amount; cost.total += amount; cost.pricedTokens += tokens;
    }
  }
  return cost;
}
function serialiseCost(cost) {
  return { ...cost, unknownModels: [...cost.unknownModels].sort(), unavailableComponents: [...cost.unavailableComponents].sort(), pricingCoverage: { billableTokens: cost.billableTokens, pricedTokens: cost.pricedTokens, unpricedTokens: cost.unpricedTokens, ratio: cost.billableTokens ? cost.pricedTokens / cost.billableTokens : 1, unknownModels: [...cost.unknownModels].sort(), unavailableComponents: [...cost.unavailableComponents].sort(), partial: cost.unpricedTokens > 0 } };
}
function inRange(event, range) {
  const value = Date.parse(event.timestamp);
  return Number.isFinite(value) && (range.fromMs == null || value >= range.fromMs) && (range.toMs == null || value < range.toMs);
}
function normalise(value) { return String(value || '').toLowerCase(); }
function valuesMatch(selected, value) { return !selected.length || selected.includes(String(value || 'unknown')); }
function redact(value, options) {
  if (value == null) return null;
  if (options.exposeFullPaths) return String(value);
  const raw = String(value).replaceAll('\\', '/');
  if (/^\\\\|^\/\//.test(raw)) return '<redacted-network-path>';
  const base = path.posix.basename(raw);
  return base && base !== '.' ? base : '<redacted-path>';
}
function filteredSessions(summary, request, options) {
  return summary.sessions.map((session) => {
    const usageEvents = session.usageEvents.filter((event) => inRange(event, request.range));
    const usage = usageEvents.reduce((sum, event) => addUsage(sum, event.usage), zeroUsage());
    const cost = serialiseCost(calculateCost(summary.pricing, usageEvents));
    const lastTimestamp = usageEvents.reduce((latest, event) => !latest || Date.parse(event.timestamp) > Date.parse(latest) ? event.timestamp : latest, null);
    return { ...session, usageEvents, usage, cost, lastTimestamp, pricingStatus: cost.pricingCoverage.partial ? 'partial' : 'priced', workspace: redact(session.cwd, options) };
  }).filter((session) => session.usageEvents.length > 0).filter((session) => {
    const filters = request.filters;
    const text = [session.sessionId, session.model, session.workspace, session.originator, session.cliVersion].map(normalise).join(' ');
    return (!request.q || text.includes(normalise(request.q))) && valuesMatch(filters.models, session.model) && valuesMatch(filters.workspaces, session.workspace) && valuesMatch(filters.pricingStatus, session.pricingStatus) && valuesMatch(filters.usageSource, session.usageSource) && valuesMatch(filters.cliVersion, session.cliVersion) && valuesMatch(filters.originator, session.originator) && (!filters.quality.length || filters.quality.some((value) => value === 'invalid' && session.invalidLineCount > 0 || value === 'reconciled' && session.reconciliation.ambiguous > 0));
  });
}
function sessionSummary(session, options) {
  return { sessionKey: session.sessionKey, sessionId: session.sessionId, file: redact(session.file, options), workspace: session.workspace, model: session.model, originator: session.originator, cliVersion: session.cliVersion, firstTimestamp: session.firstTimestamp, lastTimestamp: session.lastTimestamp, usage: session.usage, cost: session.cost, pricingStatus: session.pricingStatus, usageSource: session.usageSource, invalidLineCount: session.invalidLineCount, reconciliation: session.reconciliation };
}
function sorted(sessions, sort) {
  const keys = { total: 'totalTokens', input: 'inputTokens', cache: 'cachedInputTokens', output: 'outputTokens' };
  return [...sessions].sort((left, right) => {
    const delta = sort === 'cost' ? right.cost.total - left.cost.total : keys[sort] ? right.usage[keys[sort]] - left.usage[keys[sort]] : (Date.parse(right.lastTimestamp || 0) || 0) - (Date.parse(left.lastTimestamp || 0) || 0);
    return delta || left.sessionKey.localeCompare(right.sessionKey);
  });
}
function trend(sessions, range) {
  const events = sessions.flatMap((session) => session.usageEvents);
  if (!events.length) return { points: [], unit: 'day', partialCost: false };
  const span = (range.toMs ?? Math.max(...events.map((event) => Date.parse(event.timestamp)))) - (range.fromMs ?? Math.min(...events.map((event) => Date.parse(event.timestamp))));
  const unit = range.mode === 'last24h' || range.mode === 'today' || span <= 2 * DAY_MS ? 'hour' : range.mode === 'week' || range.mode === 'month' || span <= 400 * DAY_MS ? 'day' : range.mode === 'year' || span <= 6 * 366 * DAY_MS ? 'month' : 'year';
  const points = new Map();
  for (const session of sessions) for (const event of session.usageEvents) {
    const time = bucketFor(Date.parse(event.timestamp), unit, range.timezone);
    const point = points.get(time) || { fromMs: time, toMs: nextBucketFor(time, unit, range.timezone), label: new Intl.DateTimeFormat('en-CA', { timeZone: range.timezone, month: unit === 'year' ? undefined : '2-digit', day: unit === 'hour' || unit === 'day' ? '2-digit' : undefined, year: unit === 'month' || unit === 'year' ? 'numeric' : undefined, hour: unit === 'hour' ? '2-digit' : undefined, hourCycle: 'h23' }).format(new Date(time)), tokens: 0, cost: 0, partialCost: false };
    point.tokens += event.usage.totalTokens;
    const itemCost = calculateCost(session.__pricing, [event]);
    point.cost += itemCost.total; point.partialCost ||= itemCost.unpricedTokens > 0;
    points.set(time, point);
  }
  return { points: [...points.values()].sort((left, right) => left.fromMs - right.fromMs), unit, partialCost: [...points.values()].some((point) => point.partialCost) };
}
function models(sessions) {
  const map = new Map();
  for (const session of sessions) {
    const entry = map.get(session.model || 'unknown') || { model: session.model || 'unknown', tokens: 0, cost: 0, partialCost: false };
    entry.tokens += session.usage.totalTokens; entry.cost += session.cost.total; entry.partialCost ||= session.cost.pricingCoverage.partial; map.set(entry.model, entry);
  }
  return [...map.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}
function facets(sessions) { const values = (key) => [...new Set(sessions.map((session) => String(session[key] || 'unknown')))].sort(); return { models: values('model'), workspaces: values('workspace'), pricingStatus: values('pricingStatus'), usageSource: values('usageSource'), cliVersion: values('cliVersion'), originator: values('originator') }; }
function context(summary, request, scan, sessions) {
  const events = sessions.flatMap((session) => session.usageEvents);
  const totals = sessions.reduce((sum, session) => addUsage(sum, session.usage), zeroUsage());
  const cost = serialiseCost(calculateCost(summary.pricing, events));
  const reconciliation = sessions.reduce((sum, session) => { for (const [key, value] of Object.entries(session.reconciliation)) sum[key] = (sum[key] || 0) + value; return sum; }, {});
  return { generatedAt: summary.generatedAt, range: request.range, pricing: { updatedAt: summary.pricing.updatedAt, checkedAt: summary.pricing.checkedAt || null, source: summary.pricing.source, currency: summary.pricing.currency, unitTokens: summary.pricing.unitTokens, rates: summary.pricing.rates }, totals, cost, pricingCoverage: cost.pricingCoverage, quality: { scan: { invalidLines: summary.sessions.reduce((sum, session) => sum + session.invalidLineCount, 0), failedFiles: summary.errors.length, ...scan }, range: { estimatedTimestamps: events.filter((event) => event.timestampEstimated).length, reconciliation, pricingCoverage: cost.pricingCoverage } }, scan, facets: facets(sessions) };
}
function comparison(summary, request, options) {
  if (request.range.mode === 'all' || request.range.fromMs == null || request.range.toMs == null) return null;
  const duration = request.range.toMs - request.range.fromMs;
  const prior = { ...request, range: { ...request.range, fromMs: request.range.fromMs - duration, toMs: request.range.fromMs } };
  const sessions = filteredSessions(summary, prior, options);
  const totals = sessions.reduce((sum, session) => addUsage(sum, session.usage), zeroUsage());
  return { range: prior.range, totals, percentTotalTokens: totals.totalTokens ? ((request.currentTotals.totalTokens - totals.totalTokens) / totals.totalTokens) * 100 : null };
}
function page(sessions, request, options) { const matched = sorted(sessions, request.sort); const items = matched.slice(request.offset, request.offset + request.limit).map((session) => sessionSummary(session, options)); return { sessions: items, matchedSessionCount: matched.length, offset: request.offset, limit: request.limit, hasPrevious: request.offset > 0, hasNext: request.offset + items.length < matched.length }; }

export function buildDashboardPayload(summary, request, scan, options = {}) {
  const sessions = filteredSessions(summary, request, options).map((session) => ({ ...session, __pricing: summary.pricing }));
  const base = context(summary, request, scan, sessions);
  const currentTotals = base.totals;
  return { ...base, sessionCount: sessions.length, trend: trend(sessions, request.range), models: models(sessions), comparison: comparison(summary, { ...request, currentTotals }, options), ...page(sessions, request, options) };
}
export function buildSessionsPayload(summary, request, scan, options = {}) { const sessions = filteredSessions(summary, request, options); return { ...context(summary, request, scan, sessions), ...page(sessions, request, options) }; }
export function buildSessionDetail(summary, request, sessionKey, options = {}) {
  const session = filteredSessions(summary, request, options).find((item) => item.sessionKey === sessionKey);
  if (!session) return null;
  return { ...sessionSummary(session, options), observations: session.usageEvents.slice(0, 2_000).map((event) => ({ timestamp: event.timestamp, timestampEstimated: event.timestampEstimated, model: event.model, source: event.source, sequence: event.sequence, usage: event.usage })), observationLimit: 2_000, pricingDiagnostics: session.cost.pricingCoverage };
}
function csv(value) { const safe = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value ?? ''); return `"${safe.replaceAll('"', '""')}"`; }
export function buildExport(format, dashboard) {
  if (format === 'json-report') return { contentType: 'application/json; charset=utf-8', extension: 'json', body: JSON.stringify({ range: dashboard.range, totals: dashboard.totals, cost: dashboard.cost, models: dashboard.models, quality: dashboard.quality }, null, 2) };
  if (format === 'markdown-summary') return { contentType: 'text/markdown; charset=utf-8', extension: 'md', body: `# Codex Token Dashboard\n\nRange: ${dashboard.range.mode} (${dashboard.range.timezone})\n\nTotal tokens: ${dashboard.totals.totalTokens}\n\nKnown cost: ${dashboard.cost.total}` };
  if (format === 'csv-trend') return { contentType: 'text/csv; charset=utf-8', extension: 'csv', body: ['fromMs,toMs,label,timezone,tokens,cost,partialCost', ...dashboard.trend.points.map((point) => [point.fromMs, point.toMs, point.label, dashboard.range.timezone, point.tokens, point.cost, point.partialCost].map(csv).join(','))].join('\r\n') };
  return { contentType: 'text/csv; charset=utf-8', extension: 'csv', body: ['session,model,workspace,totalTokens,cost,pricingStatus,usageSource,invalidLines', ...dashboard.sessions.map((session) => [session.sessionId, session.model, session.workspace, session.usage.totalTokens, session.cost.total, session.pricingStatus, session.usageSource, session.invalidLineCount].map(csv).join(','))].join('\r\n') };
}
