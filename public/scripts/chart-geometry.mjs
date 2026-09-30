export function chartDomain(points) {
  return points.length ? [points[0].fromMs, points.at(-1).toMs] : [0, 1];
}

export function chartValue(point, metric) {
  const value = point?.[metric];
  return value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
}

export function numericScale(points, metric, domain = chartDomain(points)) {
  const maximum = points.reduce((max, point) => point.toMs > domain[0] && point.fromMs < domain[1] ? Math.max(max, chartValue(point, metric) || 0) : max, 0);
  const rawStep = (maximum || 1) / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].find((value) => value * power >= rawStep) * power;
  const max = Math.ceil((maximum || 1) / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step);
  return { max, ticks };
}

export function timeTicks(domain, width) {
  const count = Math.max(2, Math.min(7, Math.floor(width / 150)));
  // Leave room for labels at both ends; preserve the full supplied time domain.
  return Array.from({ length: count }, (_, index) => domain[0] + (domain[1] - domain[0]) * (index + 0.5) / count);
}

export function nearestBucketIndex(points, timestamp) {
  if (!points.length) return -1;
  let left = 0; let right = points.length;
  while (left < right) { const middle = (left + right) >>> 1; if (points[middle].fromMs <= timestamp) left = middle + 1; else right = middle; }
  const previous = Math.max(0, left - 1); const next = Math.min(points.length - 1, left);
  if (timestamp < points[previous].toMs) return previous;
  return Math.abs(timestamp - points[previous].toMs) <= Math.abs(points[next].fromMs - timestamp) ? previous : next;
}

export function snappedInterval(points, from, to) {
  const low = Math.min(from, to); const high = Math.max(from, to);
  const matched = points.filter((point) => point.toMs > low && point.fromMs < high);
  return matched.length ? [matched[0].fromMs, matched.at(-1).toMs] : null;
}

export function chartColumns(points, metrics, mark) {
  const columns = Array.from({ length: metrics.length + 1 }, () => []);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]; const prior = points[index - 1];
    if (mark === 'line' && prior && prior.toMs < point.fromMs) {
      columns[0].push((prior.toMs + point.fromMs) / 2000);
      for (const column of columns.slice(1)) column.push(null);
    }
    columns[0].push(mark === 'line' ? (point.fromMs + point.toMs) / 2000 : point.fromMs / 1000);
    metrics.forEach((metric, series) => columns[series + 1].push(chartValue(point, metric)));
  }
  return columns;
}

export function comparisonFixture(name) {
  const start = Date.parse('2026-09-01T00:00:00Z'); const day = 86_400_000;
  if (name === 'empty') return { timezone: 'UTC', points: [] };
  if (name === 'dst') {
    const boundaries = ['2026-03-07T05:00:00Z', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', '2026-03-10T04:00:00Z'].map(Date.parse);
    return { timezone: 'America/New_York', points: boundaries.slice(0, -1).map((fromMs, index) => ({ fromMs, toMs: boundaries[index + 1], tokens: (index + 1) * 1000, cost: (index + 1) * 0.002 })) };
  }
  const count = name === 'dense' ? 10_000 : name === 'one' ? 1 : 8;
  const step = name === 'dense' ? 60_000 : day;
  const points = Array.from({ length: count }, (_, index) => ({ fromMs: start + index * step, toMs: start + (index + 1) * step, tokens: name === 'zero' ? 0 : name === 'large' ? (index + 1) * 1e12 : (index % 13 + 1) * 1200, cost: name === 'zero' ? 0 : name === 'partial' ? index === 0 ? null : index * 0.000001 : (index % 17 + 1) * 0.035, partialCost: name === 'partial' && index % 2 === 1 }));
  if (name === 'partial') { points[1].cost = 0.00000001; points[2].cost = 0.00000002; }
  return { timezone: 'UTC', points: name === 'sparse' ? points.filter((_, index) => [0, 1, 5, 7].includes(index)) : points };
}
