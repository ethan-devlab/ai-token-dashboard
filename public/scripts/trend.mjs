import { escapeHtml, integerFormat, moneyFormat } from './format.mjs';
import { getLocale, t } from './i18n.mjs';
import { calculateCost } from './state.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 31 * DAY_MS;
const YEAR_MS = 366 * DAY_MS;
const PADDING = Object.freeze({ top: 16, right: 16, bottom: 30, left: 16 });

function validEvents(sessions) { return sessions.flatMap((session) => session.filteredEvents).filter((event) => Number.isFinite(Date.parse(event.timestamp))); }
function granularity(range, events) {
  if (range.mode === 'last24h' || range.mode === 'today') return 'hour';
  if (range.mode === 'week' || range.mode === 'month') return 'day';
  if (range.mode === 'year') return 'month';
  const times = events.map((event) => Date.parse(event.timestamp));
  const span = Math.max(0, (range.toMs ?? Math.max(...times)) - (range.fromMs ?? Math.min(...times)));
  return span <= 2 * DAY_MS ? 'hour' : span <= 13 * MONTH_MS ? 'day' : span <= 6 * YEAR_MS ? 'month' : 'year';
}
function bucketStart(value, unit) { const date = new Date(value); if (unit === 'hour') date.setMinutes(0, 0, 0); if (unit === 'day') date.setHours(0, 0, 0, 0); if (unit === 'month') date.setDate(1), date.setHours(0, 0, 0, 0); if (unit === 'year') date.setMonth(0, 1), date.setHours(0, 0, 0, 0); return date; }
function nextBucket(date, unit) { const next = new Date(date); if (unit === 'hour') next.setHours(next.getHours() + 1); if (unit === 'day') next.setDate(next.getDate() + 1); if (unit === 'month') next.setMonth(next.getMonth() + 1); if (unit === 'year') next.setFullYear(next.getFullYear() + 1); return next; }
function bucketLabel(value, unit) {
  const date = new Date(value);
  const options = unit === 'hour' ? { month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false } : unit === 'day' ? { month: '2-digit', day: '2-digit' } : unit === 'month' ? { year: 'numeric', month: '2-digit' } : { year: 'numeric' };
  return new Intl.DateTimeFormat(getLocale(), options).format(date);
}
function rangeBounds(range, events, unit) { if (!events.length) return null; const times = events.map((event) => Date.parse(event.timestamp)); const start = bucketStart(range.fromMs ?? Math.min(...times), unit); const end = range.toMs == null ? nextBucket(bucketStart(Math.max(...times), unit), unit) : bucketStart(range.toMs, unit); return end > start ? { start, end } : { start, end: nextBucket(start, unit) }; }

export function buildTrendSeries(sessions, pricing, range) {
  const events = validEvents(sessions);
  if (!events.length) return { points: [], unit: 'day', partialCost: false };
  const unit = granularity(range, events);
  const bounds = rangeBounds(range, events, unit);
  const pointMap = new Map();
  for (let cursor = bounds.start; cursor < bounds.end; cursor = nextBucket(cursor, unit)) pointMap.set(cursor.getTime(), { time: cursor.getTime(), label: bucketLabel(cursor, unit), tokens: 0, cost: 0 });
  let partialCost = false;
  for (const event of events) { const point = pointMap.get(bucketStart(Date.parse(event.timestamp), unit).getTime()); if (!point) continue; point.tokens += event.usage.totalTokens; const cost = calculateCost(pricing, [event]); point.cost += cost.total; partialCost ||= cost.unknownModels.size > 0 || cost.unavailableComponents.size > 0; }
  return { points: [...pointMap.values()], unit, partialCost };
}

function valueLabel(value, metric) { return metric === 'cost' ? moneyFormat.format(value) : `${integerFormat.format(value)} ${t('total.tokens')}`; }
function unitLabel(unit) { return t(`trend.${unit}`); }

export function nearestPointIndex(points, x, width, padding = PADDING) {
  if (!points.length) return -1;
  if (points.length === 1) return 0;
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  return Math.max(0, Math.min(points.length - 1, Math.round(((x - padding.left) / plotWidth) * (points.length - 1))));
}

function colors(canvas) {
  const style = getComputedStyle(canvas);
  return { accent: style.getPropertyValue('--color-accent').trim(), border: style.getPropertyValue('--color-border').trim(), surface: style.getPropertyValue('--color-surface-raised').trim(), subtle: style.getPropertyValue('--color-subtle').trim() };
}

