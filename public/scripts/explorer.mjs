import { escapeHtml, formatDate, integerFormat, moneyFormat, text } from './format.mjs';
import { findRate } from './state.mjs';

function compactNumber(value, unit) {
  const number = Number(value || 0);
  if (unit === 'exact') return integerFormat.format(number);
  const table = unit === 'auto'
    ? (Math.abs(number) >= 1e9 ? ['B', 1e9] : Math.abs(number) >= 1e6 ? ['M', 1e6] : Math.abs(number) >= 1e3 ? ['K', 1e3] : ['', 1])
    : [unit, unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : 1e3];
  const [suffix, divisor] = table;
  if (!suffix) return integerFormat.format(number);
  const scaled = number / divisor;
  const digits = Math.abs(scaled) >= 100 ? 1 : Math.abs(scaled) >= 10 ? 2 : 3;
  return `${scaled.toLocaleString('zh-TW', { maximumFractionDigits: digits })}${suffix}`;
}

function costText(cost) {
  if (cost.pricedTokens === 0) return '—';
  return `${cost.unknownModels.size || cost.unavailableComponents.size ? '≥ ' : ''}${moneyFormat.format(cost.total)}`;
}

export function sessionStatus(session, pricing) {
  const cost = session.filteredCost;
  if (!findRate(pricing, session.model)) return { label: '未定價', kind: 'warning' };
  if (cost.unavailableComponents.size) return { label: '定價部分', kind: 'warning' };
  if (session.invalidLineCount || session.cumulativeResetCount) return { label: '資料提醒', kind: 'warning' };
  return { label: '完整', kind: 'good' };
}

export function renderExplorerRows(sessions, { pricing, selectedFile, unit }) {
  return sessions.map((session, index) => {
    const usage = session.filteredUsage;
    const status = sessionStatus(session, pricing);
    const modelClass = findRate(pricing, session.model) ? 'pill' : 'pill unknown';
    const sessionName = escapeHtml(text(session.sessionId));
    return `<tr tabindex="0" data-session-index="${index}" aria-selected="${session.file === selectedFile}"><td data-column="lastUsed">${escapeHtml(formatDate(session.filteredLastTimestamp || session.lastTimestamp || session.modifiedAt))}</td><td class="session"><strong>${sessionName}</strong><br /><span class="muted">${escapeHtml(session.file)}</span></td><td data-column="model"><span class="${modelClass}">${escapeHtml(text(session.model))}</span></td><td><strong>${compactNumber(usage.totalTokens, unit)}</strong></td><td data-column="input">${compactNumber(usage.inputTokens, unit)}</td><td data-column="output">${compactNumber(usage.outputTokens, unit)}</td><td data-column="cost"><strong>${escapeHtml(costText(session.filteredCost))}</strong></td><td><span class="pill ${status.kind}">${status.label}</span></td><td><button class="expand-session" type="button" data-session-index="${index}" aria-label="查看 ${sessionName} 的細節">查看</button></td></tr>`;
  }).join('');
}
