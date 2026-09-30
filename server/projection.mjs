import { createHash, randomUUID } from 'node:crypto';

const epoch = randomUUID();

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value, (_, item) => item instanceof RegExp ? { pattern: item.source, flags: item.flags } : item)).digest('hex');
}

export function projectionIdentity(summary, request, scan) {
  const pricing = summary.pricing;
  const query = { range: request.range, q: request.q, sort: request.sort, filters: Object.fromEntries(Object.entries(request.filters).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()])) };
  // A check-only pricing refresh does not change the calculation basis.
  const pricingRevision = digest({ provider: pricing.provider, updatedAt: pricing.updatedAt, source: pricing.source, currency: pricing.currency, unitTokens: pricing.unitTokens, rates: pricing.rates, rules: pricing.rules, modifiers: pricing.modifiers, costDisclaimer: pricing.costDisclaimer });
  // Versions restart at one after a server restart. The epoch prevents false matches.
  const identity = { epoch, provider: summary.provider || 'codex', snapshotVersion: scan.snapshotVersion, pricingRevision, query, at: request.nowMs };
  return { ...identity, key: digest(identity) };
}

export function requireProjection(expected, actual) {
  if (expected == null) return;
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Object.assign(new Error('Invalid projection identity.'), { status: 400, code: 'INVALID_QUERY' });
  if (expected !== actual.key) throw Object.assign(new Error('The displayed projection is outdated. Load the complete dashboard before continuing.'), { status: 409, code: 'PROJECTION_CONFLICT' });
}
