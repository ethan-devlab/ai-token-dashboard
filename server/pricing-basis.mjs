import { createHash } from 'node:crypto';
import { createPricing } from './pricing.mjs';

function pattern(value) { return value == null ? null : value instanceof RegExp ? value.source : value; }

export function pricingBasis(pricing) {
  return {
    provider: pricing.provider || 'codex', source: pricing.source, currency: pricing.currency, unitTokens: pricing.unitTokens,
    costDisclaimer: pricing.costDisclaimer || null,
    rules: pricing.rules.map((rule) => ({ id: rule.id, aliases: [...rule.aliases].sort(), pattern: rule.pattern, effectiveFrom: rule.effectiveFrom, rates: { ...rule.rates } })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    modifiers: pricing.modifiers ? { usGeoMultiplier: pricing.modifiers.usGeoMultiplier, usGeoPattern: pattern(pricing.modifiers.usGeoPattern), fastMultiplier: pricing.modifiers.fastMultiplier, fastPattern: pattern(pricing.modifiers.fastPattern) } : null,
  };
}

export function pricingRevision(pricing) { return createHash('sha256').update(JSON.stringify(pricingBasis(pricing))).digest('hex'); }

export function pricingFromBasis(basis) {
  if (!basis || !['codex', 'claude'].includes(basis.provider) || typeof basis.source !== 'string' || !/^https:\/\//.test(basis.source) || basis.currency !== 'USD' || (basis.costDisclaimer != null && typeof basis.costDisclaimer !== 'string')) throw new Error('Invalid pricing basis.');
  return createPricing(basis);
}
