export function countdownParts(resetsAt, now = Date.now()) {
  const reset = Date.parse(resetsAt || '');
  if (!Number.isFinite(reset)) return null;
  const remainingSeconds = Math.max(0, Math.ceil((reset - now) / 1_000));
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return { expired: reset <= now, days, hours, minutes, seconds };
}

export function windowLabelKey(window) {
  if (window?.kind === 'five-hour') return 'accountUsage.window.fiveHour';
  if (window?.kind === 'seven-day') return 'accountUsage.window.sevenDay';
  if (window?.kind === 'seven-day-sonnet') return 'accountUsage.window.sevenDaySonnet';
  if (window?.kind === 'seven-day-opus') return 'accountUsage.window.sevenDayOpus';
  if (window?.windowSeconds === 604_800) return 'accountUsage.window.weekly';
  return window?.id === 'secondary' ? 'accountUsage.window.secondary' : 'accountUsage.window.primary';
}

export function formatCountdown(resetsAt, translate, now = Date.now()) {
  const value = countdownParts(resetsAt, now);
  if (!value) return translate('accountUsage.reset.unknown');
  if (value.expired) return translate('accountUsage.reset.now');
  const time = [value.hours, value.minutes, value.seconds].map((part) => String(part).padStart(2, '0')).join(':');
  return value.days ? translate('accountUsage.countdown.days', { days: value.days, time }) : time;
}

export function remainingPercent(window) {
  const value = window?.remainingPercent;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function quotaWindowForDisplay(window, { stale = false, now = Date.now() } = {}) {
  const reset = Date.parse(window.resetsAt || '');
  const resetExpired = stale && Number.isFinite(reset) && reset <= now;
  return resetExpired ? { ...window, usedPercent: null, remainingPercent: null, resetExpired: true } : window;
}

export function renderQuotaStrip(host, windows, translate, formatDate) {
  host.replaceChildren(...windows.map((window) => {
    const item = document.createElement('div'); item.className = 'quota-strip-window';
    const label = document.createElement('span'); label.textContent = translate(windowLabelKey(window));
    const value = document.createElement('strong'); const remaining = remainingPercent(window);
    value.textContent = remaining == null ? '—' : translate('accountUsage.remaining', { value: Math.round(remaining * 10) / 10 });
    const reset = document.createElement('span'); reset.className = 'muted';
    reset.textContent = window.resetExpired ? translate('accountUsage.reset.expired') : window.resetsAt ? translate('accountUsage.resets', { date: formatDate(window.resetsAt) }) : translate('accountUsage.reset.unknown');
    item.append(label, value, reset); return item;
  }));
}
