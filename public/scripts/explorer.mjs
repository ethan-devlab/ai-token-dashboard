import { escapeHtml, formatCompactNumber, formatCost, formatDate, integerFormat, text } from './format.mjs';
import { t } from './i18n.mjs';

function usageFor(session) { return session.usage || session.filteredUsage || {}; }
function costFor(session) { return session.cost || session.filteredCost || {}; }
function statusFor(session) { const status = session.pricingStatus || session.status || (costFor(session).partial ? 'partial' : 'complete'); return { label: t(`status.${status}`), kind: ['unpriced', 'partial', 'quality'].includes(status) ? 'warning' : 'good' }; }
function costText(cost) { return formatCost(cost.total, cost.partial || cost.minimumKnown || cost.pricingCoverage?.partial); }

function tokenCell(value, unit) {
  const exact = unit === 'exact' ? '' : `<span class="cell-exact">${integerFormat.format(value || 0)}</span>`;
  return `${formatCompactNumber(value, unit)}${exact}`;
}

export function renderExplorerRows(sessions = [], { selectedKey, unit, timezone }) {
  return sessions.map((session) => { const usage = usageFor(session); const cost = costFor(session); const status = statusFor(session); const key = text(session.sessionKey || session.id || session.sessionId); return `<tr data-session-key="${escapeHtml(key)}" aria-selected="${key === selectedKey}"><td data-column="lastUsed">${escapeHtml(formatDate(session.lastUsed || session.filteredLastTimestamp || session.lastTimestamp, timezone))}</td><td class="session"><strong>${escapeHtml(text(session.sessionId || session.label || key))}</strong><span class="muted detail-col">${escapeHtml(text(session.workspace || session.file))}</span></td><td data-column="model"><span class="pill ${status.kind === 'warning' ? 'unknown' : ''}">${escapeHtml(text(session.model))}</span></td><td><strong>${tokenCell(usage.totalTokens, unit)}</strong></td><td data-column="input">${tokenCell(usage.inputTokens, unit)}</td><td data-column="output">${tokenCell(usage.outputTokens, unit)}</td><td data-column="cost"><strong>${escapeHtml(costText(cost))}</strong></td><td><span class="pill ${status.kind}">${escapeHtml(status.label)}</span></td><td><button class="expand-session button--compact" type="button" data-session-key="${escapeHtml(key)}" aria-label="${escapeHtml(t('explorer.open', { session: text(session.sessionId || key) }))}">${escapeHtml(t('drawer.open'))}</button></td></tr>`; }).join('');
}
