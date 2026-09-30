import { chartDomain, comparisonFixture, nearestBucketIndex, snappedInterval } from './chart-geometry.mjs';
import { CHART_HEIGHT, CHART_PADDING, createChartRenderer } from './chart-renderers.mjs';
import { escapeHtml, formatCost, integerFormat } from './format.mjs';
import { applyDocumentTranslations, detectLocale, getLocale, setLocale, t } from './i18n.mjs';
import { createDashboardState, providerFromSearch, queryStateFromSearch, queryStateToSearch, requestParameters } from './state.mjs';
import { createRequestChannels } from './request-channels.mjs';
import { setButtonBusy, translateButtonLabels } from './button-state.mjs';

const $ = (id) => document.getElementById(id);
const channels = createRequestChannels();
const defaults = createDashboardState().query;
defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
defaults.monthValue = new Date().toISOString().slice(0, 7);
const query = queryStateFromSearch(defaults, location.search);
const provider = providerFromSearch(location.search);
const baselineSearch = queryStateToSearch(query, provider);
let parameters = requestParameters(query, { limit: 100 }, provider);
const incoming = new URLSearchParams(location.search);
if (incoming.has('from') && incoming.has('to')) { parameters.set('mode', 'custom'); parameters.delete('start'); parameters.delete('end'); parameters.set('from', incoming.get('from')); parameters.set('to', incoming.get('to')); }
let liveSource;
let source = { points: [], timezone: query.timezone };
let selectedTime;
let selectedInterval;
let domain = [0, 1];
let status = 'loading';
let renderers = [];
let frames = [];
let previewIndex = -1;
let pointerFrame = 0;
let dragStart;
let generation = 0;
let measureBusy = false;
const priorQueries = [];
const paintTimes = [];
let paintCount = 0;
const measurements = new Map();
const PREFERENCE_KEY = 'codex-token-dashboard:chart-comparison:v1';

function metricLabel(metric) { return metric === 'cost' ? `${t('trend.cost')} · USD` : t('total.tokens'); }
function boundaryText(value) { return new Intl.DateTimeFormat(getLocale(), { timeZone: source.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(value); }
function intervalText(point) { return `${boundaryText(point.fromMs)} → ${boundaryText(point.toMs)} · ${source.timezone} · [from,to)`; }
function intervalOption(point) { return boundaryText(point.fromMs); }
function selectedIndex() { return source.points.findIndex((point) => point.fromMs === selectedTime); }
function view() { return { engine: $('compareEngine').value, mode: $('compareMode').value, metric: $('compareMetric').value, mark: $('compareMark').value }; }
function persistView() { try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(view())); } catch {} }
function setStatus(message, state = 'info') { $('compareStatus').textContent = message; $('compareStatus').dataset.state = state; }
function updateActions() {
  $('comparePlots').setAttribute('aria-busy', String(status === 'loading'));
  $('comparisonProjection').setAttribute('aria-busy', String(status === 'loading'));
  const unavailable = !source.points.length || status === 'loading' || measureBusy;
  $('intervalFrom').disabled = unavailable; $('intervalTo').disabled = unavailable;
  $('zoomInterval').disabled = unavailable || !selectedInterval;
  $('resetZoom').disabled = unavailable || domain.every((value, index) => value === chartDomain(source.points)[index]);
  $('applyInterval').disabled = unavailable || !selectedInterval || status !== 'ready' || $('compareData').value !== 'live';
  $('returnQuery').disabled = !priorQueries.length || status === 'loading' || measureBusy;
  $('measureChart').disabled = unavailable;
  $('compareMetric').disabled = $('compareMode').value !== 'single';
  for (const id of ['compareEngine', 'compareMode', 'compareMark', 'compareData', 'compareLocale']) $(id).disabled = measureBusy;
  if (measureBusy) $('compareMetric').disabled = true;
}

