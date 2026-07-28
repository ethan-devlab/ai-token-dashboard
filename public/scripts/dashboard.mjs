import { escapeHtml, formatDate, integerFormat, isoWeekValue, localDateTimeValue, moneyFormat } from './format.mjs';
import {
  applyQueryStateToControls,
  applyViewPreferencesToControls,
  createDashboardState,
  deriveSessions,
  qualityMessages,
  queryStateFromSearch,
  queryStateToSearch,
  readQueryState,
  readViewPreferences,
  readViewState,
  resolveRange,
  restoreCost,
  saveViewPreferences,
} from './state.mjs';
import { createSessionDrawerController } from './drawer-controller.mjs';
import { renderExplorerRows } from './explorer.mjs';
import { renderModelBreakdown } from './model-breakdown.mjs';
import { renderUsageTrend } from './trend.mjs';

const state = createDashboardState();
const $ = (id) => document.getElementById(id);
const controls = Object.freeze({
  rangeMode: $('rangeMode'), weekInput: $('weekInput'), monthInput: $('monthInput'), yearInput: $('yearInput'),
  customStart: $('customStart'), customEnd: $('customEnd'), search: $('search'), sort: $('sort'),
  unit: $('unit'), showExact: $('showExact'), showDetails: $('showDetails'), density: $('density'),
  trendMetric: $('trendMetric'),
  columnLastUsed: $('columnLastUsed'), columnModel: $('columnModel'), columnInput: $('columnInput'),
  columnOutput: $('columnOutput'), columnCost: $('columnCost'),
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

function compactNumber(value) {
  const number = Number(value || 0);
  if (state.view.unit === 'exact') return integerFormat.format(number);
  const table = state.view.unit === 'auto'
    ? (Math.abs(number) >= 1e9 ? ['B', 1e9] : Math.abs(number) >= 1e6 ? ['M', 1e6] : Math.abs(number) >= 1e3 ? ['K', 1e3] : ['', 1])
    : [state.view.unit, state.view.unit === 'B' ? 1e9 : state.view.unit === 'M' ? 1e6 : 1e3];
  const [suffix, divisor] = table;
  if (!suffix) return integerFormat.format(number);
  const scaled = number / divisor;
  const digits = Math.abs(scaled) >= 100 ? 1 : Math.abs(scaled) >= 10 ? 2 : 3;
  return `${scaled.toLocaleString('zh-TW', { maximumFractionDigits: digits })}${suffix}`;
}

function costText(cost) {
  if (cost.pricedTokens === 0) return '—';
  return `${cost.unknownModels.size || cost.unavailableComponents.size ? '≥ ' : ''}${moneyFormat.format(cost.total)}`;
}

function rangeDetail(range) {
  if (range.fromMs == null && range.toMs == null) return '全部本機資料 · local time';
  const from = range.fromMs == null ? '最早' : formatDate(new Date(range.fromMs));
  const to = range.toMs == null ? '現在' : formatDate(new Date(range.toMs));
  return `${from} ～ ${to} · local time · 半開區間`;
}

function readableLoadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /sessions directory|failed to fetch|network/i.test(message)
    ? '無法讀取本機 sessions。請確認伺服器仍在 localhost 執行。'
    : message;
}

function renderPricing(data) {
  $('pricingGrid').innerHTML = Object.entries(data.pricing.rates).map(([model, rate]) => {
    const show = (value) => value == null ? '—' : `$${value} / 1M`;
    return `<div class="rate"><strong>${escapeHtml(model)}</strong><br />Input ${show(rate.input)} · Cached ${show(rate.cachedInput)}<br />Cache write ${show(rate.cacheWrite)} · Output ${show(rate.output)}</div>`;
  }).join('');
}

function renderRangeErrors(range) {
  const custom = range.mode === 'custom';
  for (const [input, errorId, message] of [[controls.customStart, 'customStartError', range.errors.start], [controls.customEnd, 'customEndError', range.errors.end]]) {
    input.setAttribute('aria-invalid', String(Boolean(custom && message)));
    $(errorId).textContent = custom ? message : '';
  }
  $('rangeError').textContent = custom ? '' : (range.errors.start || range.errors.end);
}

function renderQuality(data, cost) {
  const messages = state.source.error ? [state.source.error, ...qualityMessages(data, cost)] : qualityMessages(data, cost);
  const quality = $('quality');
  quality.hidden = messages.length === 0;
  quality.dataset.state = state.source.error ? 'error' : 'warning';
  quality.textContent = messages.join('；');
}

function renderTotals(usage, cost) {
  const values = { total: usage.totalTokens, input: usage.inputTokens, output: usage.outputTokens, cache: usage.cachedInputTokens, uncached: usage.uncachedInputTokens, cacheWrite: usage.cacheWriteTokens, reasoning: usage.reasoningOutputTokens };
  for (const [id, value] of Object.entries(values)) {
    $(id).textContent = compactNumber(value);
    const detail = document.querySelector(`[data-exact-for="${id}"]`);
    if (detail) detail.textContent = `${integerFormat.format(value)} tokens`;
  }
  $('cost').textContent = costText(cost);
  $('costDetail').textContent = `Input ${moneyFormat.format(cost.input)} · Cached ${moneyFormat.format(cost.cached)} · Cache write ${moneyFormat.format(cost.cacheWrite)} · Output ${moneyFormat.format(cost.output)}`;
}

function renderExplorer(sessions, data, range) {
  const query = state.query.search;
  const pageStart = data.matchedSessionCount ? data.offset + 1 : 0;
  const pageEnd = data.offset + sessions.length;
  $('explorerCount').textContent = `顯示 ${integerFormat.format(pageStart)}–${integerFormat.format(pageEnd)} / ${integerFormat.format(data.matchedSessionCount)} sessions`;
  $('clearSearch').hidden = !query;
  $('rows').innerHTML = renderExplorerRows(sessions, { pricing: data.pricing, selectedFile: state.view.drawerSession?.file, unit: state.view.unit });
  const empty = $('empty');
  empty.hidden = sessions.length !== 0;
  empty.textContent = query && data.sessionCount ? '找不到符合搜尋條件的 session。按 Escape 或使用「清除搜尋」返回完整表格。' : `此範圍（${range.label}）沒有 token 使用紀錄。`;
  $('explorerPagination').hidden = data.matchedSessionCount <= data.limit;
  $('pagePrevious').disabled = !data.hasPrevious;
  $('pageNext').disabled = !data.hasNext;
  $('pageStatus').textContent = `${integerFormat.format(pageStart)}–${integerFormat.format(pageEnd)} / ${integerFormat.format(data.matchedSessionCount)}`;
}

function applyExplorerView() {
  document.body.dataset.tableDensity = state.view.density;
  document.querySelectorAll('[data-column]').forEach((element) => {
    element.hidden = state.view.visibleColumns[element.dataset.column] === false;
  });
}

function currentRange() {
  const requestedRange = resolveRange(state.query);
  renderRangeErrors(requestedRange);
  if (requestedRange.valid) state.lastValidRange = requestedRange;
  return { requestedRange, range: state.lastValidRange || requestedRange };
}

function renderLoaded(data) {
  syncState();
  const { requestedRange, range } = currentRange();
  const usingPreviousRange = !requestedRange.valid && state.lastValidRange;
  const cost = restoreCost(data.cost);
  const explorerSessions = deriveSessions({ pricing: data.pricing, sessions: data.sessions }, { mode: 'all', fromMs: null, toMs: null });
  state.derived = { explorerSessions };
  $('rangeLabel').textContent = usingPreviousRange ? `${requestedRange.label}（未套用）` : range.label;
  $('rangeDetail').textContent = usingPreviousRange ? `請修正日期；目前仍顯示 ${rangeDetail(range)}` : rangeDetail(range);
  $('info').innerHTML = `<span>來源：<code>local sessions root</code></span><span>範圍內 sessions：${integerFormat.format(data.sessionCount)}</span><span>JSONL：${integerFormat.format(data.scannedFileCount)}</span><span>解析：${integerFormat.format(data.durationMs)} ms</span><span>定價版本：${escapeHtml(data.pricing.updatedAt)}</span>`;
  renderTotals(data.totals, cost);
  renderQuality(data, cost);
  renderUsageTrend($('usageTrend'), data.trend, state.view.trendMetric);
  renderModelBreakdown($('modelBreakdown'), data.models, state.view.trendMetric);
  renderExplorer(explorerSessions, data, range);
  applyExplorerView();
  drawerController.render();
}

function renderEmptySource() {
  const requestedRange = resolveRange(state.query);
  renderRangeErrors(requestedRange);
  $('rangeLabel').textContent = state.source.status === 'error' ? '資料未載入' : requestedRange.label;
  $('rangeDetail').textContent = '範圍採半開區間，精確值可隨時切換。';
  $('info').textContent = state.source.status === 'error' ? '尚未讀取 sessions metadata。' : '載入中…';
  const quality = $('quality');
  quality.hidden = state.source.status !== 'error';
  quality.dataset.state = 'error';
  quality.textContent = state.source.error || '';
  $('rows').innerHTML = '';
  $('usageTrend').textContent = state.source.status === 'error' ? '無法載入趨勢資料。' : '載入趨勢資料…';
  $('modelBreakdown').textContent = state.source.status === 'error' ? '無法載入模型用量。' : '載入模型用量…';
  $('empty').hidden = state.source.status !== 'error';
  $('empty').textContent = '無法載入 Codex sessions。請確認本機 sessions 目錄後重試。';
  $('explorerPagination').hidden = true;
}

function render() {
  const data = state.source.data;
  $('summary').setAttribute('aria-busy', String(state.source.status === 'loading' || state.source.status === 'refreshing'));
  if (data) renderLoaded(data);
  else renderEmptySource();
}

function updateRangeControls() {
  document.querySelectorAll('.range-control').forEach((element) => {
    element.hidden = element.dataset.range !== controls.rangeMode.value;
  });
}

function showNotice(message) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
}

