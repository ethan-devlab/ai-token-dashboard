import { escapeHtml, formatCompactNumber, formatDate, moneyFormat, text } from './format.mjs';
import { t } from './i18n.mjs';
import { findRate } from './state.mjs';

function costText(cost) {
  if (cost.pricedTokens === 0) return '—';
  return `${cost.unknownModels.size || cost.unavailableComponents.size ? '≥ ' : ''}${moneyFormat.format(cost.total)}`;
}

export function sessionStatus(session, pricing) {
  const cost = session.filteredCost;
  if (!findRate(pricing, session.model)) return { label: t('status.unpriced'), kind: 'warning' };
  if (cost.unavailableComponents.size) return { label: t('status.partial'), kind: 'warning' };
  if (session.invalidLineCount || session.cumulativeResetCount) return { label: t('status.quality'), kind: 'warning' };
  return { label: t('status.complete'), kind: 'good' };
}

export function renderExplorerRows(sessions, { pricing, selectedFile, unit }) {
  return sessions.map((session, index) => {
    const usage = session.filteredUsage;
    const status = sessionStatus(session, pricing);
    const modelClass = findRate(pricing, session.model) ? 'pill' : 'pill unknown';
    const sessionName = escapeHtml(text(session.sessionId));
    return `<tr tabindex="0" data-session-index="${index}" aria-selected="${session.file === selectedFile}"><td data-column="lastUsed">${escapeHtml(formatDate(session.filteredLastTimestamp || session.lastTimestamp || session.modifiedAt))}</td><td class="session"><strong>${sessionName}</strong><br /><span class="muted">${escapeHtml(session.file)}</span></td><td data-column="model"><span class="${modelClass}">${escapeHtml(text(session.model))}</span></td><td><strong>${formatCompactNumber(usage.totalTokens, unit)}</strong></td><td data-column="input">${formatCompactNumber(usage.inputTokens, unit)}</td><td data-column="output">${formatCompactNumber(usage.outputTokens, unit)}</td><td data-column="cost"><strong>${escapeHtml(costText(session.filteredCost))}</strong></td><td><span class="pill ${status.kind}">${status.label}</span></td><td><button class="expand-session" type="button" data-session-index="${index}" aria-label="${escapeHtml(t('explorer.open', { session: text(session.sessionId) }))}">${escapeHtml(t('view.label'))}</button></td></tr>`;
  }).join('');
}
