import { usageWarnings } from './accounting-status.mjs';
import { createFilterController } from './filters.mjs';
import { setButtonBusy, translateButtonLabels } from './button-state.mjs';
import { formatCompactNumber, formatCost, formatOverviewCost, formatDate, formatIntervalBoundary, zonedDateTimeValue, integerFormat, isoWeekValue, localDateTimeValue, moneyFormat } from './format.mjs';
import { applyDocumentTranslations, detectLocale, LOCALE_PREFERENCE_KEY, setLocale, t } from './i18n.mjs';
import { applyQueryStateToControls, applyTableViewPreferences, applyViewPreferencesToControls, budgetState, createDashboardState, customRangeError, providerFromSearch, queryStateFromSearch, queryStateToSearch, readProviderPreference, readQueryState, readViewPreferences, readViewState, requestParameters, saveProviderPreference, saveViewPreferences } from './state.mjs';
import { createRequestChannels } from './request-channels.mjs';
import { createSessionDrawerController } from './drawer-controller.mjs';
import { renderExplorerRows } from './explorer.mjs';
import { renderModelBreakdown } from './model-breakdown.mjs';
import { createProjectionCache } from './projection-cache.mjs';
import { projectionLoadState, emptyExplorerKey } from './projection-state.mjs';
import { createUsageTrendController } from './trend.mjs';
import { formatCountdown, windowLabelKey, remainingPercent, renderQuotaStrip } from './account-usage.mjs';

const state = createDashboardState(); const $ = (id) => document.getElementById(id); const channels = createRequestChannels(); const projectionCache = createProjectionCache();
const controls = Object.freeze({ provider: $('provider'), rangeMode: $('rangeMode'), weekInput: $('weekInput'), monthInput: $('monthInput'), yearInput: $('yearInput'), customStart: $('customStart'), customEnd: $('customEnd'), search: $('search'), sort: $('sort'), timezone: $('timezone'), locale: $('locale'), unit: $('unit'), showExact: $('showExact'), showDetails: $('showDetails'), density: $('density'), trendMetric: $('trendMetric'), trendMode: $('trendMode'), trendMark: $('trendMark'), columnLastUsed: $('columnLastUsed'), columnModel: $('columnModel'), columnInput: $('columnInput'), columnOutput: $('columnOutput'), columnCost: $('columnCost') });
const priorChartQueries = []; let projectionGeneration = 0;
let lastLoadOptions = {};
let defaultQuery; let searchTimer = 0; let countdownTimer = 0; let accountUsage = { provider: 'codex', status: 'loading', windows: [] }; const providerQueries = new Map(); const providerAvailability = new Map();

