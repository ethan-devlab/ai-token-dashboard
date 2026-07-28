import { escapeHtml, formatDate, integerFormat, moneyFormat, text } from './format.mjs';
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
  return `<button type="button" class="copy-value" data-copy-value="${escapeHtml(value)}">複製${label}</button>`;
}

function price(value) {
  return value == null ? '未提供' : `$${value} / 1M`;
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
    drawerItem('估算費用', estimated),
    drawerItem('定價匹配', escapeHtml(rateKey || '未知模型')),
    drawerItem('Input 單價', price(rate?.input), detailsClass),
    drawerItem('Cached 單價', price(rate?.cachedInput), detailsClass),
    drawerItem('Cache write 單價', price(rate?.cacheWrite), detailsClass),
    drawerItem('Output 單價', price(rate?.output), detailsClass),
  ].join('');
}

export function renderSessionDrawer(session, pricing, showDetails) {
  const cost = session.filteredCost || calculateCost(pricing, session.filteredEvents || session.usageEvents);
  const rateKey = findRate(pricing, session.model);
  const rate = rateKey ? pricing.rates[rateKey] : null;
  const detailsClass = showDetails ? 'drawer-detail' : 'drawer-detail drawer-detail--hidden';
  const diagnostics = [
    `JSONL 行數 ${integerFormat.format(session.lineCount)}`,
    `略過 ${integerFormat.format(session.invalidLineCount)} 行`,
    `略過 ${integerFormat.format(session.duplicateTokenCountEventCount)} 個重複累計事件`,
    `修正 ${integerFormat.format(session.cumulativeResetCount)} 次累計重設`,
  ].join(' · ');
  const identityItems = [
    drawerItem('Session ID', escapeHtml(text(session.sessionId))),
    drawerItem('模型', escapeHtml(text(session.model))),
    drawerItem('JSONL', escapeHtml(redactPath(session.file))),
    drawerItem('CWD', escapeHtml(redactPath(session.cwd))),
    session.originator ? drawerItem('CLI 來源', escapeHtml(text(session.originator))) : '',
    drawerItem('首次使用', escapeHtml(formatDate(session.firstTimestamp || session.modifiedAt))),
    drawerItem('最後使用', escapeHtml(formatDate(session.filteredLastTimestamp || session.lastTimestamp || session.modifiedAt))),
  ].join('');
  const timestampEstimated = session.filteredEvents?.some((event) => event.timestampEstimated);

  return `<div class="drawer-heading"><div><p class="eyebrow">SESSION DETAIL</p><h2 id="drawerTitle">${escapeHtml(text(session.sessionId))}</h2></div><button id="closeDrawer" type="button">關閉</button></div><section class="drawer-section"><p class="eyebrow">IDENTITY</p><dl class="drawer-grid">${identityItems}</dl><div class="drawer-actions">${copyButton(' Session ID', session.sessionId)}${copyButton(' JSONL 路徑', redactPath(session.file))}${copyButton(' 顯示中的 CWD', redactPath(session.cwd))}</div></section><section class="drawer-section"><p class="eyebrow">TOKENS</p><dl class="drawer-grid">${tokenItems(session, detailsClass)}</dl></section><section class="drawer-section"><p class="eyebrow">ESTIMATED API COST</p><dl class="drawer-grid">${costItems(cost, rateKey, rate, detailsClass)}</dl></section><section class="drawer-section"><p class="eyebrow">DATA QUALITY</p><p class="drawer-diagnostics">${escapeHtml(diagnostics)}</p><p class="drawer-diagnostics">來源：${escapeHtml(session.usageSource)}${timestampEstimated ? ' · 包含估算時間戳' : ''}</p></section>`;
}
