import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = require('./pricing.json');

const RATE_FIELDS = Object.freeze(['input', 'cachedInput', 'cacheWrite', 'output']);

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRule(id, rate, effectiveFrom) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { id, aliases: [id], pattern: `^${escaped}(?:-|$)`, effectiveFrom, rates: rate };
}

export function createPricing(pricing) {
  if (!pricing || typeof pricing !== 'object' || !Number.isSafeInteger(pricing.unitTokens) || pricing.unitTokens <= 0) throw new Error('Invalid pricing configuration.');
  const rawRules = Array.isArray(pricing.rules)
    ? pricing.rules
    : Object.entries(pricing.rates || {}).map(([id, rate]) => asRule(id, rate, pricing.updatedAt));
  const names = new Set();
  const patterns = new Set();
  const rules = rawRules.map((raw) => {
    if (!raw || typeof raw !== 'object' || !/^[a-z0-9][a-z0-9.-]*$/.test(raw.id || '') || !Array.isArray(raw.aliases) || !raw.aliases.length || typeof raw.pattern !== 'string' || dateValue(raw.effectiveFrom) == null) throw new Error('Invalid pricing rule.');
    let matcher;
    try { matcher = new RegExp(raw.pattern, 'i'); } catch { throw new Error(`Invalid pricing pattern for ${raw.id}.`); }
    if (!raw.pattern.startsWith('^')) throw new Error(`Pricing pattern must be anchored for ${raw.id}.`);
    for (const alias of raw.aliases) {
      const normalized = String(alias).toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(normalized) || names.has(normalized)) throw new Error(`Overlapping pricing alias: ${alias}.`);
      names.add(normalized);
    }
    if (patterns.has(raw.pattern)) throw new Error(`Overlapping pricing pattern: ${raw.pattern}.`);
    patterns.add(raw.pattern);
    const rates = {};
    for (const field of RATE_FIELDS) {
      const value = raw.rates?.[field];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`Invalid ${field} price for ${raw.id}.`);
      rates[field] = value ?? null;
    }
    return Object.freeze({ id: raw.id, aliases: Object.freeze(raw.aliases.map((alias) => String(alias).toLowerCase())), pattern: raw.pattern, matcher, effectiveFrom: raw.effectiveFrom, effectiveFromMs: dateValue(raw.effectiveFrom), rates: Object.freeze(rates) });
  });
  if (!rules.length) throw new Error('Pricing must contain at least one rule.');
  return Object.freeze({ ...pricing, rules: Object.freeze(rules), rates: freezeRates(Object.fromEntries(rules.map((rule) => [rule.id, rule.rates]))) });
}

function freezeRates(rates) {
  return Object.freeze(Object.fromEntries(
    Object.entries(rates).map(([model, rate]) => [model, Object.freeze({ ...rate })])
  ));
}

export function matchPricingRule(pricing, model, timestamp) {
  const normalized = String(model || '').trim().toLowerCase();
  const at = Date.parse(timestamp || '') || Date.now();
  const matches = pricing.rules.filter((rule) => rule.effectiveFromMs <= at && (rule.aliases.includes(normalized) || rule.matcher.test(normalized)));
  if (!matches.length) return null;
  return matches.sort((left, right) => right.id.length - left.id.length || right.effectiveFromMs - left.effectiveFromMs)[0];
}

export const PRICING = createPricing(source);
