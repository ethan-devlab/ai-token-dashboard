import uPlot from './vendor/uplot-1.6.32.mjs';
import { chartColumns, chartValue, numericScale, timeTicks } from './chart-geometry.mjs';
import { formatCompactNumber } from './format.mjs';
import { getLocale } from './i18n.mjs';

const rootStyle = getComputedStyle(document.documentElement);
const tokenSize = (name) => { const value = rootStyle.getPropertyValue(name).trim(); return parseFloat(value) * (value.endsWith('rem') ? parseFloat(rootStyle.fontSize) : 1); };
export const CHART_PADDING = Object.freeze({ left: tokenSize('--chart-gutter'), right: tokenSize('--chart-gutter'), top: tokenSize('--chart-top'), bottom: tokenSize('--chart-bottom') });
export const CHART_HEIGHT = tokenSize('--chart-height');

function axisLabel(value, metric) {
  return metric === 'cost' ? `$${new Intl.NumberFormat(getLocale(), { maximumSignificantDigits: 4 }).format(value)}` : formatCompactNumber(value, 'auto');
}
function timeLabel(value, timezone, domain) {
  return new Intl.DateTimeFormat(getLocale(), { timeZone: timezone, month: '2-digit', day: '2-digit', ...(domain[1] - domain[0] >= 366 * 86_400_000 ? { year: 'numeric' } : {}), ...(domain[1] - domain[0] <= 3 * 86_400_000 ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(value);
}

function styles(host) {
  const style = getComputedStyle(host);
  const token = (key) => style.getPropertyValue(`--${key}`).trim();
  return { palette: { cost: token('color-accent'), tokens: token('color-info') }, border: token('color-border'), muted: token('color-muted'), font: `12px ${token('font-mono')}` };
}

function intervalPaths(plot, points, metric, outline) {
  const fill = new Path2D(); const baseline = plot.valToPos(0, metric, true);
  for (const point of points) {
    const value = chartValue(point, metric); if (value == null) continue;
    const left = plot.valToPos(point.fromMs / 1000, 'x', true); const right = plot.valToPos(point.toMs / 1000, 'x', true);
    const top = plot.valToPos(value, metric, true);
    fill.rect(left, top, Math.max(0, right - left), baseline - top);
  }
  return outline ? { stroke: fill } : { fill };
}

export function createChartRenderer(host, onPaint = () => {}) {
  let plot;
  let currentConfig;
  let currentScales;
  let currentWidth;
  let paintStarted;
  let priorPoints;
  return {
    update(config) {
      const started = performance.now();
      const { points, metrics, domain, mark } = config;
      const width = Math.max(320, Math.floor(host.getBoundingClientRect().width));
      const style = styles(host);
      style.colors = metrics.map((metric) => style.palette[metric]);
      const scales = Object.fromEntries(metrics.map((metric) => [metric, numericScale(points, metric, domain)]));
      currentConfig = config; currentScales = scales; currentWidth = width; paintStarted = started;
      if (plot) {
        plot.batch(() => {
          if (priorPoints !== points) { plot.setData(chartColumns(points, metrics, mark), false); priorPoints = points; }
          if (plot.width !== width) plot.setSize({ width, height: CHART_HEIGHT });
          plot.setScale('x', { min: domain[0] / 1000, max: domain[1] / 1000 });
          for (const metric of metrics) plot.setScale(metric, { min: 0, max: scales[metric].max });
          plot.redraw(true, true);
        });
        return;
      }
      const axes = [{ scale: 'x', size: CHART_PADDING.bottom, font: style.font, stroke: style.muted, space: 150, grid: { show: false }, ticks: { show: false }, splits: () => timeTicks(currentConfig.domain, currentWidth - CHART_PADDING.left - CHART_PADDING.right).map((value) => value / 1000), values: (_plot, ticks) => ticks.map((value) => timeLabel(value * 1000, currentConfig.timezone, currentConfig.domain)) }];
      metrics.forEach((metric, index) => axes.push({ scale: metric, side: index ? 1 : 3, size: index ? CHART_PADDING.right : CHART_PADDING.left, font: style.font, stroke: style.colors[index], ticks: { show: false }, grid: { show: index === 0, stroke: style.border, width: 1 }, splits: () => currentScales[metric].ticks, values: (_plot, ticks) => ticks.map((value) => axisLabel(value, metric)) }));
      const options = {
        width, height: CHART_HEIGHT, padding: [CHART_PADDING.top, metrics.length === 1 ? CHART_PADDING.right : 0, 0, 0], legend: { show: false }, cursor: { show: false, drag: { x: false, y: false } }, select: { show: false },
        scales: { x: { time: false, range: () => currentConfig.domain.map((value) => value / 1000) }, ...Object.fromEntries(metrics.map((metric) => [metric, { time: false, range: () => [0, currentScales[metric].max] }])) },
        axes,
        series: [{}, ...metrics.map((metric, index) => ({ label: metric, scale: metric, stroke: style.colors[index], fill: mark === 'bar' && !index ? `${style.colors[index]}99` : null, dash: mark === 'line' && index ? [4, 4] : [], width: 2, spanGaps: false, points: { show: mark === 'line' && points.length <= 200, size: 6, fill: style.colors[index] }, ...(mark === 'bar' ? { paths: (self) => intervalPaths(self, currentConfig.points, metric, index > 0) } : {}) }))],
        hooks: { draw: [() => onPaint(performance.now() - paintStarted)] },
      };
      plot = new uPlot(options, chartColumns(points, metrics, mark), host); priorPoints = points;
      return;
    },
    destroy() { plot?.destroy(); },
  };
}