function draw(canvas, points, selectedIndex) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(184, Math.floor(rect.height));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  const palette = colors(canvas); const plotWidth = width - PADDING.left - PADDING.right; const plotHeight = height - PADDING.top - PADDING.bottom; const max = Math.max(1, ...points.map((point) => point.value));
  const coordinates = points.map((point, index) => ({ ...point, x: points.length === 1 ? width / 2 : PADDING.left + (plotWidth * index) / (points.length - 1), y: PADDING.top + plotHeight - (point.value / max) * plotHeight }));
  context.strokeStyle = palette.border; context.lineWidth = 1; context.beginPath(); context.moveTo(PADDING.left, height - PADDING.bottom); context.lineTo(width - PADDING.right, height - PADDING.bottom); context.stroke();
  context.strokeStyle = palette.accent; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
  context.font = '12px var(--font-mono)'; context.fillStyle = palette.subtle; context.textBaseline = 'alphabetic'; context.fillText(coordinates[0].label, PADDING.left, height - 8); context.textAlign = 'right'; context.fillText(coordinates.at(-1).label, width - PADDING.right, height - 8); context.textAlign = 'start';
  coordinates.forEach((point, index) => { context.beginPath(); context.arc(point.x, point.y, index === selectedIndex ? 5 : 3, 0, Math.PI * 2); context.fillStyle = index === selectedIndex ? palette.accent : palette.surface; context.fill(); context.strokeStyle = palette.accent; context.lineWidth = 2; context.stroke(); });
  return { width, coordinates };
}

function dataTable(points, metric) { return `<details class="trend-table"><summary>${escapeHtml(t('trend.table'))}</summary><table><thead><tr><th>${escapeHtml(t('trend.time'))}</th><th>${escapeHtml(t('trend.value'))}</th></tr></thead><tbody>${points.map((point) => `<tr><td>${escapeHtml(point.label)}</td><td>${escapeHtml(valueLabel(point.value, metric))}</td></tr>`).join('')}</tbody></table></details>`; }

export function renderUsageTrend(host, trend, metric) {
  const points = trend.points.map((point) => ({ ...point, value: Number(point[metric] || 0) }));
  if (!points.length) { host.innerHTML = `<p class="insight-empty">${escapeHtml(t('trend.empty'))}</p>`; return; }
  const peak = points.reduce((highest, point) => point.value > highest.value ? point : highest, points[0]);
  const metricLabel = t(metric === 'cost' ? 'trend.cost' : 'trend.tokens');
  const summary = t('trend.summary', { unit: unitLabel(trend.unit), count: integerFormat.format(points.length), label: peak.label, value: valueLabel(peak.value, metric), partial: metric === 'cost' && trend.partialCost ? t('trend.partial') : '' });
  host.innerHTML = `<p id="trendSummary" class="trend-summary">${escapeHtml(summary)}</p><div class="trend-visual"><canvas class="trend-chart" tabindex="0" role="img" aria-describedby="trendSummary trendSelection" aria-label="${escapeHtml(t('trend.aria', { metric: metricLabel }))}"></canvas><p id="trendSelection" class="trend-tooltip" aria-live="polite"></p></div>${dataTable(points, metric)}`;
  const canvas = host.querySelector('canvas'); const tooltip = host.querySelector('.trend-tooltip'); let selectedIndex = points.length - 1; let drawing = null;
  const update = () => { drawing = draw(canvas, points, selectedIndex); const point = points[selectedIndex]; tooltip.textContent = t('trend.point', { label: point.label, value: valueLabel(point.value, metric) }); tooltip.style.setProperty('--tooltip-x', `${drawing.coordinates[selectedIndex].x}px`); };
  const selectFromPointer = (event) => { const rect = canvas.getBoundingClientRect(); selectedIndex = nearestPointIndex(points, event.clientX - rect.left, rect.width); update(); };
  canvas.addEventListener('pointermove', selectFromPointer); canvas.addEventListener('pointerdown', selectFromPointer); canvas.addEventListener('keydown', (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); if (event.key === 'ArrowLeft') selectedIndex = Math.max(0, selectedIndex - 1); if (event.key === 'ArrowRight') selectedIndex = Math.min(points.length - 1, selectedIndex + 1); if (event.key === 'Home') selectedIndex = 0; if (event.key === 'End') selectedIndex = points.length - 1; update(); });
  const observer = new ResizeObserver(update); observer.observe(canvas); update();
}
