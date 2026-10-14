import { getLocale } from './i18n.mjs';

export const integerFormat = Object.freeze({
  format: (value) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(value),
});
export const dateFormat = Object.freeze({
  format: (value, timezone) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(value),
});

export function formatCost(value, partial = false) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (Number(value) > 0 && Number(value) < 0.000001) {
    if (!partial) return `< ${moneyFormat.format(0.000001)}`;
    const scientific = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD', notation: 'scientific', minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(Number(value));
    return `≥ ${scientific}`;
  }
  return `${partial ? '≥ ' : ''}${moneyFormat.format(Number(value))}`;
}
export function formatOverviewCost(value, partial = false) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const currency = (amount) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  if (!partial) return number > 0 && number < 0.01 ? `< ${currency(0.01)}` : currency(number);
  // A lower bound must never round upward past the known subtotal.
  if (number > 0 && number < 0.01) return formatCost(number, true);
  // Truncate the decimal value without multiplying into a binary rounding error (0.29 * 100).
  const [whole, fraction = ''] = number.toString().split('.');
  const floorCents = number < 0 ? Math.floor(number * 100) / 100 : whole.includes('e') ? number : Number(`${whole}.${fraction.slice(0, 2)}`);
  return `≥ ${currency(floorCents)}`;
}
export const moneyFormat = Object.freeze({
  format: (value) => new Intl.NumberFormat(getLocale(), {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(value),
});

export function formatCompactNumber(value, unit) {
  const number = Number(value || 0);
  if (unit === 'exact') return integerFormat.format(number);
  const table = unit === 'auto'
    ? (Math.abs(number) >= 1e9 ? ['B', 1e9] : Math.abs(number) >= 1e6 ? ['M', 1e6] : Math.abs(number) >= 1e3 ? ['K', 1e3] : ['', 1])
    : [unit, unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : 1e3];
  const [suffix, divisor] = table;
  if (!suffix) return integerFormat.format(number);
  const scaled = number / divisor;
  const digits = Math.abs(scaled) >= 100 ? 1 : Math.abs(scaled) >= 10 ? 2 : 3;
  return `${scaled.toLocaleString(getLocale(), { maximumFractionDigits: digits })}${suffix}`;
}

export function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

export function addUsage(total, usage) {
  for (const key of Object.keys(total)) total[key] += Number(usage?.[key] || 0);
  return total;
}

export function text(value) {
  return value == null || value === '' ? '—' : String(value);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatDate(value, timezone) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date, timezone);
}

export function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isoWeekValue(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isoWeekStart(value) {
  const match = /^([0-9]{4})-W([0-9]{2})$/.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const monday = new Date(year, 0, 4 - jan4Day + 1 + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function formatIntervalBoundary(value, timezone) {
  return new Intl.DateTimeFormat(getLocale(), { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(value);
}

export function zonedDateTimeValue(value, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
