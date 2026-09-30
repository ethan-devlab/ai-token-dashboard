import path from 'node:path';
import { bucketFor, comparisonRanges, nextBucketFor } from './timezone.mjs';
import { matchPricingRule } from './pricing.mjs';
import { addUsage, USAGE_KEYS, zeroUsage } from './usage.mjs';
import { projectionIdentity } from './projection.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
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

export function calculateCost(pricing, events) {
  const cost = { total: 0, input: 0, cached: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, pricedTokens: 0, billableTokens: 0, unpricedTokens: 0, unknownModels: new Set(), unavailableComponents: new Set(), unknownModifiers: new Set() };
  for (const event of events) {
    const eventUsage = event.usage || zeroUsage();
    const detailedCacheWrite = (eventUsage.cacheWrite5mTokens || 0) + (eventUsage.cacheWrite1hTokens || 0);
    const genericCacheWrite = Math.max(0, (eventUsage.cacheWriteTokens || 0) - detailedCacheWrite);
    const billable = eventUsage.uncachedInputTokens + eventUsage.cachedInputTokens + genericCacheWrite + detailedCacheWrite + eventUsage.outputTokens;
    cost.billableTokens += billable;
    const matched = matchPricingRule(pricing, event.model, event.timestamp);
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
  return cost;
}
function serialiseCost(cost) {
  const unknownModels = [...cost.unknownModels].sort();
  const unavailableComponents = [...cost.unavailableComponents].sort();
  const unknownModifiers = [...cost.unknownModifiers].sort();
  return { ...cost, unknownModels, unavailableComponents, unknownModifiers, pricingCoverage: { billableTokens: cost.billableTokens, pricedTokens: cost.pricedTokens, unpricedTokens: cost.unpricedTokens, ratio: cost.billableTokens ? cost.pricedTokens / cost.billableTokens : 1, unknownModels, unavailableComponents, unknownModifiers, partial: cost.unpricedTokens > 0 || unknownModifiers.length > 0 } };
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
  return summary.sessions.map((session) => {
    const usageEvents = session.usageEvents.filter((event) => inRange(event, request.range) && valuesMatch(request.filters.models, event.model));
    const usage = usageEvents.reduce((sum, event) => addUsage(sum, event.usage), zeroUsage());
    const cost = serialiseCost(calculateCost(summary.pricing, usageEvents));
    const lastTimestamp = usageEvents.reduce((latest, event) => !latest || Date.parse(event.timestamp) > Date.parse(latest) ? event.timestamp : latest, null);
    const models = [...new Set(usageEvents.map((event) => event.model || 'unknown'))].sort();
    const hasRelevantObservation = (session.usageObservations || session.usageEvents).some((event) => inRange(event, request.range) && valuesMatch(request.filters.models, event.model));
    return { ...session, usageEvents, usage, cost, models, hasRelevantObservation, usageQuality: usageQuality(session.reconciliation), lastTimestamp, pricingStatus: cost.pricingCoverage.partial ? 'partial' : 'priced', workspace: redact(session.cwd, options) };
  }).filter((session) => session.hasRelevantObservation).filter((session) => {
    const filters = request.filters;
    const text = [session.sessionId, session.model, ...session.models, session.workspace, session.originator, session.cliVersion, session.executionType].map(normalise).join(' ');
    return (!request.q || text.includes(normalise(request.q))) && valuesMatch(filters.workspaces, session.workspace) && valuesMatch(filters.pricingStatus, session.pricingStatus) && valuesMatch(filters.usageSource, session.usageSource) && valuesMatch(filters.cliVersion, session.cliVersion) && valuesMatch(filters.originator, session.originator) && valuesMatch(filters.executionType || [], session.executionType) && (!filters.quality.length || filters.quality.some((value) => value === 'invalid' && session.invalidLineCount > 0 || value === 'reconciled' && (session.usageQuality.incomplete || session.usageQuality.possibleDuplicate)));
  });
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
function trend(sessions, range) {
  const events = sessions.flatMap((session) => session.usageEvents);
  if (!events.length) return { points: [], unit: 'day', partialCost: false };
  let earliest = Infinity; let latest = -Infinity;
  for (const event of events) { const time = Date.parse(event.timestamp); earliest = Math.min(earliest, time); latest = Math.max(latest, time); }
  const span = (range.toMs ?? latest) - (range.fromMs ?? earliest);
  const unit = range.mode === 'last24h' || range.mode === 'today' || span <= 2 * DAY_MS ? 'hour' : range.mode === 'week' || range.mode === 'month' || span <= 400 * DAY_MS ? 'day' : range.mode === 'year' || span <= 6 * 366 * DAY_MS ? 'month' : 'year';
  const points = new Map();
  for (const session of sessions) for (const event of session.usageEvents) {
    const time = bucketFor(Date.parse(event.timestamp), unit, range.timezone);
    const point = points.get(time) || { fromMs: time, toMs: nextBucketFor(time, unit, range.timezone), label: new Intl.DateTimeFormat('en-CA', { timeZone: range.timezone, month: unit === 'year' ? undefined : '2-digit', day: unit === 'hour' || unit === 'day' ? '2-digit' : undefined, year: unit === 'month' || unit === 'year' ? 'numeric' : undefined, hour: unit === 'hour' ? '2-digit' : undefined, hourCycle: 'h23', timeZoneName: unit === 'hour' ? 'shortOffset' : undefined }).format(new Date(time)), tokens: 0, cost: 0, partialCost: false };
    point.tokens += event.usage.totalTokens;
    const itemCost = calculateCost(session.__pricing, [event]);
    point.cost += itemCost.total; point.partialCost ||= serialiseCost(itemCost).pricingCoverage.partial;
    points.set(time, point);
  }
  return { points: [...points.values()].sort((left, right) => left.fromMs - right.fromMs), unit, partialCost: [...points.values()].some((point) => point.partialCost) };
}
function models(sessions) {
  const map = new Map();
  for (const session of sessions) for (const event of session.usageEvents) {
    const entry = map.get(event.model || 'unknown') || { model: event.model || 'unknown', tokens: 0, cost: 0, partialCost: false };
    const cost = serialiseCost(calculateCost(session.__pricing, [event]));
    entry.tokens += event.usage.totalTokens; entry.cost += cost.total; entry.partialCost ||= cost.pricingCoverage.partial; map.set(entry.model, entry);
  }
  return [...map.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}
function facets(sessions) { const values = (key) => [...new Set(sessions.map((session) => String(session[key] || 'unknown')))].sort(); return { models: [...new Set(sessions.flatMap((session) => session.models))].sort(), workspaces: values('workspace'), pricingStatus: values('pricingStatus'), usageSource: values('usageSource'), cliVersion: values('cliVersion'), originator: values('originator'), executionType: values('executionType') }; }
function context(summary, request, scan, sessions) {
  const events = sessions.flatMap((session) => session.usageEvents);
  const totals = sessions.reduce((sum, session) => addUsage(sum, session.usage), zeroUsage());
  const cost = serialiseCost(calculateCost(summary.pricing, events));
  const reconciliation = sessions.reduce((sum, session) => { for (const [key, value] of Object.entries(session.reconciliation || {})) sum[key] = (sum[key] || 0) + value; return sum; }, {});
  return { provider: summary.provider || 'codex', generatedAt: summary.generatedAt, range: request.range, pricing: { provider: summary.pricing.provider || summary.provider || 'codex', updatedAt: summary.pricing.updatedAt, checkedAt: summary.pricing.checkedAt || null, source: summary.pricing.source, currency: summary.pricing.currency, unitTokens: summary.pricing.unitTokens, rates: summary.pricing.rates, costDisclaimer: summary.pricing.costDisclaimer || null, toolFeesExcluded: summary.pricing.provider === 'claude' }, totals, cost, pricingCoverage: cost.pricingCoverage, quality: { scan: { invalidLines: summary.sessions.reduce((sum, session) => sum + session.invalidLineCount, 0), failedFiles: summary.errors.length, ...scan }, range: { estimatedTimestamps: events.filter((event) => event.timestampEstimated).length, reconciliation, usage: usageQuality(reconciliation), pricingCoverage: cost.pricingCoverage } }, scan, facets: facets(sessions) };
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
  const sessions = filteredSessions(summary, request, options).map((session) => ({ ...session, __pricing: summary.pricing }));
  const base = context(summary, request, scan, sessions);
  const modelFacets = facets(filteredSessions(summary, { ...request, filters: { ...request.filters, models: [] } }, options)).models;
  return { ...base, projection: projectionIdentity(summary, request, scan), facets: { ...base.facets, models: modelFacets }, sessionCount: sessions.length, trend: trend(sessions, request.range), models: models(sessions), comparison: comparison(summary, request, options), ...page(sessions, request, options), ...(options.exportAllSessions ? { sessions: sorted(sessions, request.sort).map((session) => sessionSummary(session, options)), offset: 0, hasPrevious: false, hasNext: false } : {}) };
}
export function buildSessionsPayload(summary, request, scan, options = {}) { const sessions = filteredSessions(summary, request, options); return { ...context(summary, request, scan, sessions), projection: projectionIdentity(summary, request, scan), ...page(sessions, request, options) }; }
export function buildSessionDetail(summary, request, sessionKey, options = {}) {
  const session = filteredSessions(summary, request, options).find((item) => item.sessionKey === sessionKey);
  if (!session) return null;
  return { ...sessionSummary(session, options), lineCount: session.lineCount, observations: session.usageEvents.slice(0, 2_000).map((event) => ({ timestamp: event.timestamp, timestampEstimated: event.timestampEstimated, model: event.model, source: event.source, sequence: event.sequence, usage: event.usage })), observationLimit: 2_000, pricingDiagnostics: session.cost.pricingCoverage };
}
function csv(value) { const safe = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value ?? ''); return `"${safe.replaceAll('"', '""')}"`; }
export function buildExport(format, dashboard) {
  const metadata = { projection: dashboard.projection, provider: dashboard.provider, range: dashboard.range, matchedSessionCount: dashboard.matchedSessionCount, exportedSessionCount: dashboard.sessions.length, scope: 'all-matched-sessions', pricing: dashboard.pricing, generatedAt: dashboard.generatedAt };
  const scopeColumns = ['queryMode', 'querySort', 'projectionKey', 'queryFromMs', 'queryToMs', 'queryTimezone', 'querySearch', 'queryFilters', 'snapshotVersion', 'pricingRevision', 'projectionAt', 'matchedSessionCount', 'exportScope', 'pricingSource', 'pricingUpdatedAt', 'pricingCurrency', 'pricingUnitTokens'];
  const scopeValues = [dashboard.range.mode, dashboard.projection?.query.sort, dashboard.projection?.key, dashboard.range.fromMs, dashboard.range.toMs, dashboard.range.timezone, dashboard.projection?.query.q || '', JSON.stringify(dashboard.projection?.query.filters || {}), dashboard.projection?.snapshotVersion, dashboard.projection?.pricingRevision, dashboard.projection?.at, dashboard.matchedSessionCount, metadata.scope, dashboard.pricing.source, dashboard.pricing.updatedAt, dashboard.pricing.currency, dashboard.pricing.unitTokens];
  const result = (value) => ({ ...value, metadata });
  if (format === 'json-report') return result({ contentType: 'application/json; charset=utf-8', extension: 'json', body: JSON.stringify({ metadata, provider: dashboard.provider, range: dashboard.range, totals: dashboard.totals, cost: dashboard.cost, models: dashboard.models, quality: dashboard.quality, costDisclaimer: dashboard.pricing?.costDisclaimer || null }, null, 2) });
  if (format === 'markdown-summary') return result({ contentType: 'text/markdown; charset=utf-8', extension: 'md', body: `# Local AI Token Dashboard\n\nProvider: ${dashboard.provider}\n\nRange: ${dashboard.range.mode} (${dashboard.range.timezone})\n\nUTC bounds (start inclusive, end exclusive): ${dashboard.range.fromMs ?? 'unbounded'} to ${dashboard.range.toMs ?? 'unbounded'}\n\nQuery: ${JSON.stringify(dashboard.projection?.query || {})}\n\nSnapshot: ${dashboard.projection?.snapshotVersion}\n\nPricing revision: ${dashboard.projection?.pricingRevision}\n\nProjection time: ${dashboard.projection?.at}\n\nExport scope: ${metadata.scope} (${dashboard.matchedSessionCount} Sessions)\n\nPricing basis: ${JSON.stringify(dashboard.pricing)}\n\nTotal tokens: ${dashboard.totals.totalTokens}\n\nKnown token cost: ${dashboard.cost.total}\n\nPartial pricing: ${dashboard.pricingCoverage.partial}\n\nUsage incomplete: ${dashboard.quality.range.usage.incomplete}\n\nPossible duplicate usage: ${dashboard.quality.range.usage.possibleDuplicate}\n\n${dashboard.pricing?.costDisclaimer || ''}`.trim() });
  if (format === 'csv-trend') return result({ contentType: 'text/csv; charset=utf-8', extension: 'csv', body: [['provider,fromMs,toMs,label,timezone,tokens,cost,partialCost,usageNotes', ...scopeColumns].join(','), ...dashboard.trend.points.map((point) => [dashboard.provider, point.fromMs, point.toMs, point.label, dashboard.range.timezone, point.tokens, point.cost, point.partialCost, dashboard.quality.range.usage.reasons.join(';'), ...scopeValues].map(csv).join(','))].join('\r\n') });
  return result({ contentType: 'text/csv; charset=utf-8', extension: 'csv', body: [['provider,session,executionType,parentSessionKey,model,workspace,totalTokens,cost,pricingStatus,usageSource,invalidLines,selectedModels,partialCost,usageIncomplete,possibleDuplicate,usageNotes', ...scopeColumns].join(','), ...dashboard.sessions.map((session) => [dashboard.provider, session.sessionId, session.executionType, session.parentSessionKey, session.model, session.workspace, session.usage.totalTokens, session.cost.total, session.pricingStatus, session.usageSource, session.invalidLineCount, session.models.join(';'), session.cost.pricingCoverage.partial, session.usageQuality.incomplete, session.usageQuality.possibleDuplicate, session.usageQuality.reasons.join(';'), ...scopeValues].map(csv).join(','))].join('\r\n') });
}
