import { escapeHtml, formatDate, integerFormat, isoWeekValue, localDateTimeValue, moneyFormat } from './format.mjs';
import {
  aggregateSessions,
  createDashboardState,
  deriveSessions,
  qualityMessages,
  readQueryState,
  readViewState,
  resolveRange,
  selectExplorerSessions,
} from './state.mjs';
import { createSessionDrawerController } from './drawer-controller.mjs';
import { renderExplorerRows } from './explorer.mjs';
import { buildModelBreakdown, renderModelBreakdown } from './model-breakdown.mjs';
import { buildTrendSeries, renderUsageTrend } from './trend.mjs';

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

function syncState() {
  const { drawerSession, drawerTrigger } = state.view;
  state.query = readQueryState(controls);
  state.view = { ...readViewState(controls), drawerSession, drawerTrigger };
  document.body.classList.toggle('show-exact', state.view.showExact);
  document.body.classList.toggle('show-details', state.view.showDetails);
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
  return message.startsWith('Sessions directory does not exist:')
    ? '找不到 sessions 目錄。請確認本機 Codex sessions 設定後重試。'
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
  $('explorerCount').textContent = `顯示 ${integerFormat.format(sessions.length)} / ${integerFormat.format(data.length)} sessions`;
  $('clearSearch').hidden = !query;
  $('rows').innerHTML = renderExplorerRows(sessions, { pricing: state.source.data.pricing, selectedFile: state.view.drawerSession?.file, unit: state.view.unit });
  const empty = $('empty');
  empty.hidden = sessions.length !== 0;
  empty.textContent = query && data.length ? '找不到符合搜尋條件的 session。按 Escape 或使用「清除搜尋」返回完整表格。' : `此範圍（${range.label}）沒有 token 使用紀錄。`;
}

function applyExplorerView() {
  document.body.dataset.tableDensity = state.view.density;
  document.querySelectorAll('[data-column]').forEach((element) => {
    element.hidden = state.view.visibleColumns[element.dataset.column] === false;
  });
}

function renderLoaded(data) {
  syncState();
  const requestedRange = resolveRange(state.query);
  renderRangeErrors(requestedRange);
  if (requestedRange.valid) state.lastValidRange = requestedRange;
  const range = state.lastValidRange || requestedRange;
  const rangedSessions = deriveSessions(data, range);
  const totals = aggregateSessions(rangedSessions);
  const explorerSessions = selectExplorerSessions(rangedSessions, state.query);
  state.derived = { explorerSessions };
  const usingPreviousRange = !requestedRange.valid && state.lastValidRange;
  $('rangeLabel').textContent = usingPreviousRange ? `${requestedRange.label}（未套用）` : range.label;
  $('rangeDetail').textContent = usingPreviousRange ? `請修正日期；目前仍顯示 ${rangeDetail(range)}` : rangeDetail(range);
  $('info').innerHTML = `<span>來源：<code>local sessions root</code></span><span>範圍內 sessions：${integerFormat.format(rangedSessions.length)}</span><span>JSONL：${integerFormat.format(data.scannedFileCount)}</span><span>解析：${integerFormat.format(data.durationMs)} ms</span><span>定價版本：${escapeHtml(data.pricing.updatedAt)}</span>`;
  renderTotals(totals.usage, totals.cost);
  renderQuality(data, totals.cost);
  renderUsageTrend($('usageTrend'), buildTrendSeries(rangedSessions, data.pricing, range), state.view.trendMetric);
  renderModelBreakdown($('modelBreakdown'), buildModelBreakdown(rangedSessions, data.pricing), state.view.trendMetric);
  renderExplorer(explorerSessions, rangedSessions, range);
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
}

function render() {
  const data = state.source.data;
  $('summary').setAttribute('aria-busy', String(state.source.status === 'loading' || state.source.status === 'refreshing'));
  if (data) renderLoaded(data);
  else renderEmptySource();
}

function updateRangeControls() {
  document.querySelectorAll('.range-control').forEach((element) => { element.hidden = element.dataset.range !== controls.rangeMode.value; });
  render();
}

function showNotice(message) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
}

async function load() {
  const hadData = Boolean(state.source.data);
  state.source.status = hadData ? 'refreshing' : 'loading';
  state.source.error = '';
  $('refresh').disabled = true;
  $('refresh').textContent = hadData ? '重新掃描中…' : '解析中…';
  render();
  try {
    const response = await fetch('/api/summary', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    state.source = { data: payload, status: 'ready', error: '' };
    state.view.drawerSession = null;
    state.view.drawerTrigger = null;
    renderPricing(payload);
    render();
    if (hadData) showNotice(`已重新掃描 ${integerFormat.format(payload.scannedFileCount)} 個 JSONL，耗時 ${integerFormat.format(payload.durationMs)} ms。`);
  } catch (error) {
    state.source.status = 'error';
    state.source.error = readableLoadError(error);
    render();
  } finally {
    if (state.source.data) state.source.status = 'ready';
    $('summary').setAttribute('aria-busy', 'false');
    $('refresh').disabled = false;
    $('refresh').textContent = '重新解析 JSONL';
  }
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
  updateRangeControls();
}

for (const input of [controls.search, controls.sort, controls.unit, controls.showExact, controls.showDetails, controls.trendMetric, controls.density, controls.columnLastUsed, controls.columnModel, controls.columnInput, controls.columnOutput, controls.columnCost, controls.weekInput, controls.monthInput, controls.yearInput, controls.customStart, controls.customEnd]) {
  input.addEventListener(input === controls.search ? 'input' : 'change', render);
}
controls.rangeMode.addEventListener('change', updateRangeControls);
$('clearSearch').addEventListener('click', () => { controls.search.value = ''; render(); controls.search.focus(); });
$('refresh').addEventListener('click', load);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (state.view.drawerSession) { event.preventDefault(); drawerController.close(); return; }
  const hadSearch = Boolean(controls.search.value);
  const menuWasOpen = $('viewMenu').open;
  if (hadSearch) controls.search.value = '';
  if (menuWasOpen) $('viewMenu').open = false;
  if (hadSearch || menuWasOpen) { event.preventDefault(); render(); }
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
