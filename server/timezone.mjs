const DAY_MS = 86_400_000;

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

export function resolveRange({ mode, fromMs, toMs, timezone, nowMs = Date.now() }) {
  const resolvedTimezone = resolveTimezone(timezone);
  const range = { mode, fromMs, toMs, timezone: resolvedTimezone, calendar: 'iso8601', interval: '[from,to)' };
  if (mode === 'all') return range;
  if (mode === 'custom') return range;
  if (mode === 'last24h') return { ...range, fromMs: nowMs - DAY_MS, toMs: nowMs };
  const today = zonedParts(nowMs, resolvedTimezone);
  const midnight = zonedMidnightMs(today, resolvedTimezone);
  if (mode === 'today') return { ...range, fromMs: midnight, toMs: zonedMidnightMs(addDays(today, 1), resolvedTimezone) };
  if (mode === 'week') {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() || 7;
    const start = addDays(today, 1 - weekday);
    return { ...range, fromMs: zonedMidnightMs(start, resolvedTimezone), toMs: zonedMidnightMs(addDays(start, 7), resolvedTimezone) };
  }
  if (mode === 'month') {
    const start = { ...today, day: 1 };
    const end = today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 };
    return { ...range, fromMs: zonedMidnightMs(start, resolvedTimezone), toMs: zonedMidnightMs(end, resolvedTimezone) };
  }
  if (mode === 'year') {
    return { ...range, fromMs: zonedMidnightMs({ ...today, month: 1, day: 1 }, resolvedTimezone), toMs: zonedMidnightMs({ ...today, year: today.year + 1, month: 1, day: 1 }, resolvedTimezone) };
  }
  return range;
}

export function bucketFor(timestamp, unit, timezone) {
  const parts = zonedParts(timestamp, timezone);
  if (unit === 'month') parts.day = 1;
  if (unit === 'year') { parts.month = 1; parts.day = 1; }
  if (unit === 'day' || unit === 'month' || unit === 'year') { parts.hour = 0; parts.minute = 0; parts.second = 0; }
  if (unit === 'hour') { parts.minute = 0; parts.second = 0; }
  return zonedMidnightMs(parts, timezone) + (unit === 'hour' ? parts.hour * 3_600_000 : 0);
}