function showNotice(message) { $('notice').hidden = !message; $('notice').textContent = message; }
function persistBudgets() { state.view.budgetsByProvider[state.provider] = state.view.budgets; saveViewPreferences(window.localStorage, state.view); }
function renderProviderNotice() { const item = providerAvailability.get(state.provider); const unavailable = item?.available === false; $('providerNotice').hidden = !unavailable; $('providerNotice').textContent = unavailable ? t('provider.unavailable', { provider: item.label || state.provider }) : ''; }
function updateAccountUsageCountdowns() { document.querySelectorAll('[data-account-reset]').forEach((element) => { element.textContent = formatCountdown(element.dataset.accountReset, t); }); }
function renderAccountUsage() {
  const panel = $('accountUsage'); const host = $('accountUsageWindows'); const status = $('accountUsageStatus'); const loading = accountUsage.status === 'loading';
  panel.setAttribute('aria-busy', String(loading)); setButtonBusy($('refreshAccountUsage'), loading, 'action.checking'); host.replaceChildren(); $('quotaStrip').replaceChildren(); $('quotaDetails').hidden = accountUsage.status !== 'available'; status.dataset.state = accountUsage.status === 'available' ? 'ready' : loading ? 'loading' : 'error';
  if (loading) { status.textContent = t('accountUsage.loading'); return; }
  if (accountUsage.status !== 'available') { const reasons = new Set(['not-signed-in', 'auth-expired', 'network', 'rate-limit', 'unsupported-response', 'invalid-credentials', 'credential-write-failed', 'service-unavailable']); const reason = reasons.has(accountUsage.reason) ? accountUsage.reason : 'service-unavailable'; status.textContent = t(`accountUsage.unavailable.${reason}`, { provider: state.provider === 'claude' ? 'Claude' : 'Codex' }); return; }
  const provider = state.provider === 'claude' ? 'Claude' : 'Codex'; const fiveHour = accountUsage.windows.some((window) => window.kind === 'five-hour');
  status.textContent = `${t('accountUsage.available', { provider, plan: accountUsage.planType || '—', date: formatDate(accountUsage.fetchedAt) })}${fiveHour ? '' : ` · ${t('accountUsage.fiveHourUnavailable')}`}`;
  renderQuotaStrip($('quotaStrip'), accountUsage.windows, t, formatDate);
  for (const window of accountUsage.windows) {
    const card = document.createElement('article'); card.className = 'account-usage-window';
    const heading = document.createElement('div'); heading.className = 'account-usage-window-header'; const label = document.createElement('span'); label.textContent = t(windowLabelKey(window));
    const remaining = document.createElement('strong'); const remainingValue = remainingPercent(window); remaining.textContent = remainingValue == null ? '—' : t('accountUsage.remaining', { value: Math.round(remainingValue * 10) / 10 }); heading.append(label, remaining);
    const meter = document.createElement('div'); meter.className = 'account-usage-meter'; meter.setAttribute('role', 'progressbar'); meter.setAttribute('aria-label', t(windowLabelKey(window))); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); if (remainingValue != null) meter.setAttribute('aria-valuenow', String(remainingValue)); meter.style.setProperty('--remaining', `${remainingValue ?? 0}%`); meter.append(document.createElement('span'));
    const reset = document.createElement('div'); reset.className = 'account-usage-reset'; const absolute = document.createElement('span'); absolute.textContent = window.resetsAt ? t('accountUsage.resets', { date: formatDate(window.resetsAt) }) : t('accountUsage.reset.unknown'); reset.append(absolute); if (window.resetsAt) { const countdown = document.createElement('span'); countdown.className = 'account-usage-countdown'; countdown.dataset.accountReset = window.resetsAt; countdown.textContent = formatCountdown(window.resetsAt, t); reset.append(countdown); }
    const used = document.createElement('span'); used.className = 'muted'; used.textContent = t('accountUsage.used', { value: window.usedPercent == null ? '—' : Math.round(Number(window.usedPercent) * 10) / 10 }); card.append(heading, meter, used, reset); host.append(card);
  }
}
function apiError(error) { if (error?.code === 'SESSION_REFRESH_FAILED') return error.retainedSnapshot === false ? t('quality.refreshUnavailable') : t('quality.refreshFailedReason', { reason: t(`quality.refreshReason.${error.reason || 'refresh-failed'}`), count: error.failedFiles || 0 }); if (error?.code === 'INVALID_RANGE') return t('range.serverInvalid'); if (error?.code === 'INVALID_TIMEZONE') return t('range.invalidTimezone'); return error instanceof Error ? error.message : t('load.error'); }
function aggregate(data) { return data.aggregate?.usage || data.totals || {}; }
function cost(data) { return data.aggregate?.cost || data.cost || {}; }
function page(data) { return data.page || data; }
function requestUrl(path, pageOffset = state.page.offset) { const params = requestParameters(state.query, { offset: pageOffset, limit: state.page.limit }, state.provider); return `${path}?${params}`; }
function syncState({ persistView = false } = {}) { const priorBudgets = state.view.budgets; const budgetsByProvider = state.view.budgetsByProvider; const previousQuery = state.query; state.query = readQueryState(controls, previousQuery.filters, previousQuery); state.view = { ...readViewState(controls), budgets: priorBudgets, budgetsByProvider }; document.body.classList.toggle('show-exact', state.view.showExact); document.body.classList.toggle('show-details', state.view.showDetails); state.page.limit = applyTableViewPreferences(document.body, state.view); if (persistView) saveViewPreferences(window.localStorage, state.view); }
function updateUrl() { const search = queryStateToSearch(state.query, state.provider); window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`); }
function updateRangeControls() { document.querySelectorAll('.range-control').forEach((element) => { element.hidden = element.dataset.range !== controls.rangeMode.value; }); }
function renderTotals(data) { const usage = aggregate(data); const values = { total: usage.totalTokens, input: usage.inputTokens, output: usage.outputTokens, cache: usage.cachedInputTokens, uncached: usage.uncachedInputTokens, cacheWrite: usage.cacheWriteTokens, reasoning: usage.reasoningOutputTokens }; for (const [id, value] of Object.entries(values)) { $(id).textContent = formatCompactNumber(value, state.view.unit); const exact = document.querySelector(`[data-exact-for="${id}"]`); if (exact) exact.textContent = `${integerFormat.format(value || 0)} ${t(`${id}.tokens`)}`; } const value = cost(data); const coverage = value.coverage || data.pricingCoverage; const partial = coverage?.partial || value.partial || value.minimumKnown; $('cost').textContent = formatOverviewCost(value.total, partial); $('costExact').textContent = formatCost(value.total, partial); $('costDetail').textContent = coverage?.ratio == null ? '' : `${integerFormat.format(coverage.pricedTokens || 0)} / ${integerFormat.format(coverage.billableTokens || 0)} ${t('status.priced')}`; }
function renderComparison(data) {
  const comparison = data.comparison; const target = $('comparison');
  if (!comparison || comparison.available === false) { target.textContent = t(comparison?.reason === 'ambiguous-progress' ? 'v2.comparison.ambiguous' : 'v2.comparison.none'); return; }
  const percent = comparison.percentTotalTokens ?? comparison.percent;
  const headline = `${t('v2.comparison.previous')}: ${comparison.totals?.totalTokens == null ? '—' : integerFormat.format(comparison.totals.totalTokens)} ${t('total.tokens')} · ${percent == null ? t('v2.comparison.new') : `${Number(percent).toFixed(1)}%`}`;
  target.replaceChildren();
  const lines = [headline];
  if (comparison.basis) lines.push(t(comparison.basis === 'elapsed' ? 'v2.comparison.elapsed' : comparison.partial ? 'v2.comparison.progress' : 'v2.comparison.calendar'));
  if (comparison.currentRange && comparison.range) {
    const bounds = (range) => `${formatIntervalBoundary(range.fromMs, range.timezone)} → ${formatIntervalBoundary(range.toMs, range.timezone)}`;
    lines.push(`${t('v2.comparison.current')}: ${integerFormat.format(comparison.currentTotals.totalTokens)} · ${bounds(comparison.currentRange)}`, `${t('v2.comparison.previous')}: ${bounds(comparison.range)}`);
  }
  for (const text of lines) { const row = document.createElement('p'); row.textContent = text; target.append(row); }
}
function budgetMeasurement(data, budget) { const supplied = data.budgetMeasurements?.[budget.id] ?? data.budgetMeasurements?.[budget.scope]; if (supplied != null) return supplied; if (budget.scope === 'total-tokens') return { value: aggregate(data).totalTokens }; if (budget.scope === 'cost') return { value: cost(data).total }; return null; }
function renderBudgets(data) {
  const host = $('budgets');
  host.replaceChildren();
  if (!state.view.budgets.length) { host.textContent = t('v2.budget.empty'); return; }
  const currentCost = cost(data);
  const partialCost = data.pricingCoverage?.partial || currentCost.pricingCoverage?.partial || currentCost.coverage?.partial || currentCost.partial || currentCost.minimumKnown;
  for (const budget of state.view.budgets) {
    const measurement = budgetMeasurement(data, budget);
    const row = document.createElement('div'); row.className = 'budget-row';
    const name = document.createElement('strong'); name.textContent = budget.name || budget.scope;
    const value = document.createElement('span');
    let note;
    if (!measurement || measurement.value == null) value.textContent = t('v2.budget.unsupported');
    else {
      const status = budgetState(budget, measurement);
      const tokenBudget = budget.scope.includes('token');
      value.textContent = `${tokenBudget ? integerFormat.format(status.actual) : formatOverviewCost(status.actual, partialCost)} / ${tokenBudget ? integerFormat.format(status.limit) : moneyFormat.format(status.limit)}`;
      row.dataset.status = status.status;
      if (budget.scope === 'cost' && partialCost) {
        note = document.createElement('p'); note.className = 'budget-note'; note.textContent = t('v2.budget.knownCost');
      }
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button--remove button--compact'; remove.textContent = '×'; remove.setAttribute('aria-label', t('v2.budget.remove'));
    remove.addEventListener('click', () => { state.view.budgets = state.view.budgets.filter((item) => item.id !== budget.id); persistBudgets(); renderBudgets(data); });
    row.append(name, value, remove);
    if (note) row.append(note);
    host.append(row);
  }
}
const filterController = createFilterController({ getElement: $, onApply: (filters) => { state.query.filters = filters; queryChanged(); } });
function renderFacets(data) {
  if (state.source.status !== 'ready') return;
  filterController.setFacets({ quality: ['invalid', 'reconciled'], ...data.facets }, JSON.stringify([state.provider, data.range, state.query.search]));
}
function renderFilterState() { filterController.render(); }
function renderViewPreferences() { const visible = Object.values(state.view.visibleColumns).filter(Boolean).length; $('visibleColumnsStatus').textContent = t('view.columnsStatus', { visible, total: Object.keys(state.view.visibleColumns).length }); $('densityStatus').textContent = t(`view.density.${state.view.density}`, { limit: integerFormat.format(state.page.limit) }); }
function renderCustomRangeError() {
  const error = customRangeError(state.query);
  $('rangeError').hidden = !error; $('rangeError').textContent = error ? t(error) : '';
  for (const control of [controls.customStart, controls.customEnd]) {
    if (error) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }
}
function describeQuery(query) {
  const filters = Object.entries(query?.filters || {}).flatMap(([key, values]) => values.map((value) => `${t(`v2.filter.${({ pricingStatus: 'pricing', usageSource: 'source', cliVersion: 'cli' })[key] || key}`)}: ${value}`));
  return t('projection.query', { range: t(`range.${query?.rangeMode || 'all'}`), timezone: query?.timezone || '—', search: query?.search || t('projection.none'), filters: filters.join(' · ') || t('projection.none') });
}
function renderProjectionStatus() {
  const status = state.source.status; const failed = status === 'error';
  const retained = Boolean(state.source.data && (failed || state.source.projectionStale));
  const refreshedFailed = failed && lastLoadOptions.refresh;
  $('projectionStatus').dataset.state = status;
  $('projectionStatus').textContent = failed ? [refreshedFailed && state.source.data ? t('projection.refreshFailed') : state.source.data ? t('v2.projection.error') : t('load.error'), state.source.error].filter(Boolean).join(' ') : state.source.projectionStale ? t('v2.projection.stale') : ['loading', 'refreshing'].includes(status) ? t('v2.projection.loading') : '';
  $('retainedProjection').hidden = !retained;
  const range = state.source.data?.range;
  const retainedDates = retained && range?.fromMs != null ? `${formatIntervalBoundary(range.fromMs, range.timezone)} → ${formatIntervalBoundary(range.toMs, range.timezone)} · ` : '';
  $('retainedContext').textContent = retained ? `${retainedDates}${describeQuery(state.source.displayedQuery)}` : '';
  $('projectionActions').hidden = !failed;
  $('restoreProjection').hidden = !state.source.displayedQuery;
  $('retryProjection').disabled = Boolean(customRangeError(state.query));
}
async function restoreDisplayedQuery() {
  if (!state.source.displayedQuery) return;
  const hadFocus = document.activeElement === $('restoreProjection');
  state.query = structuredClone(state.source.displayedQuery); applyQueryStateToControls(controls, state.query); filterController.reset(state.query.filters); updateRangeControls(); await queryChanged();
  if (hadFocus && document.activeElement === document.body) controls.rangeMode.focus();
}

function renderMetadata(data) {
  const scan = data.scan || {}; const duration = scan.parseDurationMs ?? data.durationMs;
  const items = [`${t('v2.timezone')}: ${data.range?.timezone || state.query.timezone}`, `${t('v2.metadata.sessions')}: ${integerFormat.format(data.sessionCount ?? page(data).matchedSessionCount ?? 0)}`, `${t('v2.metadata.snapshot')}: ${scan.snapshotVersion ?? '—'}`, `${t('v2.metadata.reuse')}: ${scan.reused == null ? '—' : integerFormat.format(scan.reused)}`, `${t('v2.metadata.parse')}: ${duration == null ? '—' : `${integerFormat.format(duration)} ms`}`];
  $('info').textContent = items.join(' · ');
  const watcher = data.watcher || scan.watcher || {}; const status = ['watching', 'starting', 'failed', 'unavailable', 'disabled', 'closed'].includes(watcher.status) ? watcher.status : 'manual'; $('watcherText').textContent = t(`v2.watcher.${status}`, { duration: watcher.debounceMs ?? '—' });
}
function renderQuality(data) { const quality = data.quality || {}; const scan = quality.scan || {}; const range = quality.range || {}; const messages = Array.isArray(quality.messages) ? quality.messages : [[scan.failedFiles, t('quality.files', { count: scan.failedFiles })], [scan.truncated, t('quality.truncated', { count: scan.maxFiles })], [scan.refreshFailure, t('quality.refreshFailedReason', { reason: t(`quality.refreshReason.${scan.refreshFailure?.reason || 'refresh-failed'}`), count: scan.refreshFailure?.failedFiles || 0 })], [scan.invalidLines, t('quality.lines', { count: scan.invalidLines })], [range.estimatedTimestamps, t('quality.estimated', { count: range.estimatedTimestamps })], [range.pricingCoverage?.partial, t('quality.partial')]].filter(([active]) => active).map(([, message]) => message).concat(usageWarnings(range.reconciliation)); const host = $('quality'); host.hidden = !messages.length; host.dataset.state = quality.severity === 'error' ? 'error' : 'warning'; host.textContent = messages.join(' · '); }
function renderPricing(data) {
  const pricing = data.pricing || {}; const rates = pricing.rates; const refresh = pricing.refresh || {}; const checkedAt = pricing.checkedAt || refresh.lastSuccessfulAt;
  $('pricingStatus').textContent = checkedAt ? t('pricing.checked', { date: formatDate(checkedAt) }) : t('pricing.bundled', { date: pricing.updatedAt || '—' });
  const claude = state.provider === 'claude'; $('pricingSource').href = claude ? 'https://platform.claude.com/docs/en/about-claude/pricing' : 'https://developers.openai.com/api/docs/pricing'; $('pricingSource').textContent = t(claude ? 'pricing.source.claude' : 'pricing.source'); $('pricingDisclaimer').hidden = !claude; $('pricingDisclaimer').textContent = claude ? t('provider.claude.disclaimer') : '';
  const host = $('pricingGrid'); if (!rates || !Object.keys(rates).length) { host.textContent = t('price.unavailable'); return; }
  host.replaceChildren(...Object.entries(rates).map(([model, rate]) => {
    const card = document.createElement('article'); card.className = 'rate';
    const heading = document.createElement('h3'); heading.textContent = model;
    const unit = document.createElement('p'); unit.className = 'rate-unit'; unit.textContent = t('price.unit');
    const list = document.createElement('dl');
    const fields = [['table.input', 'input'], ['cached.input', 'cachedInput'], ...(claude ? [['provider.cacheWrite5m', 'cacheWrite5m'], ['provider.cacheWrite1h', 'cacheWrite1h']] : []), ['table.output', 'output']];
    for (const [label, key] of fields) { const row = document.createElement('div'); const term = document.createElement('dt'); term.textContent = t(label); const value = document.createElement('dd'); value.textContent = rate[key] == null ? '—' : formatCost(rate[key]); row.append(term, value); list.append(row); }
    card.append(heading, unit, list); return card;
  }));
}
function renderExplorer(data) {
  const current = page(data); const sessions = current.sessions || [];
  const matched = Number(current.matchedSessionCount ?? data.sessionCount ?? sessions.length); const offset = Number(current.offset || 0);
  $('rows').innerHTML = renderExplorerRows(sessions, { selectedKey: state.drawer.sessionKey, unit: state.view.unit, timezone: data.range?.timezone || state.query.timezone });
  $('explorerCount').textContent = t('explorer.showing', { start: matched ? offset + 1 : 0, end: offset + sessions.length, count: matched });
  $('clearSearch').hidden = !state.query.search; $('empty').hidden = sessions.length !== 0;
  const query = state.source.displayedQuery || state.query;
  $('empty').textContent = t(emptyExplorerKey(query, data.scan, providerAvailability.get(state.provider)?.available !== false), { provider: state.provider });
  $('explorerPagination').hidden = !(current.hasPrevious || current.hasNext);
  $('pagePrevious').disabled = !current.hasPrevious; $('pageNext').disabled = !current.hasNext;
  $('pageStatus').textContent = `${matched ? offset + 1 : 0}–${offset + sessions.length} / ${matched}`;
}
function renderTrend(data) {
  controls.trendMetric.disabled = state.view.trendMode !== 'single';
  trendController.update({ trend: data?.trend || { points: [] }, timezone: data?.range?.timezone || state.query.timezone, mode: state.view.trendMode, mark: state.view.trendMark, metric: state.view.trendMetric, scopeKey: state.source.queryScope, unavailable: !data, busy: ['loading', 'refreshing'].includes(state.source.status), canApply: state.source.status === 'ready' && !state.source.projectionStale, canReturn: priorChartQueries.length > 0 });
}
function renderUnavailableProjection(busy) {
  for (const id of ['cost', 'total', 'input', 'output', 'cache', 'uncached', 'cacheWrite', 'reasoning']) $(id).textContent = '—';
  for (const element of document.querySelectorAll('.primary-kpis .exact')) element.textContent = '';
  $('info').textContent = busy ? t('load.loading') : t('load.noData');
  $('quality').hidden = true; $('quality').textContent = '';
  $('modelBreakdown').textContent = t(busy ? 'load.model' : 'load.noData');
  $('rows').replaceChildren(); $('explorerPagination').hidden = true;
  $('explorerCount').textContent = t(busy ? 'load.loading' : 'load.noData');
  $('empty').hidden = busy;
  $('empty').textContent = providerAvailability.get(state.provider)?.available === false ? t('provider.unavailable', { provider: state.provider === 'claude' ? 'Claude' : 'Codex' }) : t('load.noData');
  $('clearSearch').hidden = !state.query.search;
  $('comparison').textContent = '—'; renderBudgets({}); renderPricing({});
  $('pricingStatus').textContent = t('price.unavailable'); $('watcherText').textContent = '—';
}
function render() {
  const data = state.source.data; const busy = ['loading', 'refreshing'].includes(state.source.status);
  document.body.dataset.hasProjection = String(Boolean(data));
  document.body.dataset.projectionStale = String(Boolean(state.source.projectionStale));
  for (const id of ['summary', 'usageInsight', 'sessionExplorer']) $(id).setAttribute('aria-busy', String(busy));
  $('exportData').disabled = state.source.status !== 'ready' || !data || Boolean(state.source.projectionStale) || $('exportData').getAttribute('aria-busy') === 'true';
  $('refreshPricing').disabled = state.source.status !== 'ready' || Boolean(state.source.projectionStale) || $('refreshPricing').getAttribute('aria-busy') === 'true';
  $('footer').textContent = t(state.provider === 'claude' ? 'provider.claude.footer' : 'footer');
  renderAccountUsage(); renderFilterState(); renderViewPreferences(); renderCustomRangeError(); renderProjectionStatus(); renderTrend(data);
  if (!data) {
    renderUnavailableProjection(busy);
    $('rangeLabel').textContent = state.source.status === 'error' ? t('load.noData') : t('load.loading');
    $('rangeDetail').textContent = state.source.error || ''; return;
  }
  $('rangeLabel').textContent = t(`range.${data.range?.mode || state.query.rangeMode}`);
  $('rangeDetail').textContent = `${data.range?.fromMs != null ? `${formatIntervalBoundary(data.range.fromMs, data.range.timezone)} → ${formatIntervalBoundary(data.range.toMs, data.range.timezone)} · ` : ''}${data.range?.timezone || state.query.timezone} · ${data.range?.interval || '[from,to)'}`;
  renderTotals(data); renderComparison(data); renderBudgets(data);
  renderModelBreakdown($('modelBreakdown'), data.breakdowns?.models || data.models || [], state.view.trendMetric);
  renderFacets(data); renderMetadata(data); renderQuality(data); renderPricing(data); renderExplorer(data); drawerController.render();
}
async function load({ sessionsOnly = false, refresh = false } = {}) {
  lastLoadOptions = { sessionsOnly, refresh };
  const generation = ++projectionGeneration;
  for (const name of ['dashboard', 'sessions', 'refresh']) channels.abort(name);
  syncState();
  const requestedQuery = structuredClone(state.query);
  const queryScope = queryStateToSearch({ ...state.query, sort: 'recent' }, state.provider);
  const rangeError = customRangeError(state.query);
  if (rangeError) {
    state.source.status = 'error'; state.source.projectionStale = Boolean(state.source.data); state.source.error = t(rangeError);
    render(); return false;
  }
  const channel = refresh ? 'refresh' : sessionsOnly ? 'sessions' : 'dashboard';
  const endpoint = requestUrl(refresh ? '/api/refresh' : sessionsOnly ? '/api/sessions' : '/api/dashboard');
  const cached = !refresh && !sessionsOnly ? projectionCache.get(endpoint) : null;
  Object.assign(state.source, projectionLoadState({ hasData: Boolean(state.source.data), cached, refresh }));
  state.source.error = '';
  if (cached) { state.source.data = cached; state.source.queryScope = queryScope; state.source.displayedQuery = requestedQuery; }
  render();
  if (refresh) setButtonBusy($('refresh'), true, 'action.refreshing');
  try {
    const result = await channels.request(channel, endpoint, { method: refresh ? 'POST' : 'GET' });
    if (result.stale || generation !== projectionGeneration) return false;
    if (sessionsOnly) state.source.data = { ...state.source.data, ...result.payload };
    else {
      state.source.data = result.payload;
      if (refresh) projectionCache.clear(); else projectionCache.set(endpoint, result.payload);
    }
    state.source.status = 'ready'; state.source.projectionStale = false;
    state.source.queryScope = queryScope; state.source.displayedQuery = requestedQuery;
    if (refresh) {
      const scan = result.payload.scan || {};
      const files = Number(scan.added || 0) + Number(scan.changed || 0) + Number(scan.reused || 0);
      const duration = Number(scan.discoveryDurationMs || 0) + Number(scan.parseDurationMs || 0) + Number(scan.aggregateDurationMs || 0);
      showNotice(t('notice.refreshed', { files: integerFormat.format(files), duration: integerFormat.format(duration) }));
    }
    render(); return true;
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== projectionGeneration) return false;
    state.source.status = 'error'; state.source.projectionStale = Boolean(state.source.data); state.source.error = apiError(error);
    render(); return false;
  } finally {
    if (refresh) setButtonBusy($('refresh'), false, 'action.refreshing');
  }
}
async function loadDetail(sessionKey) { const params = requestParameters(state.source.displayedQuery || state.query, { offset: 0, limit: state.page.limit }, state.provider); const result = await channels.request('detail', `/api/sessions/${encodeURIComponent(sessionKey)}?${params}`); if (result.stale) throw new DOMException('Superseded request', 'AbortError'); return result.payload; }
async function loadAccountUsage({ refresh = false } = {}) { accountUsage = { provider: state.provider, status: 'loading', windows: [] }; renderAccountUsage(); try { const path = refresh ? '/api/account-usage/refresh' : '/api/account-usage'; const result = await channels.request('accountUsage', `${path}?provider=${encodeURIComponent(state.provider)}`, { method: refresh ? 'POST' : 'GET' }); if (result.stale || result.payload.provider !== state.provider) return; accountUsage = result.payload; renderAccountUsage(); } catch (error) { if (error?.name === 'AbortError') return; accountUsage = { provider: state.provider, status: 'unavailable', reason: 'service-unavailable', windows: [] }; renderAccountUsage(); } }
async function applyChartInterval(bounds, timezone) {
  if (state.source.status !== 'ready' || state.source.projectionStale) return;
  window.clearTimeout(searchTimer);
  priorChartQueries.push(structuredClone(state.query));
  state.query = { ...state.query, rangeMode: 'custom', customStart: zonedDateTimeValue(bounds[0], timezone), customEnd: zonedDateTimeValue(bounds[1], timezone), timezone, intervalBounds: bounds };
  applyQueryStateToControls(controls, state.query); updateRangeControls(); state.page.offset = 0; updateUrl();
  await load();
}
async function returnChartQuery() {
  if (!priorChartQueries.length) return;
  window.clearTimeout(searchTimer);
  state.query = structuredClone(priorChartQueries.at(-1)); applyQueryStateToControls(controls, state.query); filterController.reset(state.query.filters); updateRangeControls(); state.page.offset = 0; updateUrl();
  if (await load()) priorChartQueries.pop();
  renderTrend(state.source.data);
}
const trendController = createUsageTrendController($('usageTrend'), { onApplyInterval: applyChartInterval, onReturnQuery: returnChartQuery });
const drawerController = createSessionDrawerController({ getState: () => state, getElement: $, loadDetail });
function queryChanged({ defer = false } = {}) { priorChartQueries.length = 0; window.clearTimeout(searchTimer); const update = () => { syncState(); state.page.offset = 0; updateUrl(); return load(); }; if (defer) searchTimer = window.setTimeout(update, 250); else return update(); }
function viewChanged(event) {
  syncState({ persistView: true });
  if (!event || [controls.trendMetric, controls.trendMode, controls.trendMark, controls.unit].includes(event.target)) { render(); return; }
  renderViewPreferences();
  if (event.target === controls.showDetails) drawerController.render();
}
function densityChanged() { syncState({ persistView: true }); state.page.offset = 0; render(); load(); }
function setLocaleFromControl() { setLocale(controls.locale.value); try { window.localStorage.setItem(LOCALE_PREFERENCE_KEY, controls.locale.value); } catch {} applyDocumentTranslations(); translateButtonLabels(); viewChanged(); }
async function checkUpdates() { setButtonBusy($('checkUpdates'), true, 'action.checking'); try { const result = await channels.request('update', '/api/update'); if (!result.stale) showNotice(result.payload.status === 'available' ? t('update.available', { version: result.payload.latestVersion }) : result.payload.status === 'current' ? t('update.current', { version: result.payload.currentVersion }) : t(`update.${result.payload.status || 'disabled'}`)); } catch (error) { if (error?.name !== 'AbortError') showNotice(apiError(error)); } finally { setButtonBusy($('checkUpdates'), false, 'action.checking'); } }
async function refreshPricing() { if (state.source.status !== 'ready' || state.source.projectionStale) return; const generation = projectionGeneration; setButtonBusy($('refreshPricing'), true, 'action.refreshing'); try { const result = await channels.request('pricing', requestUrl('/api/pricing/refresh'), { method: 'POST' }); if (result.stale || generation !== projectionGeneration) return; state.source.data = result.payload; state.source.status = 'ready'; state.source.projectionStale = false; projectionCache.clear(); const changed = result.payload.pricingUpdate?.changedModels?.length || 0; showNotice(changed ? t('pricing.updated', { count: integerFormat.format(changed) }) : t('pricing.unchanged')); render(); } catch (error) { if (error?.name !== 'AbortError') showNotice(t('pricing.update.failed')); } finally { setButtonBusy($('refreshPricing'), false, 'action.refreshing'); $('refreshPricing').disabled = state.source.status !== 'ready' || Boolean(state.source.projectionStale); } }
async function exportData() { if (state.source.status !== 'ready' || state.source.projectionStale) { showNotice(t('v2.projection.wait')); return; } setButtonBusy($('exportData'), true, 'action.exporting'); try { const format = $('exportFormat').value; const result = await channels.request('export', `${requestUrl('/api/export', 0)}&format=${encodeURIComponent(format)}`); if (result.stale) return; const url = URL.createObjectURL(result.payload); const link = document.createElement('a'); link.href = url; link.download = `local-ai-token-dashboard-${state.provider}-${format}.${({ 'csv-sessions': 'csv', 'csv-trend': 'csv', 'json-report': 'json', 'markdown-summary': 'md' })[format]}`; link.click(); URL.revokeObjectURL(url); } catch (error) { if (error?.name !== 'AbortError') showNotice(apiError(error)); } finally { setButtonBusy($('exportData'), false, 'action.exporting'); $('exportData').disabled = state.source.status !== 'ready' || Boolean(state.source.projectionStale); } }
async function diagnostics() { setButtonBusy($('loadDiagnostics'), true, 'action.loading'); try { const result = await channels.request('diagnostics', requestUrl('/api/diagnostics', 0)); if (!result.stale) { $('diagnostics').hidden = false; $('diagnostics').textContent = JSON.stringify(result.payload, null, 2); } } catch (error) { if (error?.name !== 'AbortError') showNotice(apiError(error)); } finally { setButtonBusy($('loadDiagnostics'), false, 'action.loading'); } }
function setBudgetFormMessage(message = '') { $('budgetFormMessage').hidden = !message; $('budgetFormMessage').textContent = message; }
function addBudget(event) { event.preventDefault(); const form = $('budgetForm'); if (!form.reportValidity()) return; const name = $('budgetName').value.trim(); const scope = $('budgetScope').value; const limit = Number($('budgetLimit').value); if (!name || !['cost', 'total-tokens'].includes(scope) || !Number.isFinite(limit) || limit <= 0) { setBudgetFormMessage(t('v2.budget.invalid')); return; } state.view.budgets = [...state.view.budgets, { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, scope, limit }]; persistBudgets(); form.reset(); $('budgetEditor').open = false; setBudgetFormMessage(); renderBudgets(state.source.data || {}); }
function initialise() { const now = new Date(); controls.timezone.dataset.fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; controls.timezone.value = controls.timezone.dataset.fallback; controls.monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; controls.weekInput.value = isoWeekValue(now); controls.yearInput.value = String(now.getFullYear()); const start = new Date(now); start.setDate(start.getDate() - 7); controls.customStart.value = localDateTimeValue(start); controls.customEnd.value = localDateTimeValue(now); defaultQuery = readQueryState(controls); state.provider = providerFromSearch(window.location.search, readProviderPreference(window.localStorage)); controls.provider.value = state.provider; state.query = queryStateFromSearch(defaultQuery, window.location.search); applyQueryStateToControls(controls, state.query); filterController.reset(state.query.filters); const preferences = readViewPreferences(window.localStorage); state.view.budgetsByProvider = preferences.budgetsByProvider; state.view.budgets = preferences.budgetsByProvider[state.provider] || []; applyViewPreferencesToControls(controls, preferences); controls.locale.value = detectLocale(window.localStorage, navigator.languages); setLocale(controls.locale.value); applyDocumentTranslations(); syncState(); providerQueries.set(state.provider, state.query); updateRangeControls(); }
async function loadProviders() { try { const result = await channels.request('providers', '/api/providers'); if (result.stale) return; for (const provider of result.payload.providers || []) providerAvailability.set(provider.id, provider); renderProviderNotice(); } catch { showNotice(t('provider.listError')); } }
function providerChanged(restoredQuery = null) { $('diagnostics').hidden = true; $('diagnostics').textContent = ''; priorChartQueries.length = 0; const previous = state.provider; providerQueries.set(previous, state.query); state.view.budgetsByProvider[previous] = state.view.budgets; const next = controls.provider.value; const saved = providerQueries.get(next); const shared = { rangeMode: state.query.rangeMode, weekValue: state.query.weekValue, monthValue: state.query.monthValue, yearValue: state.query.yearValue, customStart: state.query.customStart, customEnd: state.query.customEnd, intervalBounds: state.query.intervalBounds, timezone: state.query.timezone }; state.provider = next; state.query = restoredQuery?.filters ? restoredQuery : { ...(saved || defaultQuery), ...shared }; state.view.budgets = state.view.budgetsByProvider[next] || []; state.source = { data: null, status: 'loading', error: '', projectionStale: false }; state.page.offset = 0; channels.destroy(); drawerController.close(); applyQueryStateToControls(controls, state.query); filterController.reset(state.query.filters); updateRangeControls(); saveProviderPreference(window.localStorage, next); persistBudgets(); updateUrl(); renderProviderNotice(); load(); loadAccountUsage(); }
for (const control of [controls.weekInput, controls.monthInput, controls.yearInput, controls.customStart, controls.customEnd, controls.sort, controls.timezone, controls.rangeMode]) control.addEventListener('change', () => { updateRangeControls(); queryChanged(); });
controls.search.addEventListener('input', () => queryChanged({ defer: true })); for (const control of [controls.unit, controls.showExact, controls.showDetails, controls.trendMetric, controls.trendMode, controls.trendMark, controls.columnLastUsed, controls.columnModel, controls.columnInput, controls.columnOutput, controls.columnCost]) control.addEventListener('change', viewChanged); controls.density.addEventListener('change', densityChanged);
controls.provider.addEventListener('change', providerChanged); controls.locale.addEventListener('change', setLocaleFromControl); $('clearSearch').addEventListener('click', () => { controls.search.value = ''; queryChanged(); controls.search.focus(); }); $('refresh').addEventListener('click', () => { state.page.offset = 0; load({ refresh: true }); }); $('refreshAccountUsage').addEventListener('click', () => loadAccountUsage({ refresh: true })); $('refreshPricing').addEventListener('click', refreshPricing); $('checkUpdates').addEventListener('click', checkUpdates); $('exportData').addEventListener('click', exportData); $('loadDiagnostics').addEventListener('click', diagnostics); $('budgetForm').addEventListener('submit', addBudget); $('cancelBudget').addEventListener('click', () => { $('budgetForm').reset(); $('budgetEditor').open = false; setBudgetFormMessage(); });
$('retryProjection').addEventListener('click', async () => { const hadFocus = document.activeElement === $('retryProjection'); await load(lastLoadOptions); if (hadFocus && document.activeElement === document.body) controls.rangeMode.focus(); }); $('restoreProjection').addEventListener('click', restoreDisplayedQuery);
$('pagePrevious').addEventListener('click', () => { state.page.offset = Math.max(0, state.page.offset - state.page.limit); load({ sessionsOnly: true }); }); $('pageNext').addEventListener('click', () => { state.page.offset += state.page.limit; load({ sessionsOnly: true }); }); $('rows').addEventListener('click', (event) => { const button = event.target.closest('button.expand-session'); if (!button) return; const session = (page(state.source.data || {}).sessions || []).find((item) => String(item.sessionKey || item.id || item.sessionId) === button.dataset.sessionKey); if (session) drawerController.open(session, button); });

window.addEventListener('popstate', () => { priorChartQueries.length = 0; const next = providerFromSearch(window.location.search, state.provider); if (next !== state.provider) { controls.provider.value = next; providerChanged(queryStateFromSearch(defaultQuery, window.location.search)); return; } state.query = queryStateFromSearch(defaultQuery, window.location.search); applyQueryStateToControls(controls, state.query); filterController.reset(state.query.filters); state.page.offset = 0; syncState(); updateRangeControls(); load(); }); window.addEventListener('beforeunload', () => { window.clearInterval(countdownTimer); channels.destroy(); drawerController.destroy(); trendController.destroy(); }); document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; if (state.drawer.sessionKey) { event.preventDefault(); drawerController.close(); return; } if ($('viewMenu').open) { event.preventDefault(); $('viewMenu').open = false; $('viewMenu').querySelector('summary').focus(); return; } if (controls.search.value) { event.preventDefault(); controls.search.value = ''; queryChanged(); } });
drawerController.bind(); initialise();
for (const [id, key] of [['refresh', 'action.refreshing'], ['refreshPricing', 'action.refreshing'], ['refreshAccountUsage', 'action.checking'], ['checkUpdates', 'action.checking'], ['exportData', 'action.exporting'], ['loadDiagnostics', 'action.loading']]) setButtonBusy($(id), false, key);
countdownTimer = window.setInterval(updateAccountUsageCountdowns, 1_000); loadProviders().finally(() => { load(); loadAccountUsage(); });
