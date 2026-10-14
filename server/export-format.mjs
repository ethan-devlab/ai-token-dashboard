const PIECE = 16384;
function* pieces(value) {
  const text = String(value);
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + PIECE);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    yield text.slice(start, end); start = end;
  }
}
function* quoted(value) { yield '"'; for (const piece of pieces(value)) yield JSON.stringify(piece).slice(1, -1); yield '"'; }
function* jsonChunks(value, pretty = false, depth = 0) {
  if (typeof value === 'string') { yield* quoted(value); return; }
  if (value == null || typeof value !== 'object') { yield JSON.stringify(value) ?? 'null'; return; }
  const array = Array.isArray(value);
  const keys = array ? Array.from({ length: value.length }, (_, i) => i) : Object.keys(value).filter(key => value[key] !== undefined);
  yield array ? '[' : '{';
  for (let i = 0; i < keys.length; i++) {
    if (i) yield ',';
    if (pretty) yield '\n' + '  '.repeat(depth + 1);
    if (!array) { yield* quoted(keys[i]); yield pretty ? ': ' : ':'; }
    yield* jsonChunks(value[keys[i]], pretty, depth + 1);
  }
  if (keys.length && pretty) yield '\n' + '  '.repeat(depth);
  yield array ? ']' : '}';
}
function* csvField(value) {
  yield '"'; if (/^[=+@-]/.test(String(value))) yield "'";
  for (const piece of pieces(value ?? '')) yield piece.replaceAll('"', '""');
  yield '"';
}
function* markdown(dashboard, metadata) {
  yield '# Local AI Token Dashboard\n\nProvider: '; yield* pieces(dashboard.provider);
  yield '\n\nRange: '; yield* pieces(dashboard.range.mode); yield ' ('; yield* pieces(dashboard.range.timezone); yield ')';
  yield '\n\nUTC bounds (start inclusive, end exclusive): '; yield String(dashboard.range.fromMs ?? 'unbounded'); yield ' to '; yield String(dashboard.range.toMs ?? 'unbounded');
  yield '\n\nQuery: '; yield* jsonChunks(dashboard.projection?.query || {});
  yield '\n\nSnapshot: '; yield String(dashboard.projection?.snapshotVersion);
  yield '\n\nPricing revision: '; yield String(dashboard.projection?.pricingRevision);
  yield '\n\nProjection time: '; yield String(dashboard.projection?.at);
  yield '\n\nExport scope: '; yield metadata.scope; yield ' ('; yield String(dashboard.matchedSessionCount); yield ' Sessions)';
  yield '\n\nPricing basis: '; yield* jsonChunks(dashboard.pricing);
  yield '\n\nTotal tokens: '; yield String(dashboard.totals.totalTokens);
  yield '\n\nKnown token cost: '; yield String(dashboard.cost.total ?? 'unknown');
  yield '\n\nPartial pricing: '; yield String(dashboard.pricingCoverage.partial);
  yield '\n\nUsage incomplete: '; yield String(dashboard.quality.range.usage.incomplete);
  yield '\n\nPossible duplicate usage: '; yield String(dashboard.quality.range.usage.possibleDuplicate);
  const disclaimer = String(dashboard.pricing?.costDisclaimer || '').trimEnd();
  if (disclaimer) { yield '\n\n'; yield* pieces(disclaimer); }
}
function outputFor(format, dashboard) {
  const metadata = { projection: dashboard.projection, provider: dashboard.provider, range: dashboard.range, matchedSessionCount: dashboard.matchedSessionCount, exportedSessionCount: dashboard.exportedSessionCount ?? dashboard.sessions.length, scope: 'all-matched-sessions', pricing: dashboard.pricing, generatedAt: dashboard.generatedAt };
  const scopeColumns = ['queryMode', 'querySort', 'projectionKey', 'queryFromMs', 'queryToMs', 'queryTimezone', 'querySearch', 'queryFilters', 'snapshotVersion', 'pricingRevision', 'projectionAt', 'matchedSessionCount', 'exportScope', 'pricingSource', 'pricingUpdatedAt', 'pricingCurrency', 'pricingUnitTokens', 'scanComplete', 'queryUsageIncomplete', 'queryPossibleDuplicate', 'queryPartialPricing', 'pricingArchived', 'pricingCalculationPolicy'];
  const scopeValues = [dashboard.range.mode, dashboard.projection?.query.sort, dashboard.projection?.key, dashboard.range.fromMs, dashboard.range.toMs, dashboard.range.timezone, dashboard.projection?.query.q || '', JSON.stringify(dashboard.projection?.query.filters || {}), dashboard.projection?.snapshotVersion, dashboard.projection?.pricingRevision, dashboard.projection?.at, dashboard.matchedSessionCount, metadata.scope, dashboard.pricing.source, dashboard.pricing.updatedAt, dashboard.pricing.currency, dashboard.pricing.unitTokens, dashboard.quality.scan.complete, dashboard.quality.range.usage.incomplete, dashboard.quality.range.usage.possibleDuplicate, dashboard.pricingCoverage.partial, dashboard.pricing.archive?.available ?? null, dashboard.pricing.calculationPolicy];
  const csvBody = (columns, rows) => function* () {
    yield [...columns, ...scopeColumns, 'recordType'].join(',');
    const records = rows.length ? rows : [[dashboard.provider, ...Array(columns.length - 1).fill(null)]];
    for (const row of records) {
      yield '\r\n';
      const values = [...row, ...scopeValues, rows.length ? 'data' : 'metadata'];
      for (let i = 0; i < values.length; i++) { if (i) yield ','; yield* csvField(values[i]); }
    }
  };
  const result = (value) => ({ ...value, metadata });
  if (format === 'json-report') return result({ contentType: 'application/json; charset=utf-8', extension: 'json', chunks: () => jsonChunks({ metadata, provider: dashboard.provider, range: dashboard.range, totals: dashboard.totals, cost: dashboard.cost, models: dashboard.models, quality: dashboard.quality, costDisclaimer: dashboard.pricing?.costDisclaimer || null }, true) });
  if (format === 'markdown-summary') return result({ contentType: 'text/markdown; charset=utf-8', extension: 'md', chunks: () => markdown(dashboard, metadata) });
  if (format === 'csv-trend') return result({ contentType: 'text/csv; charset=utf-8', extension: 'csv', chunks: csvBody('provider,fromMs,toMs,label,timezone,tokens,cost,partialCost,usageNotes'.split(','), dashboard.trend.points.map((point) => [dashboard.provider, point.fromMs, point.toMs, point.label, dashboard.range.timezone, point.tokens, point.cost, point.partialCost, dashboard.quality.range.usage.reasons.join(';')])) });
  return result({ contentType: 'text/csv; charset=utf-8', extension: 'csv', chunks: csvBody('provider,session,executionType,parentSessionKey,model,workspace,totalTokens,cost,pricingStatus,usageSource,invalidLines,selectedModels,partialCost,usageIncomplete,possibleDuplicate,usageNotes'.split(','), dashboard.sessions.map((session) => [dashboard.provider, session.sessionId, session.executionType, session.parentSessionKey, session.model, session.workspace, session.usage.totalTokens, session.cost.total, session.pricingStatus, session.usageSource, session.invalidLineCount, session.models.join(';'), session.cost.pricingCoverage.partial, session.usageQuality.incomplete, session.usageQuality.possibleDuplicate, session.usageQuality.reasons.join(';')])) });
}
export function createExportPlan(format, dashboard) {
  const output = outputFor(format, dashboard);
  let byteLength = 0;
  for (const chunk of output.chunks()) byteLength += Buffer.byteLength(chunk);
  if (!Number.isSafeInteger(byteLength)) throw new Error('Export length is invalid.');
  return { ...output, byteLength, *buffers() {
    const buffer = Buffer.allocUnsafe(131072); let size = 0;
    for (const chunk of output.chunks()) for (const piece of pieces(chunk)) {
      const length = Buffer.byteLength(piece);
      if (size && size + length > buffer.length) { yield buffer.subarray(0, size); size = 0; }
      // A yielded view is valid until the next pull. The writer must await its callback before reuse.
      size += buffer.write(piece, size);
    }
    if (size) yield buffer.subarray(0, size);
  } };
}
