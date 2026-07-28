import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pricing = require('./pricing.json');

function freezeRates(rates) {
  return Object.freeze(Object.fromEntries(
    Object.entries(rates).map(([model, rate]) => [model, Object.freeze({ ...rate })])
  ));
}

export const PRICING = Object.freeze({ ...pricing, rates: freezeRates(pricing.rates) });