function setInterval(interval) {
  selectedInterval = interval;
  if (interval) {
    $('intervalFrom').value = String(source.points.findIndex((point) => point.fromMs === interval[0]));
    $('intervalTo').value = String(source.points.findIndex((point) => point.toMs === interval[1]));
    $('intervalLabel').textContent = `${boundaryText(interval[0])} → ${boundaryText(interval[1])} · ${source.timezone} · [from,to)`;
  } else $('intervalLabel').textContent = '';
  updateOverlays(); updateActions();
}

function updateOverlays() {
  const point = source.points[previewIndex >= 0 ? previewIndex : selectedIndex()];
  for (const frame of frames) {
    const width = frame.root.getBoundingClientRect().width - CHART_PADDING.left - CHART_PADDING.right;
    const x = (time) => CHART_PADDING.left + (time - domain[0]) / (domain[1] - domain[0]) * width;
    frame.cursor.hidden = !point || point.toMs <= domain[0] || point.fromMs >= domain[1];
    if (point) frame.cursor.style.left = `${x((point.fromMs + point.toMs) / 2)}px`;
    frame.tooltip.hidden = previewIndex < 0;
    if (previewIndex >= 0 && point) {
      frame.tooltip.textContent = `${intervalOption(point)} · ${integerFormat.format(point.tokens)} tokens · ${formatCost(point.cost, point.partialCost)}`;
      frame.tooltip.style.left = `${Math.min(Math.max(CHART_PADDING.left, x(point.fromMs)), Math.max(CHART_PADDING.left, width - 240))}px`;
    }
    const start = selectedInterval && Math.max(domain[0], selectedInterval[0]);
    const end = selectedInterval && Math.min(domain[1], selectedInterval[1]);
    frame.brush.hidden = !selectedInterval || end <= start;
    if (!frame.brush.hidden) { frame.brush.style.left = `${x(start)}px`; frame.brush.style.width = `${x(end) - x(start)}px`; }
  }
}

function readout(announce = false) {
  const point = source.points[selectedIndex()];
  $('compareReadout').replaceChildren();
  if (!point) { $('compareReadout').textContent = t('trend.empty'); return; }
  const heading = document.createElement('strong'); heading.textContent = intervalText(point);
  const values = document.createElement('p'); values.textContent = `${t('total.tokens')}: ${integerFormat.format(point.tokens)} · ${t('trend.cost')}: ${formatCost(point.cost, point.partialCost)}`;
  $('compareReadout').append(heading, values);
  if (announce) $('compareAnnouncement').textContent = `${heading.textContent} ${values.textContent}`;
  updateOverlays();
}

function pin(index, announce = true) {
  if (index < 0) return;
  previewIndex = -1; selectedTime = source.points[index].fromMs; readout(announce);
}

function pointerTimestamp(event, root) {
  const rect = root.getBoundingClientRect(); const x = event.clientX - rect.left;
  return domain[0] + Math.max(0, Math.min(1, (x - CHART_PADDING.left) / (rect.width - CHART_PADDING.left - CHART_PADDING.right))) * (domain[1] - domain[0]);
}

