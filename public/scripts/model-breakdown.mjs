import { escapeHtml, integerFormat, moneyFormat, text } from './format.mjs';
import { calculateCost } from './state.mjs';

function modelKey(event, session) {
  return text(event.model || session.model || 'unknown');
}

export function buildModelBreakdown(sessions, pricing) {
  const models = new Map();
  for (const session of sessions) {
    for (const event of session.filteredEvents) {
      const model = modelKey(event, session);
      const item = models.get(model) || { model, tokens: 0, cost: 0, partialCost: false };
      item.tokens += event.usage.totalTokens;
      const eventCost = calculateCost(pricing, [event]);
      item.cost += eventCost.total;
      item.partialCost ||= eventCost.unknownModels.size > 0 || eventCost.unavailableComponents.size > 0;
      models.set(model, item);
    }
  }
  return [...models.values()].sort((left, right) => right.cost - left.cost || right.tokens - left.tokens || left.model.localeCompare(right.model));
}

function metricValue(item, metric) {
  return metric === 'cost' ? item.cost : item.tokens;
}

function metricLabel(item, metric) {
  if (metric === 'tokens') return `${integerFormat.format(item.tokens)} tokens`;
  return item.cost ? `${item.partialCost ? '≥ ' : ''}${moneyFormat.format(item.cost)}` : '—';
}

export function renderModelBreakdown(host, models, metric) {
  if (!models.length) {
    host.innerHTML = '<p class="insight-empty">此範圍沒有可分組的模型事件。</p>';
    return;
  }
  const visibleModels = [...models]
    .sort((left, right) => metricValue(right, metric) - metricValue(left, metric) || left.model.localeCompare(right.model))
    .slice(0, 8);
  const max = Math.max(1, ...visibleModels.map((item) => metricValue(item, metric)));
  const metricName = metric === 'cost' ? '估算費用' : 'Total tokens';
  const summary = `依 ${metricName} 排序，顯示 ${visibleModels.length} / ${models.length} 個模型。`;
  const rows = visibleModels.map((item) => {
    const value = metricValue(item, metric);
    const width = Math.max(value ? 2 : 0, (value / max) * 100);
    const label = metricLabel(item, metric);
    return `<li><div class="model-breakdown-label"><strong>${escapeHtml(item.model)}</strong><span>${escapeHtml(label)}</span></div><div class="model-bar" role="progressbar" aria-label="${escapeHtml(`${item.model} ${metricName}`)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}"><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${width.toFixed(2)}" height="8" /></svg></div></li>`;
  }).join('');
  host.innerHTML = `<p class="model-summary">${escapeHtml(summary)}</p><ol class="model-breakdown-list">${rows}</ol>`;
}
