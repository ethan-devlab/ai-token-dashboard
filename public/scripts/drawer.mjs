import { escapeHtml, formatDate, integerFormat, moneyFormat, text } from './format.mjs';
import { t } from './i18n.mjs';
import { calculateCost, findRate } from './state.mjs';

export function redactPath(value) {
  const path = text(value).replaceAll('\\', '/');
  return path
    .replace(/^[A-Z]:\/Users\/[^/]+/i, '~')
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~');
}

export function shortPath(value) {
  const parts = redactPath(value).split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || '—';
}

function drawerItem(label, value, className = '') {
  const classAttribute = className ? ` class="${className}"` : '';
  return `<div${classAttribute}><dt>${label}</dt><dd>${value}</dd></div>`;
}

function copyButton(label, value) {
  return `<button type="button" class="copy-value" data-copy-value="${escapeHtml(value)}">${escapeHtml(t('drawer.copy', { label }))}</button>`;
}

function price(value) {
  return value == null ? t('price.unavailable') : `$${value} / 1M`;
}

function tokenItems(session, detailsClass) {
  const usage = session.filteredUsage;
  return [
    drawerItem('Total', integerFormat.format(usage.totalTokens)),
    drawerItem('Input', integerFormat.format(usage.inputTokens)),
    drawerItem('Output', integerFormat.format(usage.outputTokens)),
    drawerItem('Cached input', integerFormat.format(usage.cachedInputTokens)),
    drawerItem('Uncached input', integerFormat.format(usage.uncachedInputTokens), detailsClass),
    drawerItem('Cache write', integerFormat.format(usage.cacheWriteTokens), detailsClass),
    drawerItem('Reasoning output', integerFormat.format(usage.reasoningOutputTokens), detailsClass),
  ].join('');
}

function costItems(cost, rateKey, rate, detailsClass) {
  const estimated = cost.pricedTokens
    ? `${cost.unknownModels.size || cost.unavailableComponents.size ? '≥ ' : ''}${moneyFormat.format(cost.total)}`
    : '—';
  return [
    drawerItem(t('trend.cost'), estimated),
    drawerItem(t('table.model'), escapeHtml(rateKey || t('status.unpriced'))),
    drawerItem(`${t('table.input')} ${t('trend.value')}`, price(rate?.input), detailsClass),
    drawerItem(`${t('cached.input')} ${t('trend.value')}`, price(rate?.cachedInput), detailsClass),
    drawerItem(`${t('cache.write')} ${t('trend.value')}`, price(rate?.cacheWrite), detailsClass),
    drawerItem(`${t('table.output')} ${t('trend.value')}`, price(rate?.output), detailsClass),
  ].join('');
}

export function renderSessionDrawer(session, pricing, showDetails) {
  const cost = session.filteredCost || calculateCost(pricing, session.filteredEvents || session.usageEvents);
  const rateKey = findRate(pricing, session.model);
  const rate = rateKey ? pricing.rates[rateKey] : null;
  const detailsClass = showDetails ? 'drawer-detail' : 'drawer-detail drawer-detail--hidden';
  const diagnostics = [
    t('drawer.lines', { count: integerFormat.format(session.lineCount) }),
    t('drawer.skipped', { count: integerFormat.format(session.invalidLineCount) }),
    t('drawer.duplicates', { count: integerFormat.format(session.duplicateTokenCountEventCount) }),
    t('drawer.resets', { count: integerFormat.format(session.cumulativeResetCount) }),
  ].join(' · ');
  const identityItems = [
    drawerItem(t('drawer.sessionId'), escapeHtml(text(session.sessionId))),
    drawerItem(t('table.model'), escapeHtml(text(session.model))),
    drawerItem(t('drawer.jsonl'), escapeHtml(redactPath(session.file))),
    drawerItem(t('drawer.cwd'), escapeHtml(redactPath(session.cwd))),
    session.originator ? drawerItem(t('drawer.originator'), escapeHtml(text(session.originator))) : '',
    drawerItem(t('drawer.firstUsed'), escapeHtml(formatDate(session.firstTimestamp || session.modifiedAt))),
    drawerItem(t('table.lastUsed'), escapeHtml(formatDate(session.filteredLastTimestamp || session.lastTimestamp || session.modifiedAt))),
  ].join('');
  const timestampEstimated = session.filteredEvents?.some((event) => event.timestampEstimated);

  return `<div class="drawer-heading"><div><p class="eyebrow">${escapeHtml(t('drawer.title'))}</p><h2 id="drawerTitle">${escapeHtml(text(session.sessionId))}</h2></div><button id="closeDrawer" type="button">${escapeHtml(t('drawer.close'))}</button></div><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.identity'))}</p><dl class="drawer-grid">${identityItems}</dl><div class="drawer-actions">${copyButton(t('drawer.sessionId'), session.sessionId)}${copyButton(t('drawer.jsonl'), redactPath(session.file))}${copyButton(t('drawer.cwd'), redactPath(session.cwd))}</div></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.tokens'))}</p><dl class="drawer-grid">${tokenItems(session, detailsClass)}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.cost'))}</p><dl class="drawer-grid">${costItems(cost, rateKey, rate, detailsClass)}</dl></section><section class="drawer-section"><p class="eyebrow">${escapeHtml(t('drawer.quality'))}</p><p class="drawer-diagnostics">${escapeHtml(diagnostics)}</p><p class="drawer-diagnostics">${escapeHtml(session.usageSource)}${timestampEstimated ? ` · ${escapeHtml(t('drawer.estimatedTimestamp'))}` : ''}</p></section>`;
}