function createFrame(metrics) {
  const legend = document.createElement('p'); legend.className = 'comparison-series';
  for (const [index, metric] of metrics.entries()) { const label = document.createElement('span'); label.dataset.metric = metric; label.textContent = `${metricLabel(metric)}${index ? ` · ${t(view().mark === 'bar' ? 'compare.outline' : 'compare.dashed')}` : ''}`; legend.append(label); }
  const root = document.createElement('div'); root.className = 'comparison-frame'; root.tabIndex = 0; root.setAttribute('role', 'group'); root.setAttribute('aria-label', metrics.map(metricLabel).join(' / ')); root.setAttribute('aria-describedby', 'compareHelp compareReadout');
  const host = document.createElement('div'); host.className = 'comparison-plot'; host.setAttribute('aria-hidden', 'true');
  const cursor = document.createElement('div'); cursor.className = 'comparison-cursor'; cursor.hidden = true;
  const brush = document.createElement('div'); brush.className = 'comparison-brush'; brush.hidden = true;
  const tooltip = document.createElement('div'); tooltip.className = 'comparison-tooltip'; tooltip.hidden = true;
  root.append(host, brush, cursor, tooltip); $('comparePlots').append(legend, root);
  const renderer = createChartRenderer(host, view().engine, (elapsed) => { paintCount += 1; paintTimes.push(elapsed); if (paintTimes.length > 100) paintTimes.shift(); });
  root.addEventListener('pointerdown', (event) => {
    const y = event.clientY - root.getBoundingClientRect().top;
    if (event.button !== 0 || !source.points.length || y < CHART_PADDING.top || y > CHART_HEIGHT - CHART_PADDING.bottom) return;
    root.focus(); root.setPointerCapture(event.pointerId); dragStart = { time: pointerTimestamp(event, root), x: event.clientX };
  });
  root.addEventListener('pointermove', (event) => {
    const time = pointerTimestamp(event, root); const index = nearestBucketIndex(source.points, time);
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; if (index !== previewIndex) { previewIndex = index; updateOverlays(); } if (dragStart && Math.abs(event.clientX - dragStart.x) > 5) setInterval(snappedInterval(source.points, dragStart.time, time)); });
  });
  root.addEventListener('pointerup', (event) => {
    if (!dragStart) return;
    if (pointerFrame) { cancelAnimationFrame(pointerFrame); pointerFrame = 0; }
    const time = pointerTimestamp(event, root);
    if (Math.abs(event.clientX - dragStart.x) > 5) setInterval(snappedInterval(source.points, dragStart.time, time));
    pin(nearestBucketIndex(source.points, time)); dragStart = null;
  });
  root.addEventListener('pointercancel', () => { dragStart = null; });
  root.addEventListener('pointerleave', () => { if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0; previewIndex = -1; updateOverlays(); });
  root.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); let index = selectedIndex();
    if (event.key === 'Escape') { previewIndex = -1; updateOverlays(); return; }
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = source.points.length - 1;
    if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    if (event.key === 'ArrowRight') index = Math.min(source.points.length - 1, index + 1);
    pin(index);
  });
  frames.push({ root, host, cursor, brush, tooltip, metrics, renderer }); renderers.push(renderer);
}

function drawFrames() {
  for (const frame of frames) frame.renderer.update({ points: source.points, metrics: frame.metrics, domain, mark: view().mark, timezone: source.timezone });
  updateOverlays();
}

function rebuildPlots() {
  const active = frames.some((frame) => frame.root === document.activeElement);
  for (const renderer of renderers) renderer.destroy(); renderers = []; frames = [];
  $('comparePlots').replaceChildren(); previewIndex = -1; dragStart = null;
  if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0;
  if (source.points.length) {
    const { mode, metric } = view();
    if (mode === 'stacked') { createFrame(['tokens']); createFrame(['cost']); }
    else createFrame(mode === 'dual' ? ['tokens', 'cost'] : [metric]);
    drawFrames();
    if (active) frames[0].root.focus();
  }
  readout(); updateActions();
}

function sourceChanged(next) {
  source = next; domain = chartDomain(source.points); selectedInterval = null;
  if (!source.points.some((point) => point.fromMs === selectedTime)) selectedTime = source.points.at(-1)?.fromMs;
  for (const select of [$('intervalFrom'), $('intervalTo')]) {
    select.replaceChildren(...source.points.map((point, index) => new Option(intervalOption(point), String(index))));
  }
  $('intervalFrom').value = '0'; $('intervalTo').value = String(source.points.length - 1);
  $('intervalLabel').textContent = '';
  $('comparisonRows').innerHTML = source.points.map((point) => `<tr><td>${escapeHtml(intervalText(point))}</td><td>${integerFormat.format(point.tokens)}</td><td>${escapeHtml(formatCost(point.cost, point.partialCost))}</td></tr>`).join('');
  $('compareScope').textContent = `${source.points.length} ${t('compare.buckets')} · ${source.timezone}${view().mode === 'dual' ? ` · ${t('compare.dualHint')}` : ''}`;
  rebuildPlots();
}

