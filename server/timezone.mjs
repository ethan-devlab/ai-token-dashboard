const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function zonedParts(timestamp, timezone) {
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'iso8601',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const result = {};
  for (const field of fields) if (field.type !== 'literal') result[field.type] = Number(field.value);
  return result;
}

export function resolveTimezone(value) {
  const timezone = value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    const error = new Error('Invalid timezone.');
    error.code = 'INVALID_TIMEZONE';
    throw error;
  }
  return timezone;
}

function civilValue(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}

function dateParts(date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0, second: 0 };
}

function calendarStart(parts) {
  return { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 };
}

export function zonedMidnightMs(parts, timezone) {
  const target = civilValue(parts);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = civilValue(zonedParts(candidate, timezone));
    const adjustment = target - actual;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return candidate;
}

function addDays(parts, days) {
  return dateParts(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)));
}

function localTimestamp(value, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
  if (!match) return null;
  const target = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0) };
  if (target.month < 1 || target.month > 12 || target.day < 1 || target.day > 31 || target.hour > 23 || target.minute > 59 || target.second > 59) return null;
  let candidate = civilValue(target);
  for (let attempt = 0; attempt < 4; attempt += 1) candidate += civilValue(target) - civilValue(zonedParts(candidate, timezone));
  return civilValue(zonedParts(candidate, timezone)) === civilValue(target) ? candidate : null;
}

function selectedParts(mode, period, today) {
  if (mode === 'month' && /^\d{4}-\d{2}$/.test(period || '')) { const [year, month] = period.split('-').map(Number); if (month >= 1 && month <= 12) return { year, month, day: 1 }; }
  if (mode === 'year' && /^\d{4}$/.test(period || '')) return { year: Number(period), month: 1, day: 1 };
  return today;
}

export function resolveRange({ mode, fromMs, toMs, period, start, end, timezone, nowMs = Date.now() }) {
  const resolvedTimezone = resolveTimezone(timezone);
  const range = { mode, fromMs, toMs, timezone: resolvedTimezone, calendar: 'iso8601', interval: '[from,to)' };
  if (mode === 'all') return range;
  if (mode === 'custom') {
    const resolvedFrom = fromMs ?? localTimestamp(start, resolvedTimezone);
    const resolvedTo = toMs ?? localTimestamp(end, resolvedTimezone);
    if (resolvedFrom == null || resolvedTo == null || resolvedFrom >= resolvedTo) { const error = new Error('Invalid custom local time range.'); error.code = 'INVALID_RANGE'; throw error; }
    return { ...range, fromMs: resolvedFrom, toMs: resolvedTo };
  }
  if (mode === 'last24h') return { ...range, fromMs: nowMs - DAY_MS, toMs: nowMs };
  const today = calendarStart(zonedParts(nowMs, resolvedTimezone));
  const midnight = zonedMidnightMs(today, resolvedTimezone);
  if (mode === 'today') return { ...range, fromMs: midnight, toMs: zonedMidnightMs(addDays(today, 1), resolvedTimezone) };
  if (mode === 'week') {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() || 7;
    const start = addDays(today, 1 - weekday);
    return { ...range, fromMs: zonedMidnightMs(start, resolvedTimezone), toMs: zonedMidnightMs(addDays(start, 7), resolvedTimezone) };
  }
  if (mode === 'month') {
    const selected = { ...selectedParts(mode, period, today), day: 1 };
    const next = selected.month === 12 ? { year: selected.year + 1, month: 1, day: 1 } : { year: selected.year, month: selected.month + 1, day: 1 };
    return { ...range, fromMs: zonedMidnightMs(selected, resolvedTimezone), toMs: zonedMidnightMs(next, resolvedTimezone) };
  }
  if (mode === 'year') {
    const selected = selectedParts(mode, period, today);
    return { ...range, fromMs: zonedMidnightMs({ ...selected, month: 1, day: 1 }, resolvedTimezone), toMs: zonedMidnightMs({ ...selected, year: selected.year + 1, month: 1, day: 1 }, resolvedTimezone) };
  }
  return range;
}

export function bucketFor(timestamp, unit, timezone) {
  const parts = zonedParts(timestamp, timezone);
  if (unit === 'month') parts.day = 1;
  if (unit === 'year') { parts.month = 1; parts.day = 1; }
  if (unit === 'day' || unit === 'month' || unit === 'year') { parts.hour = 0; parts.minute = 0; parts.second = 0; }
  if (unit === 'hour') { parts.minute = 0; parts.second = 0; }
  return zonedMidnightMs(parts, timezone);
}

export function nextBucketFor(timestamp, unit, timezone) {
  if (unit === 'hour') return timestamp + HOUR_MS;
  const parts = zonedParts(timestamp, timezone);
  if (unit === 'day') return zonedMidnightMs(addDays(parts, 1), timezone);
  if (unit === 'month') {
    const next = parts.month === 12 ? { year: parts.year + 1, month: 1, day: 1 } : { year: parts.year, month: parts.month + 1, day: 1 };
    return zonedMidnightMs(next, timezone);
  }
  return zonedMidnightMs({ year: parts.year + 1, month: 1, day: 1 }, timezone);
}
