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
