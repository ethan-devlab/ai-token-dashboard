import { escapeHtml, integerFormat, moneyFormat } from './format.mjs';
import { calculateCost } from './state.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 31 * DAY_MS;
const YEAR_MS = 366 * DAY_MS;

function validEvents(sessions) {
  return sessions.flatMap((session) => session.filteredEvents)
    .filter((event) => Number.isFinite(Date.parse(event.timestamp)));
}

function granularity(range, events) {
  if (range.mode === 'last24h' || range.mode === 'today') return 'hour';
  if (range.mode === 'week' || range.mode === 'month') return 'day';
  if (range.mode === 'year') return 'month';
  const times = events.map((event) => Date.parse(event.timestamp));
  const from = range.fromMs ?? Math.min(...times);
  const to = range.toMs ?? Math.max(...times);
  const span = Math.max(0, to - from);
  if (span <= 2 * DAY_MS) return 'hour';
  if (span <= 13 * MONTH_MS) return 'day';
  if (span <= 6 * YEAR_MS) return 'month';
  return 'year';
}

function bucketStart(value, unit) {
  const date = new Date(value);
  if (unit === 'hour') date.setMinutes(0, 0, 0);
  if (unit === 'day') date.setHours(0, 0, 0, 0);
  if (unit === 'month') date.setDate(1), date.setHours(0, 0, 0, 0);
  if (unit === 'year') date.setMonth(0, 1), date.setHours(0, 0, 0, 0);
  return date;
}

function nextBucket(date, unit) {
  const next = new Date(date);
  if (unit === 'hour') next.setHours(next.getHours() + 1);
  if (unit === 'day') next.setDate(next.getDate() + 1);
  if (unit === 'month') next.setMonth(next.getMonth() + 1);
  if (unit === 'year') next.setFullYear(next.getFullYear() + 1);
  return next;
}

function bucketLabel(value, unit) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  if (unit === 'hour') return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:00`;
  if (unit === 'day') return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  if (unit === 'month') return `${date.getFullYear()}/${pad(date.getMonth() + 1)}`;
  return String(date.getFullYear());
}

function rangeBounds(range, events, unit) {
  if (!events.length) return null;
  const times = events.map((event) => Date.parse(event.timestamp));
  const from = range.fromMs ?? Math.min(...times);
  const to = range.toMs ?? Math.max(...times);
  const start = bucketStart(from, unit);
  const end = range.toMs == null ? nextBucket(bucketStart(to, unit), unit) : bucketStart(to, unit);
  return end > start ? { start, end } : { start, end: nextBucket(start, unit) };
}

export function buildTrendSeries(sessions, pricing, range) {
  const events = validEvents(sessions);
  if (!events.length) return { points: [], unit: 'day', partialCost: false };
  const unit = granularity(range, events);
  const bounds = rangeBounds(range, events, unit);
  const pointMap = new Map();
  for (let cursor = bounds.start; cursor < bounds.end; cursor = nextBucket(cursor, unit)) {
    pointMap.set(cursor.getTime(), { time: cursor.getTime(), label: bucketLabel(cursor, unit), tokens: 0, cost: 0 });
  }

  let partialCost = false;
  for (const event of events) {
    const timestamp = Date.parse(event.timestamp);
    const key = bucketStart(timestamp, unit).getTime();
    const point = pointMap.get(key);
    if (!point) continue;
    point.tokens += event.usage.totalTokens;
    const eventCost = calculateCost(pricing, [event]);
    point.cost += eventCost.total;
    partialCost ||= eventCost.unknownModels.size > 0 || eventCost.unavailableComponents.size > 0;
  }

  return { points: [...pointMap.values()], unit, partialCost };
}

function measure(points, metric) {
  return points.map((point) => ({ ...point, value: point[metric] }));
}

function valueLabel(value, metric) {
  return metric === 'cost' ? moneyFormat.format(value) : `${integerFormat.format(value)} tokens`;
}

function granularityLabel(unit) {
  return { hour: '每小時', day: '每日', month: '每月', year: '每年' }[unit];
}

function chartMarkup(points, metric) {
  const width = 720;
  const height = 184;
  const padding = { top: 16, right: 16, bottom: 30, left: 16 };
  const max = Math.max(1, ...points.map((point) => point.value));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : padding.left + (plotWidth * index) / (points.length - 1);
    const y = padding.top + plotHeight - (point.value / max) * plotHeight;
    return { ...point, x, y };
  });
  const polyline = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const labels = [coordinates[0], coordinates.at(-1)].filter(Boolean);
  const dots = coordinates.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${escapeHtml(`${point.label} · ${valueLabel(point.value, metric)}`)}</title></circle>`).join('');
  const axis = labels.map((point, index) => `<text x="${point.x.toFixed(1)}" y="${height - 8}" text-anchor="${index ? 'end' : 'start'}">${escapeHtml(point.label)}</text>`).join('');
  return `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img"><line x1="${padding.left}" x2="${width - padding.right}" y1="${height - padding.bottom}" y2="${height - padding.bottom}" /><polyline points="${polyline}" />${dots}${axis}</svg>`;
}

export function renderUsageTrend(host, trend, metric) {
  const series = measure(trend.points, metric);
  if (!series.length) {
    host.innerHTML = '<p class="insight-empty">此範圍沒有可繪製的使用事件。</p>';
    return;
  }
  const peak = series.reduce((highest, point) => point.value > highest.value ? point : highest, series[0]);
  const metricLabel = metric === 'cost' ? '估算費用' : 'Total tokens';
  const summary = `${granularityLabel(trend.unit)}彙整 ${series.length} 個區間；峰值 ${peak.label}，${valueLabel(peak.value, metric)}。${metric === 'cost' && trend.partialCost ? ' 未知模型或缺失單價未納入趨勢。' : ''}`;
  host.innerHTML = `<p id="trendSummary" class="trend-summary">${escapeHtml(summary)}</p><div class="trend-visual" role="img" aria-describedby="trendSummary" aria-label="${escapeHtml(`${metricLabel} trend`)}">${chartMarkup(series, metric)}</div>`;
}
