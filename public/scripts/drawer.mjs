import { escapeHtml, formatCost, formatDate, integerFormat, text } from './format.mjs';
import { t } from './i18n.mjs';

export function redactPath(value) {
  return text(value).replaceAll('\\', '/').replace(/^[A-Z]:\/Users\/[^/]+/i, '~').replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

function item(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function count(detail, key) {
  const value = detail?.diagnostics?.[key] ?? detail?.[key];
  return value == null || !Number.isFinite(Number(value)) ? '—' : integerFormat.format(Number(value));
}

export function renderSessionDrawer({ detail, status, error, showDetails, timezone }) {
  if (status === 'loading') return `<p class="insight-empty" role="status">${escapeHtml(t('v2.detail.loading'))}</p>`;
  if (status === 'error') return `<p class="field-error" role="alert">${escapeHtml(error)}</p>`;
  const usage = detail?.usage || {}; const cost = detail?.cost || {}; const observationCount = Array.isArray(detail?.observations) ? integerFormat.format(detail.observations.length) : count(detail, 'observationCount');
  const identity = [item(t('drawer.sessionId'), text(detail?.sessionId || detail?.sessionKey)), item(t('table.model'), text(detail?.model)), item(t('drawer.executionType'), t(`provider.execution.${detail?.executionType || 'main'}`)), detail?.parentSessionKey ? item(t('drawer.parentSession'), text(detail.parentSessionKey)) : '', item(t('drawer.cwd'), redactPath(detail?.workspace || detail?.cwd)), item(t('table.lastUsed'), formatDate(detail?.lastUsed || detail?.lastTimestamp, timezone))].join('');
  const tokens = [item('Total', integerFormat.format(usage.totalTokens || 0)), item('Input', integerFormat.format(usage.inputTokens || 0)), item('Output', integerFormat.format(usage.outputTokens || 0)), showDetails ? item('Cached input', integerFormat.format(usage.cachedInputTokens || 0)) : '', showDetails && detail?.provider === 'claude' ? item(t('provider.cacheWrite5m'), integerFormat.format(usage.cacheWrite5mTokens || 0)) : '', showDetails && detail?.provider === 'claude' ? item(t('provider.cacheWrite1h'), integerFormat.format(usage.cacheWrite1hTokens || 0)) : ''].join('');
  const diagnostics = `${t('drawer.lines', { count: count(detail, 'lineCount') })} · ${t('drawer.skipped', { count: count(detail, 'invalidLines') })} · ${t('drawer.resets', { count: count(detail, 'resets') })} · ${t('v2.detail.observations', { count: observationCount })}`;
  return `<section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.identity'))}</p><dl class="drawer-grid">${identity}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.tokens'))}</p><dl class="drawer-grid">${tokens}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.cost'))}</p><dl class="drawer-grid">${item(t('trend.cost'), formatCost(cost.total, cost.partial || cost.minimumKnown || cost.pricingCoverage?.partial))}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.quality'))}</p><p class="drawer-diagnostics">${escapeHtml(diagnostics)}</p></section>`;
}
