import { escapeHtml, formatCost, integerFormat } from './format.mjs';
import { t } from './i18n.mjs';

function metricValue(item, metric) { const value = metric === 'tokens' ? item.tokens : item.cost; return value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value)); }
function metricLabel(item, metric) { return metric === 'tokens' ? `${integerFormat.format(item.tokens)} ${t('total.tokens')}` : formatCost(item.cost, item.partialCost || item.coverage?.partial); }

export function modelRanking(models, metric) {
  const sorted = [...models].sort((left, right) => (metricValue(right, metric) ?? -1) - (metricValue(left, metric) ?? -1) || String(left.model).localeCompare(String(right.model)));
  const maximum = sorted.reduce((max, item) => Math.max(max, metricValue(item, metric) || 0), 0);
  return sorted.map((item) => ({ item, value: metricValue(item, metric), ratio: maximum ? (metricValue(item, metric) || 0) / maximum : 0 }));
}

export function renderModelBreakdown(host, models = [], metric) {
  if (!models.length) { host.innerHTML = `<p class="insight-empty">${escapeHtml(t('model.empty'))}</p>`; return; }
  const open = host.querySelector?.('.model-table')?.open;
  const ranked = modelRanking(models, metric); const visible = ranked.slice(0, 8); const metricName = t(metric === 'cost' ? 'trend.cost' : 'trend.tokens');
  const rows = visible.map(({ item, value, ratio }) => `<li><div class="model-breakdown-label"><strong>${escapeHtml(item.model)}</strong><span>${escapeHtml(metricLabel(item, metric))}</span></div>${value == null ? '' : `<div class="model-bar" role="img" aria-label="${escapeHtml(`${item.model} · ${metricName}: ${metricLabel(item, metric)}`)}"><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${ratio * 100}" height="8" /></svg></div>`}</li>`).join('');
  host.innerHTML = `<p class="model-summary" role="status">${escapeHtml(t('model.summary', { metric: metricName, visible: visible.length, total: models.length }))}</p><ol class="model-breakdown-list">${rows}</ol><details class="model-table trend-table"${open ? ' open' : ''}><summary>${escapeHtml(t('model.all', { count: models.length }))}</summary><div class="trend-table-wrap"><table><thead><tr><th>${escapeHtml(t('table.model'))}</th><th>${escapeHtml(t('total.tokens'))}</th><th>${escapeHtml(t('trend.cost'))}</th></tr></thead><tbody>${ranked.map(({ item }) => `<tr><td>${escapeHtml(item.model)}</td><td>${integerFormat.format(item.tokens)}</td><td>${escapeHtml(metricLabel(item, 'cost'))}</td></tr>`).join('')}</tbody></table></div></details>`;
}
