import { createPricingRefreshService, PricingRefreshError } from './pricing-refresh.mjs';

export const CLAUDE_PRICING_DOCUMENT_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
export const CLAUDE_PRICING_PAGE_URL = 'https://platform.claude.com/docs/en/about-claude/pricing';

function price(value) {
  const match = /^\$(\d+(?:\.\d+)?)\s*(?:\/\s*MTok)?$/i.exec(String(value || '').trim());
  const amount = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) throw new PricingRefreshError('invalid-source', `Invalid Claude price value: ${String(value || '').trim() || '<empty>'}.`);
  return amount;
}

function modelId(value) {
  const plain = String(value || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (!/^claude-[a-z0-9][a-z0-9.-]*$/.test(plain)) throw new PricingRefreshError('invalid-source', `Invalid Claude model identifier: ${plain || '<empty>'}.`);
  return plain;
}

export function parseClaudePricingMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const header = lines.findIndex((line) => /\|\s*Model\s*\|\s*Base Input Tokens\s*\|\s*5m Cache Writes\s*\|\s*1h Cache Writes\s*\|\s*Cache Hits & Refreshes\s*\|\s*Output Tokens\s*\|/i.test(line));
  if (header < 0) throw new PricingRefreshError('invalid-source', 'The Claude model pricing table was not found.');
  const rates = {};
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith('|')) break;
    const columns = line.split('|').slice(1, -1).map((value) => value.trim());
    if (columns.length < 6) throw new PricingRefreshError('invalid-source', 'The Claude pricing table row is invalid.');
    const id = modelId(columns[0]);
    if (rates[id]) throw new PricingRefreshError('invalid-source', `Duplicate Claude model identifier: ${id}.`);
    rates[id] = {
      input: price(columns[1]),
      cachedInput: price(columns[4]),
      cacheWrite: null,
      cacheWrite5m: price(columns[2]),
      cacheWrite1h: price(columns[3]),
      output: price(columns[5]),
    };
  }
  if (Object.keys(rates).length < 8) throw new PricingRefreshError('invalid-source', 'The Claude pricing table is unexpectedly incomplete.');
  return rates;
}

export function createClaudePricingRefreshService(options) {
  return createPricingRefreshService({
    ...options,
    documentUrl: CLAUDE_PRICING_DOCUMENT_URL,
    sourceUrl: CLAUDE_PRICING_PAGE_URL,
    parseDocument: parseClaudePricingMarkdown,
    userAgent: 'local-ai-token-dashboard/2.1',
  });
}
