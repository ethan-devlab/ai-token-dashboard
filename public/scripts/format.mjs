import { getLocale } from './i18n.mjs';

export const integerFormat = Object.freeze({
  format: (value) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(value),
});
export const dateFormat = Object.freeze({
  format: (value) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(value),
});
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

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
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
