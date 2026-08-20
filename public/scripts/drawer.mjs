import { escapeHtml, formatDate, integerFormat, moneyFormat, text } from './format.mjs';
import { t } from './i18n.mjs';

export function redactPath(value) {
  return text(value).replaceAll('\\', '/').replace(/^[A-Z]:\/Users\/[^/]+/i, '~').replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

function item(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function count(detail, key) { return integerFormat.format(Number(detail?.diagnostics?.[key] ?? detail?.[key] ?? 0)); }

export function renderSessionDrawer({ detail, status, error, showDetails }) {
  if (status === 'loading') return `<div class="drawer-heading"><h2 id="drawerTitle">${escapeHtml(t('drawer.title'))}</h2><button id="closeDrawer" type="button">${escapeHtml(t('drawer.close'))}</button></div><p class="insight-empty">${escapeHtml(t('v2.detail.loading'))}</p>`;
  if (status === 'error') return `<div class="drawer-heading"><h2 id="drawerTitle">${escapeHtml(t('drawer.title'))}</h2><button id="closeDrawer" type="button">${escapeHtml(t('drawer.close'))}</button></div><p class="field-error">${escapeHtml(error)}</p>`;
  const usage = detail?.usage || {}; const cost = detail?.cost || {}; const observationCount = Array.isArray(detail?.observations) ? detail.observations.length : Number(detail?.observationCount || 0);
  const identity = [item(t('drawer.sessionId'), text(detail?.sessionId || detail?.sessionKey)), item(t('table.model'), text(detail?.model)), item(t('drawer.executionType'), t(`provider.execution.${detail?.executionType || 'main'}`)), detail?.parentSessionKey ? item(t('drawer.parentSession'), text(detail.parentSessionKey)) : '', item(t('drawer.cwd'), redactPath(detail?.workspace || detail?.cwd)), item(t('table.lastUsed'), formatDate(detail?.lastUsed || detail?.lastTimestamp))].join('');
  const tokens = [item('Total', integerFormat.format(usage.totalTokens || 0)), item('Input', integerFormat.format(usage.inputTokens || 0)), item('Output', integerFormat.format(usage.outputTokens || 0)), showDetails ? item('Cached input', integerFormat.format(usage.cachedInputTokens || 0)) : '', showDetails && detail?.provider === 'claude' ? item(t('provider.cacheWrite5m'), integerFormat.format(usage.cacheWrite5mTokens || 0)) : '', showDetails && detail?.provider === 'claude' ? item(t('provider.cacheWrite1h'), integerFormat.format(usage.cacheWrite1hTokens || 0)) : ''].join('');
  const diagnostics = `${t('drawer.lines', { count: count(detail, 'lineCount') })} · ${t('drawer.skipped', { count: count(detail, 'invalidLines') })} · ${t('drawer.resets', { count: count(detail, 'resets') })} · ${t('v2.detail.observations', { count: integerFormat.format(observationCount) })}`;
  return `<div class="drawer-heading"><div><p class="eyebrow">${escapeHtml(t('drawer.title'))}</p><h2 id="drawerTitle">${escapeHtml(text(detail?.sessionId || detail?.sessionKey))}</h2></div><button id="closeDrawer" type="button">${escapeHtml(t('drawer.close'))}</button></div><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.identity'))}</p><dl class="drawer-grid">${identity}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.tokens'))}</p><dl class="drawer-grid">${tokens}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.cost'))}</p><dl class="drawer-grid">${item(t('trend.cost'), cost.total == null ? '—' : `${cost.partial || cost.minimumKnown || cost.pricingCoverage?.partial ? '≥ ' : ''}${moneyFormat.format(cost.total)}`)}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.quality'))}</p><p class="drawer-diagnostics">${escapeHtml(diagnostics)}</p></section>`;
}