function projection() {
  const live = $('compareData').value === 'live' && liveSource;
  $('comparisonSessions').replaceChildren(); $('comparisonModels').textContent = '';
  if (!live) { $('comparisonProjection').textContent = t('compare.test'); return; }
  const data = liveSource;
  const period = data.range.fromMs != null && data.range.toMs != null ? `${boundaryText(data.range.fromMs)} → ${boundaryText(data.range.toMs)}` : t('range.all');
  $('comparisonProjection').textContent = `${period} · ${data.range.timezone} · ${data.range.interval} · ${integerFormat.format(data.totals.totalTokens)} tokens · ${formatCost(data.cost.total, data.cost.partial || data.cost.pricingCoverage?.partial)} · ${data.sessionCount} sessions`;
  $('comparisonModels').textContent = (data.models || []).map((model) => `${model.model}: ${integerFormat.format(model.tokens)} tokens / ${formatCost(model.cost, model.partialCost)}`).join(' · ');
  $('comparisonSessions').innerHTML = (data.sessions || []).map((session) => `<tr><td>${escapeHtml(session.sessionId || session.sessionKey)}</td><td>${escapeHtml(session.model)}</td><td>${integerFormat.format(session.usage?.totalTokens)}</td><td>${escapeHtml(formatCost(session.cost?.total, session.cost?.pricingCoverage?.partial))}</td></tr>`).join('');
}

async function loadLive(nextParameters = parameters) {
  const current = ++generation; status = 'loading'; setStatus(t('load.loading')); updateActions();
  try {
    const result = await channels.request('comparison', `/api/dashboard?${nextParameters}`);
    if (result.stale || current !== generation) return false;
    parameters = new URLSearchParams(nextParameters); liveSource = result.payload; status = 'ready';
    if ($('compareData').value === 'live') {
      sourceChanged({ points: liveSource.trend.points, timezone: liveSource.range.timezone }); projection();
      setStatus(t('compare.liveStatus'));
      const url = new URLSearchParams(baselineSearch);
      if (parameters.has('from')) { url.set('from', parameters.get('from')); url.set('to', parameters.get('to')); }
      history.replaceState(null, '', `${location.pathname}?${url}`);
    }
    return true;
  } catch (error) {
    if (error?.name === 'AbortError' || current !== generation) return false;
    status = 'error'; setStatus(`${t(liveSource ? 'compare.retained' : 'load.error')} ${error.message}`, 'error'); updateActions(); return false;
  }
}

