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
