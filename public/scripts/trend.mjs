import { escapeHtml, integerFormat, moneyFormat } from './format.mjs';
import { t } from './i18n.mjs';

const PADDING = Object.freeze({ top: 16, right: 16, bottom: 30, left: 16 });
function valueLabel(value, metric) { return metric === 'cost' ? moneyFormat.format(value) : `${integerFormat.format(value)} ${t('total.tokens')}`; }

export function nearestPointIndex(points, x, width, padding = PADDING) {
  if (!points.length) return -1; if (points.length === 1) return 0;
  return Math.max(0, Math.min(points.length - 1, Math.round((x - padding.left) / Math.max(1, width - padding.left - padding.right) * (points.length - 1))));
}

function draw(canvas, points, selectedIndex) {
  const rect = canvas.getBoundingClientRect(); const width = Math.max(1, Math.floor(rect.width)); const height = Math.max(184, Math.floor(rect.height)); const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio); const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  const style = getComputedStyle(canvas); const accent = style.getPropertyValue('--color-accent').trim(); const border = style.getPropertyValue('--color-border').trim(); const surface = style.getPropertyValue('--color-surface-raised').trim(); const subtle = style.getPropertyValue('--color-subtle').trim(); const plotWidth = width - PADDING.left - PADDING.right; const plotHeight = height - PADDING.top - PADDING.bottom; const max = Math.max(1, ...points.map((point) => point.value));
  const coordinates = points.map((point, index) => ({ ...point, x: points.length === 1 ? width / 2 : PADDING.left + plotWidth * index / (points.length - 1), y: PADDING.top + plotHeight - point.value / max * plotHeight }));
  context.strokeStyle = border; context.lineWidth = 1; context.beginPath(); context.moveTo(PADDING.left, height - PADDING.bottom); context.lineTo(width - PADDING.right, height - PADDING.bottom); context.stroke(); context.strokeStyle = accent; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
  context.font = '12px var(--font-mono)'; context.fillStyle = subtle; context.fillText(coordinates[0].label, PADDING.left, height - 8); context.textAlign = 'right'; context.fillText(coordinates.at(-1).label, width - PADDING.right, height - 8); context.textAlign = 'start'; coordinates.forEach((point, index) => { context.beginPath(); context.arc(point.x, point.y, index === selectedIndex ? 5 : 3, 0, Math.PI * 2); context.fillStyle = index === selectedIndex ? accent : surface; context.fill(); context.strokeStyle = accent; context.lineWidth = 2; context.stroke(); });
  return { coordinates };
}

function dataTable(points, metric) { return `<details class="trend-table"><summary>${escapeHtml(t('trend.table'))}</summary><table><thead><tr><th>${escapeHtml(t('trend.time'))}</th><th>${escapeHtml(t('trend.value'))}</th></tr></thead><tbody>${points.map((point) => `<tr><td>${escapeHtml(point.label)}</td><td>${escapeHtml(valueLabel(point.value, metric))}</td></tr>`).join('')}</tbody></table></details>`; }

export function renderUsageTrend(host, trend, metric) {
  host._trendCleanup?.(); const points = (trend.points || []).map((point) => ({ ...point, value: Number(point[metric] || 0) }));
  if (!points.length) { host.innerHTML = `<p class="insight-empty">${escapeHtml(t('trend.empty'))}</p>`; host._trendCleanup = undefined; return; }
  const peak = points.reduce((highest, point) => point.value > highest.value ? point : highest, points[0]); const metricLabel = t(metric === 'cost' ? 'trend.cost' : 'trend.tokens'); const summary = t('trend.summary', { unit: t(`trend.${trend.unit || 'day'}`), count: integerFormat.format(points.length), label: peak.label, value: valueLabel(peak.value, metric), partial: metric === 'cost' && trend.partialCost ? t('trend.partial') : '' });
  host.innerHTML = `<p id="trendSummary" class="trend-summary">${escapeHtml(summary)}</p><div class="trend-visual"><canvas class="trend-chart" tabindex="0" role="img" aria-describedby="trendSummary trendSelection" aria-label="${escapeHtml(t('trend.aria', { metric: metricLabel }))}"></canvas><p id="trendSelection" class="trend-tooltip" aria-live="polite"></p></div>${dataTable(points, metric)}`;
  const canvas = host.querySelector('canvas'); const tooltip = host.querySelector('.trend-tooltip'); let selectedIndex = points.length - 1;
  const update = () => { const drawing = draw(canvas, points, selectedIndex); const point = points[selectedIndex]; tooltip.textContent = t('trend.point', { label: point.label, value: valueLabel(point.value, metric) }); tooltip.style.setProperty('--tooltip-x', `${drawing.coordinates[selectedIndex].x}px`); };
  const pointer = (event) => { const rect = canvas.getBoundingClientRect(); selectedIndex = nearestPointIndex(points, event.clientX - rect.left, rect.width); update(); };
  const keyboard = (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); if (event.key === 'ArrowLeft') selectedIndex = Math.max(0, selectedIndex - 1); if (event.key === 'ArrowRight') selectedIndex = Math.min(points.length - 1, selectedIndex + 1); if (event.key === 'Home') selectedIndex = 0; if (event.key === 'End') selectedIndex = points.length - 1; update(); };
  canvas.addEventListener('pointermove', pointer); canvas.addEventListener('pointerdown', pointer); canvas.addEventListener('keydown', keyboard); const observer = new ResizeObserver(update); observer.observe(canvas); host._trendCleanup = () => { observer.disconnect(); canvas.removeEventListener('pointermove', pointer); canvas.removeEventListener('pointerdown', pointer); canvas.removeEventListener('keydown', keyboard); }; update();
}
