import {
  addUsage,
  escapeHtml,
  formatDate,
  integerFormat,
  isoWeekValue,
  localDateTimeValue,
  moneyFormat,
  text,
  zeroUsage,
} from './format.mjs';
import {
  aggregateSessions,
  createDashboardState,
  deriveSessions,
  findRate,
  qualityMessages,
  readQueryState,
  readViewState,
  resolveRange,
  selectExplorerSessions,
} from './state.mjs';

const state = createDashboardState();
const $ = (id) => document.getElementById(id);
const controls = Object.freeze({
  rangeMode: $('rangeMode'), weekInput: $('weekInput'), monthInput: $('monthInput'), yearInput: $('yearInput'),
  customStart: $('customStart'), customEnd: $('customEnd'), search: $('search'), sort: $('sort'),
  unit: $('unit'), showExact: $('showExact'), showDetails: $('showDetails'),
});

function syncState() {
  state.query = readQueryState(controls);
  state.view = readViewState(controls);
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

function tokenCell(value, strong = false) {
  const main = strong ? `<strong>${compactNumber(value)}</strong>` : compactNumber(value);
  return `${main}<span class="cell-exact">${integerFormat.format(value || 0)}</span>`;
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
  $('rows').innerHTML = sessions.map((session) => {
    const usage = session.filteredUsage;
    const cost = session.filteredCost;
    const modelClass = findRate(state.source.data.pricing, session.model) ? 'pill' : 'pill unknown';
    const invalid = session.invalidLineCount ? ` · invalid ${integerFormat.format(session.invalidLineCount)}` : '';
    const duplicate = session.duplicateTokenCountEventCount ? ` · duplicate ${integerFormat.format(session.duplicateTokenCountEventCount)}` : '';
    return `<tr><td>${escapeHtml(formatDate(session.filteredLastTimestamp || session.lastTimestamp || session.modifiedAt))}</td><td class="session" title="${escapeHtml(session.file)}"><strong>${escapeHtml(text(session.sessionId))}</strong><br /><span class="muted">${escapeHtml(session.file)}</span><br /><span class="usage-source">${escapeHtml(session.usageSource)}</span></td><td class="session" title="${escapeHtml(session.cwd || '')}"><span class="${modelClass}">${escapeHtml(text(session.model))}</span><br /><span class="muted">${escapeHtml(text(session.cwd))}</span></td><td>${tokenCell(usage.inputTokens)}</td><td class="detail-col">${tokenCell(usage.cachedInputTokens)}</td><td class="detail-col">${tokenCell(usage.uncachedInputTokens)}</td><td class="detail-col">${tokenCell(usage.cacheWriteTokens)}</td><td>${tokenCell(usage.outputTokens)}</td><td class="detail-col">${tokenCell(usage.reasoningOutputTokens)}</td><td>${tokenCell(usage.totalTokens, true)}</td><td><strong>${escapeHtml(costText(cost))}</strong></td><td class="detail-col usage-source">Input ${moneyFormat.format(cost.input)}<br />Cached ${moneyFormat.format(cost.cached)}<br />Output ${moneyFormat.format(cost.output)}${cost.unknownModels.size ? '<br /><span class="warning">部分未定價</span>' : ''}</td><td class="detail-col">${integerFormat.format(session.lineCount)}<span class="usage-source">${invalid}${duplicate}</span></td></tr>`;
  }).join('');
  const empty = $('empty');
  empty.hidden = sessions.length !== 0;
  empty.textContent = query && data.length ? '找不到符合搜尋條件的 session。按 Escape 或使用「清除搜尋」返回完整表格。' : `此範圍（${range.label}）沒有 token 使用紀錄。`;
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
  const usingPreviousRange = !requestedRange.valid && state.lastValidRange;
  $('rangeLabel').textContent = usingPreviousRange ? `${requestedRange.label}（未套用）` : range.label;
  $('rangeDetail').textContent = usingPreviousRange ? `請修正日期；目前仍顯示 ${rangeDetail(range)}` : rangeDetail(range);
  $('info').innerHTML = `<span>來源：<code>local sessions root</code></span><span>範圍內 sessions：${integerFormat.format(rangedSessions.length)}</span><span>JSONL：${integerFormat.format(data.scannedFileCount)}</span><span>解析：${integerFormat.format(data.durationMs)} ms</span><span>定價版本：${escapeHtml(data.pricing.updatedAt)}</span>`;
  renderTotals(totals.usage, totals.cost);
  renderQuality(data, totals.cost);
  renderExplorer(explorerSessions, rangedSessions, range);
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

for (const input of [controls.search, controls.sort, controls.unit, controls.showExact, controls.showDetails, controls.weekInput, controls.monthInput, controls.yearInput, controls.customStart, controls.customEnd]) {
  input.addEventListener(input === controls.search ? 'input' : 'change', render);
}
controls.rangeMode.addEventListener('change', updateRangeControls);
$('clearSearch').addEventListener('click', () => { controls.search.value = ''; render(); controls.search.focus(); });
$('refresh').addEventListener('click', load);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const hadSearch = Boolean(controls.search.value);
  const menuWasOpen = $('viewMenu').open;
  if (hadSearch) controls.search.value = '';
  if (menuWasOpen) $('viewMenu').open = false;
  if (hadSearch || menuWasOpen) { event.preventDefault(); render(); }
});
initialiseInputs();
load();
