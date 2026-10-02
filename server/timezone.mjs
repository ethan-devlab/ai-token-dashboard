const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DATE_LIMIT = 8_640_000_000_000_000;
const formatters = new Map();
const offsetWindows = new Map();

function invalidRange(message = 'Invalid selected time range.') { const error = new Error(message); error.code = 'INVALID_RANGE'; throw error; }
function zonedParts(timestamp, timezone) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'iso8601', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    if (formatters.size >= 128) formatters.delete(formatters.keys().next().value);
    formatters.set(timezone, formatter);
  }
  const result = {};
  for (const field of formatter.formatToParts(new Date(timestamp))) if (field.type !== 'literal') result[field.type] = field.type === 'era' ? field.value : Number(field.value);
  if (result.era === 'BC') result.year = 1 - result.year;
  return result;
}
export function resolveTimezone(value) {
  const timezone = value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
  catch { const error = new Error('Invalid timezone.'); error.code = 'INVALID_TIMEZONE'; throw error; }
  return timezone;
}
function civilValue(parts) {
  // Date.UTC remaps years 0–99 to 1900–1999. Set the full year explicitly.
  const date = new Date(0); date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
  return date.getTime();
}
function dateParts(date) { return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0, second: 0 }; }
function calendarStart(parts) { return { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 }; }
function addDays(parts, days) { return dateParts(new Date(civilValue({ ...calendarStart(parts), day: parts.day + days }))); }
function validCivil(parts) {
  const value = civilValue(parts); const date = new Date(value);
  return Number.isFinite(value) && date.getUTCFullYear() === parts.year && date.getUTCMonth() + 1 === parts.month && date.getUTCDate() === parts.day && date.getUTCHours() === (parts.hour || 0) && date.getUTCMinutes() === (parts.minute || 0) && date.getUTCSeconds() === (parts.second || 0);
}
function offsetAt(timestamp, timezone) { return civilValue(zonedParts(timestamp, timezone)) - Math.floor(timestamp / 1000) * 1000; }
function offsetWindow(target, timezone) {
  const day = Math.floor(target / DAY_MS) * DAY_MS; const key = `${timezone}:${day}`;
  if (offsetWindows.has(key)) return offsetWindows.get(key);
  const offsets = new Set(); const transitions = []; let previous;
  // Nearby offsets expose both sides of a gap or fold, including half-hour transitions.
  for (let time = Math.max(-DATE_LIMIT, day - 2 * DAY_MS); time <= Math.min(DATE_LIMIT, day + 3 * DAY_MS); time += 6 * HOUR_MS) {
    const offset = offsetAt(time, timezone); offsets.add(offset);
    if (previous && previous.offset !== offset) {
      let left = previous.time; let right = time;
      while (right - left > 1000) {
        const middle = Math.floor((left + right) / 2000) * 1000;
        if (offsetAt(middle, timezone) === previous.offset) left = middle; else right = middle;
      }
      transitions.push(right);
    }
    previous = { time, offset };
  }
  const result = { offsets: [...offsets], transitions };
  if (offsetWindows.size >= 1024) offsetWindows.delete(offsetWindows.keys().next().value);
  offsetWindows.set(key, result); return result;
}
function localCandidates(parts, timezone) {
  const target = civilValue(parts);
  if (!validCivil(parts)) return [];
  const millisecond = parts.millisecond || 0;
  return offsetWindow(target, timezone).offsets.map((offset) => target - offset).filter((time) => Math.abs(time) <= DATE_LIMIT && civilValue(zonedParts(time, timezone)) + millisecond === target).sort((a, b) => a - b);
}
export function zonedMidnightMs(parts, timezone) {
  const matches = localCandidates(parts, timezone);
  if (matches.length) return matches[0];
  // Calendar boundaries use the first instant after a midnight gap. Custom inputs remain strict.
  const target = civilValue(parts);
  const transition = offsetWindow(target, timezone).transitions.find((time) => civilValue(zonedParts(time - 1000, timezone)) < target && civilValue(zonedParts(time, timezone)) >= target);
  if (transition != null) return transition;
  invalidRange('The calendar boundary cannot be resolved in the selected timezone.');
}
function localTimestamp(value, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
  if (!match) invalidRange('Enter a valid local date and time.');
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0) };
  if (parts.year < 1 || !validCivil(parts)) invalidRange('Enter a valid local date and time.');
  const matches = localCandidates(parts, timezone);
  if (matches.length !== 1) invalidRange('The local time is ambiguous or does not exist in this timezone. Use a precise chart interval or explicit UTC millisecond bounds.');
  return matches[0];
}
function isoWeekStart(year, week) {
  const january = { year, month: 1, day: 4 }; const weekday = new Date(civilValue(january)).getUTCDay() || 7;
  return addDays(january, 1 - weekday + (week - 1) * 7);
}
function periodStart(mode, period, today) {
  if (period == null) {
    if (mode === 'week') return addDays(today, 1 - (new Date(civilValue(today)).getUTCDay() || 7));
    if (mode === 'month') return { ...today, day: 1 };
    if (mode === 'year') return { ...today, month: 1, day: 1 };
    return today;
  }
  const pattern = mode === 'week' ? /^(\d{4})-W(\d{2})$/ : mode === 'month' ? /^(\d{4})-(\d{1,2})$/ : mode === 'year' ? /^(\d{4})$/ : null;
  const match = pattern?.exec(period);
  if (!match || Number(match[1]) < 1) invalidRange('Invalid period for the selected mode.');
  const year = Number(match[1]); const value = Number(match[2]);
  if (mode === 'year') return { year, month: 1, day: 1 };
  if (mode === 'month') { if (value < 1 || value > 12) invalidRange('Invalid month.'); return { year, month: value, day: 1 }; }
  const start = isoWeekStart(year, value);
  if (value < 1 || value > 53 || civilValue(start) >= civilValue(isoWeekStart(year + 1, 1))) invalidRange('Invalid ISO week.');
  return start;
}
function shiftMonth(parts, amount) { return dateParts(new Date(civilValue({ ...parts, month: parts.month + amount, day: 1 }))); }
function periodEnd(mode, parts) {
  if (mode === 'today') return addDays(parts, 1);
  if (mode === 'week') return addDays(parts, 7);
  if (mode === 'month') return shiftMonth(parts, 1);
  return { year: parts.year + 1, month: 1, day: 1 };
}
export function resolveRange({ mode, fromMs, toMs, period, start, end, timezone, nowMs = Date.now() }) {
  const resolvedTimezone = resolveTimezone(timezone);
  for (const value of [fromMs, toMs, nowMs]) if (value != null && (!Number.isSafeInteger(value) || Math.abs(value) > DATE_LIMIT)) invalidRange('Invalid UTC millisecond bound.');
  if (fromMs != null && toMs != null && fromMs >= toMs) invalidRange();
  const range = { mode, fromMs, toMs, timezone: resolvedTimezone, calendar: 'iso8601', interval: '[from,to)' };
  if (!['week', 'month', 'year'].includes(mode) && period != null) invalidRange('Invalid period for the selected mode.');
  if (mode === 'all') return range;
  if (mode === 'custom') {
    const resolvedFrom = fromMs ?? localTimestamp(start, resolvedTimezone); const resolvedTo = toMs ?? localTimestamp(end, resolvedTimezone);
    if (resolvedFrom >= resolvedTo) invalidRange('The end must be after the start.');
    return { ...range, fromMs: resolvedFrom, toMs: resolvedTo };
  }
  if (mode === 'last24h') return { ...range, fromMs: nowMs - DAY_MS, toMs: nowMs };
  if (!['today', 'week', 'month', 'year'].includes(mode)) invalidRange('Invalid range mode.');
  const selected = periodStart(mode, period, calendarStart(zonedParts(nowMs, resolvedTimezone)));
  const from = zonedMidnightMs(selected, resolvedTimezone); const to = zonedMidnightMs(periodEnd(mode, selected), resolvedTimezone);
  if (from >= to) invalidRange('The selected calendar period has no instants in this timezone.');
  return { ...range, fromMs: from, toMs: to };
}
function hourlyBoundaries(parts, timezone) {
  const rounded = { ...parts, minute: 0, second: 0 }; const target = civilValue(rounded); const next = new Date(target + HOUR_MS);
  const nextParts = { ...dateParts(next), hour: next.getUTCHours() };
  return [...localCandidates(rounded, timezone), ...localCandidates(nextParts, timezone), ...offsetWindow(target, timezone).transitions.filter((time) => {
    const before = civilValue(zonedParts(time - 1000, timezone)); const after = civilValue(zonedParts(time, timezone));
    return before >= target && before < target + HOUR_MS || after >= target && after <= target + HOUR_MS;
  })].sort((a, b) => a - b);
}
export function bucketFor(timestamp, unit, timezone) {
  const parts = zonedParts(timestamp, timezone);
  if (unit === 'hour') {
    const start = hourlyBoundaries(parts, timezone).filter((time) => time <= timestamp).at(-1);
    if (start == null) invalidRange('The hourly boundary cannot be resolved.');
    return start;
  }
  if (unit === 'month') parts.day = 1;
  if (unit === 'year') { parts.month = 1; parts.day = 1; }
  return zonedMidnightMs(calendarStart(parts), timezone);
}
export function nextBucketFor(timestamp, unit, timezone) {
  const parts = zonedParts(timestamp, timezone);
  if (unit === 'hour') {
    const end = hourlyBoundaries(parts, timezone).find((time) => time > timestamp);
    if (end == null) invalidRange('The hourly boundary cannot be resolved.');
    return end;
  }
  return zonedMidnightMs(periodEnd(unit === 'day' ? 'today' : unit, calendarStart(parts)), timezone);
}
export function comparisonRanges(range, nowMs = Date.now()) {
  if (range.mode === 'all' || range.fromMs == null || range.toMs == null) return null;
  if (range.mode === 'custom' || range.mode === 'last24h') {
    const from = range.fromMs - (range.toMs - range.fromMs);
    if (Math.abs(from) > DATE_LIMIT) return { available: false, reason: 'invalid-bound', basis: 'elapsed' };
    return { available: true, basis: 'elapsed', partial: false, currentRange: range, range: { ...range, fromMs: from, toMs: range.fromMs } };
  }
  if (nowMs <= range.fromMs) return { available: false, reason: 'not-started', basis: 'calendar' };
  const start = calendarStart(zonedParts(range.fromMs, range.timezone));
  const priorStart = range.mode === 'today' ? addDays(start, -1) : range.mode === 'week' ? addDays(start, -7) : range.mode === 'month' ? shiftMonth(start, -1) : { year: start.year - 1, month: 1, day: 1 };
  const priorFrom = zonedMidnightMs(priorStart, range.timezone); const priorEnd = range.fromMs; const partial = nowMs < range.toMs;
  let priorTo = priorEnd;
  if (partial) {
    const progress = { ...zonedParts(nowMs, range.timezone), millisecond: ((nowMs % 1000) + 1000) % 1000 };
    const target = range.mode === 'today' || range.mode === 'week' ? { ...addDays(progress, range.mode === 'today' ? -1 : -7), hour: progress.hour, minute: progress.minute, second: progress.second, millisecond: progress.millisecond } : { ...progress, year: priorStart.year, month: range.mode === 'month' ? priorStart.month : progress.month };
    // A missing date (March 31 -> February, leap day -> non-leap year) maps to period end.
    if (validCivil(target)) {
      const candidates = localCandidates(target, range.timezone);
      if (candidates.length !== 1) return { available: false, reason: 'ambiguous-progress', basis: 'calendar', partial: true };
      priorTo = Math.min(priorEnd, candidates[0]);
    }
  }
  if (priorFrom >= priorTo) return { available: false, reason: 'empty-period', basis: 'calendar', partial };
  return { available: true, basis: 'calendar', partial, currentRange: { ...range, toMs: partial ? nowMs : range.toMs }, range: { ...range, fromMs: priorFrom, toMs: priorTo } };
}
