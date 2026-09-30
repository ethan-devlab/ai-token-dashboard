import { chartDomain, nearestBucketIndex, snappedInterval } from './chart-geometry.mjs';
import { CHART_HEIGHT, CHART_PADDING, createChartRenderer } from './chart-renderer.mjs';
import { escapeHtml, formatCost, formatIntervalBoundary, integerFormat } from './format.mjs';
import { getLocale, t } from './i18n.mjs';

export function createUsageTrendController(host, { onApplyInterval, onReturnQuery }) {
  host.innerHTML = `<p class="trend-summary" data-summary></p><p id="trendHelp" class="trend-help"></p><div data-plots></div><div id="trendReadout" class="trend-readout"></div><p class="visually-hidden" role="status" data-announcement></p><div class="control-row trend-interval"><label class="control"><span data-from-label></span><select data-from></select></label><label class="control"><span data-to-label></span><select data-to></select></label><button type="button" data-zoom></button><button type="button" data-reset></button><button type="button" class="button--primary" data-apply></button><button type="button" data-return></button></div><p class="trend-interval-label muted" data-interval-label></p><details class="trend-table"><summary></summary><div class="trend-table-wrap"><table><thead><tr><th data-time-heading></th><th data-token-heading></th><th data-cost-heading></th></tr></thead><tbody></tbody></table></div></details>`;
  const find = (name) => host.querySelector(`[data-${name}]`);
  const plots = find('plots'); const readout = host.querySelector('#trendReadout');
  const fromSelect = find('from'); const toSelect = find('to');
  let options = { trend: { points: [] }, timezone: 'UTC', mode: 'single', mark: 'bar', metric: 'cost', canApply: false, canReturn: false };
  let points = []; let domain = [0, 1]; let selectedTime; let interval; let previewIndex = -1;
  let frames = []; let pointerFrame = 0; let dragStart; let scopeKey; let dataKey; let presentationKey; let destroyed = false;
  const selectedIndex = () => points.findIndex((point) => point.fromMs === selectedTime);
  const boundary = (value) => formatIntervalBoundary(value, options.timezone);
  const intervalText = (bounds) => `${boundary(bounds[0])} → ${boundary(bounds[1])} · ${options.timezone} · [from,to)`;
  const metricLabel = (metric) => `${t(metric === 'cost' ? 'trend.cost' : 'total.tokens')}${metric === 'cost' ? ' · USD' : ''}`;

  function actions() {
    const unavailable = !points.length || options.busy;
    fromSelect.disabled = unavailable; toSelect.disabled = unavailable;
    find('zoom').disabled = unavailable || !interval;
    find('reset').disabled = unavailable || domain.every((value, index) => value === chartDomain(points)[index]);
    find('apply').disabled = unavailable || !interval || !options.canApply;
    find('return').disabled = options.busy || !options.canReturn;
    plots.setAttribute('aria-busy', String(Boolean(options.busy)));
  }
  function overlays() {
    const point = points[previewIndex >= 0 ? previewIndex : selectedIndex()];
    for (const frame of frames) {
      const width = frame.root.getBoundingClientRect().width - CHART_PADDING.left - CHART_PADDING.right;
      const x = (time) => CHART_PADDING.left + (time - domain[0]) / (domain[1] - domain[0]) * width;
      const middle = point && (point.fromMs + point.toMs) / 2;
      frame.cursor.hidden = !point || middle < domain[0] || middle > domain[1];
      if (!frame.cursor.hidden) frame.cursor.style.left = `${x(middle)}px`;
      frame.tooltip.hidden = previewIndex < 0;
      if (previewIndex >= 0 && point) {
        frame.tooltip.textContent = `${boundary(point.fromMs)} · ${integerFormat.format(point.tokens)} ${t('total.tokens')} · ${formatCost(point.cost, point.partialCost)}`;
        frame.tooltip.style.left = `${Math.min(Math.max(0, x(point.fromMs)), Math.max(0, frame.root.clientWidth - 270))}px`;
      }
      const start = interval && Math.max(domain[0], interval[0]); const end = interval && Math.min(domain[1], interval[1]);
      frame.brush.hidden = !interval || end <= start;
      if (!frame.brush.hidden) { frame.brush.style.left = `${x(start)}px`; frame.brush.style.width = `${x(end) - x(start)}px`; }
    }
  }
  function selection(announce = false) {
    const point = points[selectedIndex()];
    readout.replaceChildren();
    if (!point) { readout.textContent = t('trend.empty'); overlays(); return; }
    const label = document.createElement('strong'); label.textContent = intervalText([point.fromMs, point.toMs]);
    const values = document.createElement('p'); values.textContent = `${t('total.tokens')}: ${integerFormat.format(point.tokens)} · ${t('trend.cost')}: ${formatCost(point.cost, point.partialCost)}`;
    readout.append(label, values);
    if (announce) find('announcement').textContent = `${label.textContent} ${values.textContent}`;
    overlays();
  }
  function pin(index) {
    if (index < 0 || !points[index]) return;
    previewIndex = -1; selectedTime = points[index].fromMs; selection(true);
  }
  function setInterval(bounds) {
    interval = bounds;
    if (bounds) {
      fromSelect.value = String(points.findIndex((point) => point.fromMs === bounds[0]));
      toSelect.value = String(points.findIndex((point) => point.toMs === bounds[1]));
    }
    find('interval-label').textContent = bounds ? intervalText(bounds) : '';
    overlays(); actions();
  }
  function pointerTime(event, root) {
    const rect = root.getBoundingClientRect();
    return domain[0] + Math.max(0, Math.min(1, (event.clientX - rect.left - CHART_PADDING.left) / (rect.width - CHART_PADDING.left - CHART_PADDING.right))) * (domain[1] - domain[0]);
  }
  function draw() {
    for (const item of frames) item.renderer.update({ points, metrics: item.metrics, domain, mark: options.mark, timezone: options.timezone });
    overlays();
  }
  function frame(metrics) {
    const legend = document.createElement('p'); legend.className = 'trend-series';
    for (const [index, metric] of metrics.entries()) {
      const label = document.createElement('span'); label.dataset.metric = metric;
      label.textContent = `${metricLabel(metric)}${index ? ` · ${t(options.mark === 'bar' ? 'chart.outline' : 'chart.dashed')}` : ''}`; legend.append(label);
    }
    const root = document.createElement('div'); root.className = 'trend-frame'; root.tabIndex = 0; root.setAttribute('role', 'group'); root.setAttribute('aria-label', metrics.map(metricLabel).join(' / ')); root.setAttribute('aria-describedby', 'trendHelp trendReadout');
    const plotHost = document.createElement('div'); plotHost.className = 'trend-plot'; plotHost.setAttribute('aria-hidden', 'true');
    const cursor = document.createElement('div'); cursor.className = 'trend-cursor'; cursor.hidden = true;
    const brush = document.createElement('div'); brush.className = 'trend-brush'; brush.hidden = true;
    const tooltip = document.createElement('div'); tooltip.className = 'trend-preview'; tooltip.hidden = true;
    root.append(plotHost, brush, cursor, tooltip); plots.append(legend, root);
    const renderer = createChartRenderer(plotHost);
    root.addEventListener('pointerdown', (event) => {
      const rect = root.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
      if (event.button !== 0 || !points.length || x < CHART_PADDING.left || x > rect.width - CHART_PADDING.right || y < CHART_PADDING.top || y > CHART_HEIGHT - CHART_PADDING.bottom) return;
      root.focus(); root.setPointerCapture(event.pointerId); dragStart = { time: pointerTime(event, root), x: event.clientX };
    });
    root.addEventListener('pointermove', (event) => {
      const time = pointerTime(event, root); const index = nearestBucketIndex(points, time);
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; previewIndex = index; if (dragStart && Math.abs(event.clientX - dragStart.x) > 5) setInterval(snappedInterval(points, dragStart.time, time)); else overlays(); });
    });
    root.addEventListener('pointerup', (event) => {
      if (!dragStart) return;
      if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0;
      const time = pointerTime(event, root);
      if (Math.abs(event.clientX - dragStart.x) > 5) setInterval(snappedInterval(points, dragStart.time, time));
      pin(nearestBucketIndex(points, time)); dragStart = null;
    });
    root.addEventListener('pointercancel', () => { dragStart = null; if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0; previewIndex = -1; overlays(); });
    root.addEventListener('pointerleave', () => { if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0; previewIndex = -1; overlays(); });
    root.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); let index = selectedIndex();
      if (event.key === 'Escape') { previewIndex = -1; overlays(); return; }
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = points.length - 1;
      if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
      if (event.key === 'ArrowRight') index = Math.min(points.length - 1, index + 1);
      pin(index);
    });
    frames.push({ root, cursor, brush, tooltip, metrics, renderer });
  }
  function rebuild() {
    const active = frames.some((item) => item.root === document.activeElement);
    frames.forEach((item) => item.renderer.destroy()); frames = [];
    plots.replaceChildren(); previewIndex = -1; dragStart = null;
    if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0;
    if (points.length) {
      if (options.mode === 'stacked') { frame(['tokens']); frame(['cost']); }
      else frame(options.mode === 'dual' ? ['tokens', 'cost'] : [options.metric]);
      draw(); if (active) frames[0].root.focus();
    }
  }
  for (const select of [fromSelect, toSelect]) select.addEventListener('change', () => {
    const first = Number(fromSelect.value); const last = Number(toSelect.value);
    if (points.length) setInterval([points[Math.min(first, last)].fromMs, points[Math.max(first, last)].toMs]);
  });
  find('zoom').addEventListener('click', () => { if (!interval) return; domain = [...interval]; draw(); actions(); });
  find('reset').addEventListener('click', () => { domain = chartDomain(points); draw(); actions(); });
  async function runAction(button, callback) {
    const hadFocus = document.activeElement === button;
    await callback();
    if (!destroyed && hadFocus && document.activeElement === document.body) fromSelect.focus();
  }
  find('apply').addEventListener('click', () => { if (options.canApply && interval) void runAction(find('apply'), () => onApplyInterval([...interval], options.timezone)); });
  find('return').addEventListener('click', () => { if (options.canReturn) void runAction(find('return'), onReturnQuery); });
  const observer = new ResizeObserver(() => { if (!destroyed && frames.length) draw(); }); observer.observe(plots);

  return {
    update(next) {
      if (destroyed) return;
      const prior = options; options = next;
      const nextPoints = next.trend?.points || [];
      const nextDataKey = JSON.stringify([nextPoints, next.timezone]);
      const nextPresentation = JSON.stringify([next.mode, next.mark, next.metric, next.timezone, getLocale()]);
      const dataChanged = dataKey !== nextDataKey; const scopeChanged = scopeKey !== next.scopeKey;
      if (dataChanged) points = nextPoints;
      if (dataChanged || scopeChanged) {
        if (pointerFrame) cancelAnimationFrame(pointerFrame); pointerFrame = 0; dragStart = null;
        const full = chartDomain(points);
        const intersects = Math.min(domain[1], full[1]) > Math.max(domain[0], full[0]);
        domain = scopeChanged || !intersects ? full : [Math.max(domain[0], full[0]), Math.min(domain[1], full[1])];
        if (scopeChanged || !interval || !points.some((point) => point.fromMs === interval[0]) || !points.some((point) => point.toMs === interval[1])) interval = null;
        if (!points.some((point) => point.fromMs === selectedTime)) selectedTime = points.at(-1)?.fromMs;
        previewIndex = -1;
      }
      if (dataChanged || getLocale() !== prior.locale) {
        for (const select of [fromSelect, toSelect]) select.replaceChildren(...points.map((point, index) => new Option(boundary(select === fromSelect ? point.fromMs : point.toMs), String(index))));
        fromSelect.value = '0'; toSelect.value = String(points.length - 1);
        host.querySelector('tbody').innerHTML = points.map((point) => `<tr><td>${escapeHtml(intervalText([point.fromMs, point.toMs]))}</td><td>${integerFormat.format(point.tokens)}</td><td>${escapeHtml(formatCost(point.cost, point.partialCost))}</td></tr>`).join('');
      }
      const known = points.filter((point) => point[next.metric] != null);
      const peak = known.reduce((highest, point) => !highest || point[next.metric] > highest[next.metric] ? point : highest, null);
      const summary = peak ? t('trend.summary', { unit: t(`trend.${next.trend?.unit || 'day'}`), count: integerFormat.format(points.length), label: boundary(peak.fromMs), value: next.metric === 'cost' ? formatCost(peak.cost, peak.partialCost) : `${integerFormat.format(peak.tokens)} ${t('total.tokens')}`, partial: '' }) : `${integerFormat.format(points.length)} ${t('chart.buckets')}`;
      const coverage = (next.mode !== 'single' || next.metric === 'cost') && points.some((point) => point.partialCost || point.cost == null);
      find('summary').textContent = `${summary} · ${next.timezone}${next.mode === 'dual' ? ` · ${t('chart.dualHint')}` : ''}${coverage ? ` · ${t('chart.costCoverage')}` : ''}`;
      host.querySelector('#trendHelp').textContent = t('chart.help');
      for (const [name, key] of [['from-label','chart.from'],['to-label','chart.to'],['zoom','chart.zoom'],['reset','chart.reset'],['apply','chart.apply'],['return','chart.return'],['time-heading','chart.interval'],['token-heading','total.tokens'],['cost-heading','trend.cost']]) find(name).textContent = t(key);
      host.querySelector('.trend-table summary').textContent = t('trend.table');
      if (dataChanged || scopeChanged || presentationKey !== nextPresentation) { if (presentationKey !== nextPresentation || !frames.length || !points.length) rebuild(); else draw(); }
      selection(); setInterval(interval); actions();
      dataKey = nextDataKey; scopeKey = next.scopeKey; presentationKey = nextPresentation; options.locale = getLocale();
    },
    destroy() { destroyed = true; observer.disconnect(); if (pointerFrame) cancelAnimationFrame(pointerFrame); frames.forEach((item) => item.renderer.destroy()); frames = []; host.replaceChildren(); },
  };
}