function updateUrl() {
  const search = queryStateToSearch(state.query);
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}

function requestUrl(pathname, range) {
  const params = new URLSearchParams({
    mode: range.mode,
    search: state.query.search,
    sort: state.query.sort,
    offset: String(state.page.offset),
    limit: String(state.page.limit),
  });
  if (range.fromMs != null) params.set('from', String(range.fromMs));
  if (range.toMs != null) params.set('to', String(range.toMs));
  return `${pathname}?${params}`;
}

async function load({ sessionsOnly = false, announceRefresh = false } = {}) {
  syncState();
  const { requestedRange, range } = currentRange();
  if (!requestedRange.valid) {
    render();
    return;
  }
  const requestId = ++activeRequest;
  const hadData = Boolean(state.source.data);
  state.source.status = hadData ? 'refreshing' : 'loading';
  state.source.error = '';
  $('refresh').disabled = true;
  $('refresh').textContent = hadData ? '重新掃描中…' : '解析中…';
  render();
  try {
    const response = await fetch(requestUrl(sessionsOnly ? '/api/sessions' : '/api/dashboard', range), { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    if (requestId !== activeRequest) return;
    state.source = {
      data: sessionsOnly ? { ...state.source.data, ...payload } : payload,
      status: 'ready',
      error: '',
    };
    state.view.drawerSession = null;
    state.view.drawerTrigger = null;
    if (!sessionsOnly) renderPricing(payload);
    render();
    if (announceRefresh) showNotice(`已重新掃描 ${integerFormat.format(payload.scannedFileCount)} 個 JSONL，耗時 ${integerFormat.format(payload.durationMs)} ms。`);
  } catch (error) {
    if (requestId !== activeRequest) return;
    state.source.status = 'error';
    state.source.error = readableLoadError(error);
    render();
  } finally {
    if (requestId === activeRequest) {
      if (state.source.data) state.source.status = 'ready';
      $('summary').setAttribute('aria-busy', 'false');
      $('refresh').disabled = false;
      $('refresh').textContent = '重新解析 JSONL';
    }
  }
}

function queryChanged({ defer = false } = {}) {
  window.clearTimeout(searchTimer);
  const apply = () => {
    syncState();
    const range = resolveRange(state.query);
    renderRangeErrors(range);
    if (!range.valid) {
      render();
      return;
    }
    state.page.offset = 0;
    updateUrl();
    load();
  };
  if (defer) searchTimer = window.setTimeout(apply, 250);
  else apply();
}

function viewChanged() {
  syncState({ persistView: true });
  render();
}

function initialiseInputs() {
  const now = new Date();
  controls.monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  controls.weekInput.value = isoWeekValue(now);
  controls.yearInput.value = String(now.getFullYear());
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  controls.customStart.value = localDateTimeValue(start);
  controls.customEnd.value = localDateTimeValue(now);
  defaultQuery = readQueryState(controls);
  applyQueryStateToControls(controls, queryStateFromSearch(defaultQuery, window.location.search));
  applyViewPreferencesToControls(controls, readViewPreferences(window.localStorage));
  syncState();
  state.lastValidRange = resolveRange(state.query);
  updateRangeControls();
}

for (const input of [controls.weekInput, controls.monthInput, controls.yearInput, controls.customStart, controls.customEnd, controls.sort]) {
  input.addEventListener('change', () => queryChanged());
}
controls.search.addEventListener('input', () => queryChanged({ defer: true }));
controls.rangeMode.addEventListener('change', () => { updateRangeControls(); queryChanged(); });
for (const input of [controls.unit, controls.showExact, controls.showDetails, controls.trendMetric, controls.density, controls.columnLastUsed, controls.columnModel, controls.columnInput, controls.columnOutput, controls.columnCost]) {
  input.addEventListener('change', viewChanged);
}
$('clearSearch').addEventListener('click', () => { controls.search.value = ''; queryChanged(); controls.search.focus(); });
$('refresh').addEventListener('click', () => { state.page.offset = 0; load({ announceRefresh: true }); });
$('pagePrevious').addEventListener('click', () => { state.page.offset = Math.max(0, state.page.offset - state.page.limit); load({ sessionsOnly: true }); });
$('pageNext').addEventListener('click', () => { state.page.offset += state.page.limit; load({ sessionsOnly: true }); });
window.addEventListener('popstate', () => {
  applyQueryStateToControls(controls, queryStateFromSearch(defaultQuery, window.location.search));
  state.page.offset = 0;
  updateRangeControls();
  load();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (state.view.drawerSession) { event.preventDefault(); drawerController.close(); return; }
  const hadSearch = Boolean(controls.search.value);
  const menuWasOpen = $('viewMenu').open;
  if (hadSearch) controls.search.value = '';
  if (menuWasOpen) $('viewMenu').open = false;
  if (hadSearch) { event.preventDefault(); queryChanged(); }
  else if (menuWasOpen) { event.preventDefault(); render(); }
});
$('rows').addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-session-index]');
  const session = row && state.derived?.explorerSessions?.[Number(row.dataset.sessionIndex)];
  if (session) drawerController.open(session, event.target.closest('button') || row);
});
$('rows').addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const row = event.target.closest('tr[data-session-index]');
  const session = row && state.derived?.explorerSessions?.[Number(row.dataset.sessionIndex)];
  if (session) { event.preventDefault(); drawerController.open(session, row); }
});
drawerController.bind();
initialiseInputs();
load();
