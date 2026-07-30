import { escapeHtml, formatCompactNumber, formatDate, integerFormat, isoWeekValue, localDateTimeValue, moneyFormat } from './format.mjs';
import { applyDocumentTranslations, detectLocale, LOCALE_PREFERENCE_KEY, setLocale, t } from './i18n.mjs';
import { applyQueryStateToControls, applyViewPreferencesToControls, createDashboardState, deriveSessions, qualityMessages, queryStateFromSearch, queryStateToSearch, readQueryState, readViewPreferences, readViewState, resolveRange, restoreCost, saveViewPreferences } from './state.mjs';
import { createSessionDrawerController } from './drawer-controller.mjs';
import { renderExplorerRows } from './explorer.mjs';
import { renderModelBreakdown } from './model-breakdown.mjs';
import { renderUsageTrend } from './trend.mjs';

const state = createDashboardState();
const $ = (id) => document.getElementById(id);
const controls = Object.freeze({
  rangeMode: $('rangeMode'), weekInput: $('weekInput'), monthInput: $('monthInput'), yearInput: $('yearInput'), customStart: $('customStart'), customEnd: $('customEnd'), search: $('search'), sort: $('sort'), locale: $('locale'), unit: $('unit'), showExact: $('showExact'), showDetails: $('showDetails'), density: $('density'), trendMetric: $('trendMetric'), columnLastUsed: $('columnLastUsed'), columnModel: $('columnModel'), columnInput: $('columnInput'), columnOutput: $('columnOutput'), columnCost: $('columnCost'),
});
const drawerController = createSessionDrawerController({ getState: () => state, getElement: $, showNotice });
let defaultQuery;
let activeRequest = 0;
let searchTimer = 0;

function syncState({ persistView = false } = {}) {
  const { drawerSession, drawerTrigger } = state.view;
  state.query = readQueryState(controls);
  state.view = { ...readViewState(controls), drawerSession, drawerTrigger };
  document.body.classList.toggle('show-exact', state.view.showExact);
  document.body.classList.toggle('show-details', state.view.showDetails);
  if (persistView) saveViewPreferences(window.localStorage, state.view);
}