for (const id of ['compareEngine', 'compareMode', 'compareMetric', 'compareMark']) $(id).addEventListener('change', () => {
  persistView(); $('compareScope').textContent = `${source.points.length} ${t('compare.buckets')} · ${source.timezone}${view().mode === 'dual' ? ` · ${t('compare.dualHint')}` : ''}`; rebuildPlots();
});
$('compareData').addEventListener('change', async () => {
  channels.abort('comparison'); generation += 1;
  if ($('compareData').value === 'live') { await loadLive(); return; }
  status = 'test'; setStatus(t('compare.test'), 'test'); sourceChanged(comparisonFixture($('compareData').value)); projection();
});
for (const id of ['intervalFrom', 'intervalTo']) $(id).addEventListener('change', () => {
  const first = Number($('intervalFrom').value); const last = Number($('intervalTo').value);
  const low = Math.min(first, last); const high = Math.max(first, last);
  setInterval([source.points[low].fromMs, source.points[high].toMs]);
});
$('zoomInterval').addEventListener('click', () => { if (!selectedInterval) return; domain = [...selectedInterval]; drawFrames(); updateActions(); });
$('resetZoom').addEventListener('click', () => { domain = chartDomain(source.points); drawFrames(); updateActions(); });
$('applyInterval').addEventListener('click', async () => {
  if (status !== 'ready' || !selectedInterval || $('compareData').value !== 'live') return;
  const prior = new URLSearchParams(parameters); const next = new URLSearchParams(parameters);
  next.set('mode', 'custom'); next.set('from', String(selectedInterval[0])); next.set('to', String(selectedInterval[1]));
  for (const key of ['period', 'start', 'end']) next.delete(key);
  const hadFocus = document.activeElement === $('applyInterval');
  if (await loadLive(next)) priorQueries.push(prior);
  updateActions();
  if (hadFocus && document.activeElement === document.body) $('intervalFrom').focus();
});
$('returnQuery').addEventListener('click', async () => { const hadFocus = document.activeElement === $('returnQuery'); if (priorQueries.length && await loadLive(priorQueries.at(-1))) priorQueries.pop(); updateActions(); if (hadFocus && document.activeElement === document.body) $('intervalFrom').focus(); });
$('compareLocale').addEventListener('change', () => {
  const saved = { time: selectedTime, interval: selectedInterval, domain: [...domain] };
  setLocale($('compareLocale').value); applyDocumentTranslations(); document.title = `${t('compare.title')} · ${t('compare.eyebrow')}`; translateButtonLabels(); sourceChanged(source);
  selectedTime = saved.time; selectedInterval = saved.interval; domain = saved.domain; readout(); setInterval(saved.interval); drawFrames(); projection();
  setStatus(t(status === 'test' ? 'compare.test' : status === 'ready' ? 'compare.liveStatus' : 'load.loading'), status === 'test' ? 'test' : 'info');
});
$('measureChart').addEventListener('click', async () => {
  if (!source.points.length || measureBusy) return;
  measureBusy = true; setButtonBusy($('measureChart'), true); updateActions();
  const samples = []; const current = view(); const initialPaintCount = paintCount;
  try {
    for (let index = 0; index < 20; index += 1) {
      const priorPaintCount = paintCount;
      drawFrames(); await new Promise(requestAnimationFrame);
      if (paintCount - priorPaintCount < frames.length) throw new Error('A draw callback did not complete.');
      samples.push(paintTimes.slice(-frames.length).reduce((sum, elapsed) => sum + elapsed, 0));
    }
    samples.sort((left, right) => left - right);
    const label = `${current.engine} / ${current.mode} / ${current.mark} / ${source.points.length}`;
    measurements.set(label, `${label}: median ${samples[10].toFixed(2)} ms · p95 ${samples[18].toFixed(2)} ms · ${paintCount - initialPaintCount} draw callbacks`);
    $('comparisonMeasurements').textContent = [...measurements.values()].join(' | ');
  } catch (error) {
    $('comparisonMeasurements').textContent = `${t('compare.measureFailed')} ${error.message}`;
  } finally {
    measureBusy = false; setButtonBusy($('measureChart'), false); updateActions();
  }
});
const observer = new ResizeObserver(() => { if (source.points.length && frames.length && !measureBusy) drawFrames(); });
observer.observe($('comparePlots'));
window.addEventListener('beforeunload', () => { observer.disconnect(); channels.destroy(); renderers.forEach((renderer) => renderer.destroy()); if (pointerFrame) cancelAnimationFrame(pointerFrame); });

setLocale(detectLocale(localStorage, navigator.languages)); $('compareLocale').value = getLocale();
try { const saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}'); for (const [id, key, allowed] of [['compareEngine', 'engine', ['native', 'uplot']], ['compareMode', 'mode', ['single', 'stacked', 'dual']], ['compareMetric', 'metric', ['cost', 'tokens']], ['compareMark', 'mark', ['bar', 'line']]]) if (allowed.includes(saved[key])) $(id).value = saved[key]; } catch {}
applyDocumentTranslations(); document.title = `${t('compare.title')} · ${t('compare.eyebrow')}`; $('dashboardReturn').href = `/?${baselineSearch}`; setButtonBusy($('measureChart'), false);
void loadLive();
