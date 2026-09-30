import { escapeHtml, formatCost, integerFormat } from './format.mjs';
import { t } from './i18n.mjs';

function metricValue(item, metric) { return Number(metric === 'tokens' ? item.tokens : item.cost || 0); }
function metricLabel(item, metric) { return metric === 'tokens' ? `${integerFormat.format(item.tokens)} ${t('total.tokens')}` : formatCost(item.cost, item.partialCost || item.coverage?.partial); }

export function renderModelBreakdown(host, models = [], metric) {
  if (!models.length) { host.innerHTML = `<p class="insight-empty">${escapeHtml(t('model.empty'))}</p>`; return; }
  const visible = [...models].sort((left, right) => metricValue(right, metric) - metricValue(left, metric) || String(left.model).localeCompare(String(right.model))).slice(0, 8);
  const max = Math.max(1, ...visible.map((item) => metricValue(item, metric))); const metricName = t(metric === 'cost' ? 'trend.cost' : 'trend.tokens');
  const rows = visible.map((item) => { const value = metricValue(item, metric); const width = Math.max(value ? 2 : 0, value / max * 100); return `<li><div class="model-breakdown-label"><strong>${escapeHtml(item.model)}</strong><span>${escapeHtml(metricLabel(item, metric))}</span></div><div class="model-bar" role="progressbar" aria-label="${escapeHtml(`${item.model} ${metricName}`)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}"><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${width.toFixed(2)}" height="8" /></svg></div></li>`; }).join('');
  host.innerHTML = `<p class="model-summary">${escapeHtml(t('model.summary', { metric: metricName, visible: visible.length, total: models.length }))}</p><ol class="model-breakdown-list">${rows}</ol>`;
}