function costText(cost) { return cost.pricedTokens === 0 ? '—' : `${cost.unknownModels.size || cost.unavailableComponents.size ? '≥ ' : ''}${moneyFormat.format(cost.total)}`; }
function rangeDetail(range) {
  if (range.fromMs == null && range.toMs == null) return t('range.allLocal');
  return `${range.fromMs == null ? t('range.earliest') : formatDate(new Date(range.fromMs))} ～ ${range.toMs == null ? t('range.now') : formatDate(new Date(range.toMs))} · ${t('range.halfOpen')}`;
}
function readableLoadError(error) { const message = error instanceof Error ? error.message : String(error); return /sessions directory|failed to fetch|network/i.test(message) ? t('load.localError') : message || t('load.error'); }
function renderPricing(data) {
  $('pricingGrid').innerHTML = Object.entries(data.pricing.rates).map(([model, rate]) => {
    const show = (value) => value == null ? '—' : `$${value} / 1M`;
    return `<div class="rate"><strong>${escapeHtml(model)}</strong><br />${escapeHtml(t('table.input'))} ${show(rate.input)} · ${escapeHtml(t('cached.input'))} ${show(rate.cachedInput)}<br />${escapeHtml(t('cache.write'))} ${show(rate.cacheWrite)} · ${escapeHtml(t('table.output'))} ${show(rate.output)}</div>`;
  }).join('');
}
function renderRangeErrors(range) { const custom = range.mode === 'custom'; for (const [input, errorId, message] of [[controls.customStart, 'customStartError', range.errors.start], [controls.customEnd, 'customEndError', range.errors.end]]) { input.setAttribute('aria-invalid', String(Boolean(custom && message))); $(errorId).textContent = custom ? message : ''; } $('rangeError').textContent = custom ? '' : (range.errors.start || range.errors.end); }
function renderQuality(data, cost) { const messages = state.source.error ? [state.source.error, ...qualityMessages(data, cost)] : qualityMessages(data, cost); const quality = $('quality'); quality.hidden = messages.length === 0; quality.dataset.state = state.source.error ? 'error' : 'warning'; quality.textContent = messages.join('；'); }
function renderTotals(usage, cost) { const values = { total: usage.totalTokens, input: usage.inputTokens, output: usage.outputTokens, cache: usage.cachedInputTokens, uncached: usage.uncachedInputTokens, cacheWrite: usage.cacheWriteTokens, reasoning: usage.reasoningOutputTokens }; for (const [id, value] of Object.entries(values)) { $(id).textContent = formatCompactNumber(value, state.view.unit); const detail = document.querySelector(`[data-exact-for="${id}"]`); if (detail) detail.textContent = `${integerFormat.format(value)} ${t('total.tokens')}`; } $('cost').textContent = costText(cost); $('costDetail').textContent = `${t('table.input')} ${moneyFormat.format(cost.input)} · ${t('cached.input')} ${moneyFormat.format(cost.cached)} · ${t('cache.write')} ${moneyFormat.format(cost.cacheWrite)} · ${t('table.output')} ${moneyFormat.format(cost.output)}`; }
function renderExplorer(sessions, data, range) { const pageStart = data.matchedSessionCount ? data.offset + 1 : 0; const pageEnd = data.offset + sessions.length; $('explorerCount').textContent = t('explorer.showing', { start: integerFormat.format(pageStart), end: integerFormat.format(pageEnd), count: integerFormat.format(data.matchedSessionCount) }); $('clearSearch').hidden = !state.query.search; $('rows').innerHTML = renderExplorerRows(sessions, { pricing: data.pricing, selectedFile: state.view.drawerSession?.file, unit: state.view.unit }); const empty = $('empty'); empty.hidden = sessions.length !== 0; empty.textContent = state.query.search && data.sessionCount ? t('explorer.emptySearch') : t('explorer.emptyRange', { range: range.label }); $('explorerPagination').hidden = data.matchedSessionCount <= data.limit; $('pagePrevious').disabled = !data.hasPrevious; $('pageNext').disabled = !data.hasNext; $('pageStatus').textContent = `${integerFormat.format(pageStart)}–${integerFormat.format(pageEnd)} / ${integerFormat.format(data.matchedSessionCount)}`; }
function applyExplorerView() { document.body.dataset.tableDensity = state.view.density; document.querySelectorAll('[data-column]').forEach((element) => { element.hidden = state.view.visibleColumns[element.dataset.column] === false; }); }
function currentRange() { const requestedRange = resolveRange(state.query); renderRangeErrors(requestedRange); if (requestedRange.valid) state.lastValidRange = requestedRange; return { requestedRange, range: state.lastValidRange || requestedRange }; }
function renderLoaded(data) {
  syncState(); const { requestedRange, range } = currentRange(); const usingPreviousRange = !requestedRange.valid && state.lastValidRange; const cost = restoreCost(data.cost); const explorerSessions = deriveSessions({ pricing: data.pricing, sessions: data.sessions }, { mode: 'all', fromMs: null, toMs: null }); state.derived = { explorerSessions };
  $('rangeLabel').textContent = usingPreviousRange ? `${requestedRange.label} (${t('load.noData')})` : range.label; $('rangeDetail').textContent = usingPreviousRange ? `${t('range.endBeforeStart')} ${rangeDetail(range)}` : rangeDetail(range);
  const scan = data.scan || {}; $('info').innerHTML = `<span>${escapeHtml(t('scan.source'))}</span><span>${escapeHtml(t('scan.sessions', { count: integerFormat.format(data.sessionCount) }))}</span><span>${escapeHtml(t('scan.jsonl', { count: integerFormat.format(data.scannedFileCount) }))}</span><span>${escapeHtml(t('scan.duration', { duration: integerFormat.format(data.durationMs) }))}</span><span>${escapeHtml(t('scan.pricing', { date: data.pricing.updatedAt }))}</span>${scan.scannedAt ? `<span>${escapeHtml(t('scan.info', { time: formatDate(scan.scannedAt), version: scan.snapshotVersion }))}</span>` : ''}`;
  renderTotals(data.totals, cost); renderQuality(data, cost); renderUsageTrend($('usageTrend'), data.trend, state.view.trendMetric); renderModelBreakdown($('modelBreakdown'), data.models, state.view.trendMetric); renderExplorer(explorerSessions, data, range); applyExplorerView(); drawerController.render();
}
function renderEmptySource() { const requestedRange = resolveRange(state.query); renderRangeErrors(requestedRange); $('rangeLabel').textContent = state.source.status === 'error' ? t('load.noData') : requestedRange.label; $('rangeDetail').textContent = t('period.detail'); $('info').textContent = state.source.status === 'error' ? t('load.sessionsMetadata') : t('load.loading'); const quality = $('quality'); quality.hidden = state.source.status !== 'error'; quality.dataset.state = 'error'; quality.textContent = state.source.error || ''; $('rows').innerHTML = ''; $('usageTrend').textContent = state.source.status === 'error' ? t('load.error') : t('load.trend'); $('modelBreakdown').textContent = state.source.status === 'error' ? t('load.error') : t('load.model'); $('empty').hidden = state.source.status !== 'error'; $('empty').textContent = t('load.sessions'); $('explorerPagination').hidden = true; }
function render() { const data = state.source.data; $('summary').setAttribute('aria-busy', String(state.source.status === 'loading' || state.source.status === 'refreshing')); if (data) renderLoaded(data); else renderEmptySource(); }
function updateRangeControls() { document.querySelectorAll('.range-control').forEach((element) => { element.hidden = element.dataset.range !== controls.rangeMode.value; }); }
function showNotice(message) { $('notice').hidden = !message; $('notice').textContent = message; }
function updateUrl() { const search = queryStateToSearch(state.query); window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`); }
function requestUrl(pathname, range) { const params = new URLSearchParams({ mode: range.mode, search: state.query.search, sort: state.query.sort, offset: String(state.page.offset), limit: String(state.page.limit) }); if (range.fromMs != null) params.set('from', String(range.fromMs)); if (range.toMs != null) params.set('to', String(range.toMs)); return `${pathname}?${params}`; }

async function load({ sessionsOnly = false, refresh = false, announceRefresh = false } = {}) {
  syncState(); const { requestedRange, range } = currentRange(); if (!requestedRange.valid) { render(); return; }
  const requestId = ++activeRequest; const hadData = Boolean(state.source.data); state.source.status = refresh && hadData ? 'refreshing' : hadData ? 'ready' : 'loading'; state.source.error = '';
  if (refresh) { $('refresh').disabled = true; $('refresh').textContent = hadData ? t('load.scanning') : t('load.parsing'); } render();
  try {
    const response = await fetch(requestUrl(refresh ? '/api/refresh' : sessionsOnly ? '/api/sessions' : '/api/dashboard', range), { method: refresh ? 'POST' : 'GET', cache: 'no-store' });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || t('load.error')); if (requestId !== activeRequest) return;
    state.source = { data: sessionsOnly ? { ...state.source.data, ...payload } : payload, status: 'ready', error: '' }; state.view.drawerSession = null; state.view.drawerTrigger = null; if (!sessionsOnly) renderPricing(payload); render(); if (announceRefresh) showNotice(t('notice.refreshed', { files: integerFormat.format(payload.scannedFileCount), duration: integerFormat.format(payload.durationMs) }));
  } catch (error) { if (requestId !== activeRequest) return; state.source.status = state.source.data ? 'ready' : 'error'; state.source.error = readableLoadError(error); render(); }
  finally { if (requestId === activeRequest && refresh) { $('summary').setAttribute('aria-busy', 'false'); $('refresh').disabled = false; $('refresh').textContent = t('refresh'); } }
}
function queryChanged({ defer = false } = {}) { window.clearTimeout(searchTimer); const apply = () => { syncState(); const range = resolveRange(state.query); renderRangeErrors(range); if (!range.valid) { render(); return; } state.page.offset = 0; updateUrl(); load(); }; if (defer) searchTimer = window.setTimeout(apply, 250); else apply(); }
function viewChanged() { syncState({ persistView: true }); render(); }
function changeLocale() { setLocale(controls.locale.value); try { window.localStorage.setItem(LOCALE_PREFERENCE_KEY, controls.locale.value); } catch { /* Local storage is optional. */ } applyDocumentTranslations(); syncState({ persistView: true }); render(); }
function renderUpdate(result) {
  const host = document.createElement('span');
  if (result.status === 'disabled') host.textContent = t('update.disabled');
  else if (result.status === 'current') host.textContent = t('update.current', { version: result.currentVersion });
  else if (result.status === 'available') { host.textContent = `${t('update.available', { version: result.latestVersion })} `; const release = document.createElement('a'); release.href = result.releaseUrl; release.target = '_blank'; release.rel = 'noopener noreferrer'; release.textContent = result.releaseUrl; host.append(release); result.assets.forEach((asset) => { const item = document.createElement('span'); item.className = 'update-asset'; const link = document.createElement('a'); link.href = asset.downloadUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t('update.download', { name: asset.name }); item.append(' ', link); if (asset.sha256) item.append(` · ${t('update.verify', { sha256: asset.sha256 })}`); host.append(item); }); }
  else host.textContent = t(`update.unavailable.${result.code || 'network'}`);
  $('notice').replaceChildren(host); $('notice').hidden = false;
}
async function checkUpdates() { $('checkUpdates').disabled = true; showNotice(t('update.checking')); try { const response = await fetch('/api/update', { cache: 'no-store' }); renderUpdate(await response.json()); } catch { renderUpdate({ status: 'unavailable', code: 'network' }); } finally { $('checkUpdates').disabled = false; } }
function initialiseInputs() {
  const now = new Date(); controls.monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; controls.weekInput.value = isoWeekValue(now); controls.yearInput.value = String(now.getFullYear()); const start = new Date(now); start.setDate(start.getDate() - 7); controls.customStart.value = localDateTimeValue(start); controls.customEnd.value = localDateTimeValue(now); defaultQuery = readQueryState(controls); applyQueryStateToControls(controls, queryStateFromSearch(defaultQuery, window.location.search)); const preferences = readViewPreferences(window.localStorage); controls.locale.value = detectLocale(window.localStorage, navigator.languages); applyViewPreferencesToControls(controls, preferences); setLocale(controls.locale.value); applyDocumentTranslations(); syncState(); state.lastValidRange = resolveRange(state.query); updateRangeControls();
}
for (const input of [controls.weekInput, controls.monthInput, controls.yearInput, controls.customStart, controls.customEnd, controls.sort]) input.addEventListener('change', () => queryChanged());
controls.search.addEventListener('input', () => queryChanged({ defer: true })); controls.rangeMode.addEventListener('change', () => { updateRangeControls(); queryChanged(); });
for (const input of [controls.unit, controls.showExact, controls.showDetails, controls.trendMetric, controls.density, controls.columnLastUsed, controls.columnModel, controls.columnInput, controls.columnOutput, controls.columnCost]) input.addEventListener('change', viewChanged);
controls.locale.addEventListener('change', changeLocale); $('clearSearch').addEventListener('click', () => { controls.search.value = ''; queryChanged(); controls.search.focus(); }); $('refresh').addEventListener('click', () => { state.page.offset = 0; load({ refresh: true, announceRefresh: true }); }); $('checkUpdates').addEventListener('click', checkUpdates); $('pagePrevious').addEventListener('click', () => { state.page.offset = Math.max(0, state.page.offset - state.page.limit); load({ sessionsOnly: true }); }); $('pageNext').addEventListener('click', () => { state.page.offset += state.page.limit; load({ sessionsOnly: true }); });
window.addEventListener('popstate', () => { applyQueryStateToControls(controls, queryStateFromSearch(defaultQuery, window.location.search)); state.page.offset = 0; updateRangeControls(); load(); });
document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; if (state.view.drawerSession) { event.preventDefault(); drawerController.close(); return; } const hadSearch = Boolean(controls.search.value); const menuWasOpen = $('viewMenu').open; if (hadSearch) controls.search.value = ''; if (menuWasOpen) $('viewMenu').open = false; if (hadSearch) { event.preventDefault(); queryChanged(); } else if (menuWasOpen) { event.preventDefault(); render(); } });
$('rows').addEventListener('click', (event) => { const row = event.target.closest('tr[data-session-index]'); const session = row && state.derived?.explorerSessions?.[Number(row.dataset.sessionIndex)]; if (session) drawerController.open(session, event.target.closest('button') || row); }); $('rows').addEventListener('keydown', (event) => { if (!['Enter', ' '].includes(event.key)) return; const row = event.target.closest('tr[data-session-index]'); const session = row && state.derived?.explorerSessions?.[Number(row.dataset.sessionIndex)]; if (session) { event.preventDefault(); drawerController.open(session, row); } });
drawerController.bind(); initialiseInputs(); load();
