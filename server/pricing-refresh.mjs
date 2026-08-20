import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createPricing } from './pricing.mjs';

export const PRICING_DOCUMENT_URL = 'https://developers.openai.com/api/docs/pricing.md';
const PRICING_PAGE_URL = 'https://developers.openai.com/api/docs/pricing';
const MAX_DOCUMENT_BYTES = 1_048_576;

export class PricingRefreshError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PricingRefreshError';
    this.code = code;
  }
}

function utcDate(value) { return value.toISOString().slice(0, 10); }

function parsePrice(value) {
  const text = String(value || '').trim();
  if (text === '-') return null;
  const match = /^\$(\d+(?:\.\d+)?)$/.exec(text);
  const amount = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) throw new PricingRefreshError('invalid-source', `Invalid price value: ${text || '<empty>'}.`);
  return amount;
}

function modelId(value) {
  const id = String(value || '').replace(/\s+\([^)]*\)\s*$/, '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new PricingRefreshError('invalid-source', `Invalid model identifier: ${id || '<empty>'}.`);
  return id;
}

export function parseStandardPricingMarkdown(markdown) {
  const section = String(markdown || '').split('### Standard pricing data')[1];
  if (!section) throw new PricingRefreshError('invalid-source', 'The Standard pricing table was not found.');
  const lines = section.split(/\r?\n/);
  const header = lines.findIndex((line) => line.includes('| Model | Short context input | Short context cached input | Short context cache writes | Short context output |'));
  if (header < 0) throw new PricingRefreshError('invalid-source', 'The Standard pricing table header is invalid.');
  const rates = {};
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith('|')) break;
    const columns = line.split('|').slice(1, -1).map((value) => value.trim());
    if (columns.length < 5) throw new PricingRefreshError('invalid-source', 'The Standard pricing table row is invalid.');
    const id = modelId(columns[0]);
    if (rates[id]) throw new PricingRefreshError('invalid-source', `Duplicate model identifier: ${id}.`);
    rates[id] = {
      input: parsePrice(columns[1]),
      cachedInput: parsePrice(columns[2]),
      cacheWrite: parsePrice(columns[3]),
      output: parsePrice(columns[4]),
    };
  }
  if (Object.keys(rates).length < 10) throw new PricingRefreshError('invalid-source', 'The Standard pricing table is unexpectedly incomplete.');
  return rates;
}

function pricingRules(baseline, rates, effectiveFrom) {
  const existing = new Map(baseline.rules.map((rule) => [rule.id, rule]));
  return Object.entries(rates).map(([id, modelRates]) => {
    const rule = existing.get(id);
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      id,
      aliases: rule ? [...rule.aliases] : [id],
      pattern: rule?.pattern || `^${escaped}(?:-|$)`,
      effectiveFrom: rule?.effectiveFrom || effectiveFrom,
      rates: modelRates,
    };
  });
}

function refreshedPricing(baseline, fetchedRates, checkedAt, sourceUrl) {
  const rates = { ...baseline.rates, ...fetchedRates };
  const updatedAt = utcDate(new Date(checkedAt));
  return createPricing({
    ...baseline,
    updatedAt,
    checkedAt,
    source: sourceUrl,
    rules: pricingRules(baseline, rates, updatedAt),
  });
}

function serialisablePricing(pricing) {
  return {
    updatedAt: pricing.updatedAt,
    checkedAt: pricing.checkedAt,
    currency: pricing.currency,
    unitTokens: pricing.unitTokens,
    source: pricing.source,
    provider: pricing.provider || null,
    costDisclaimer: pricing.costDisclaimer || null,
    modifiers: pricing.modifiers ? {
      usGeoMultiplier: pricing.modifiers.usGeoMultiplier,
      usGeoPattern: pricing.modifiers.usGeoPattern?.source || null,
      fastMultiplier: pricing.modifiers.fastMultiplier,
      fastPattern: pricing.modifiers.fastPattern?.source || null,
    } : null,
    rules: pricing.rules.map((rule) => ({ id: rule.id, aliases: [...rule.aliases], pattern: rule.pattern, effectiveFrom: rule.effectiveFrom, rates: { ...rule.rates } })),
  };
}

function errorCode(error) {
  if (error instanceof PricingRefreshError) return error.code;
  if (error?.name === 'AbortError') return 'timeout';
  return 'network';
}

export function createPricingRefreshService({ baseline, cachePath, fetchImpl = fetch, now = () => new Date(), timeoutMs = 10_000, documentUrl = PRICING_DOCUMENT_URL, sourceUrl = PRICING_PAGE_URL, parseDocument = parseStandardPricingMarkdown, userAgent = 'codex-token-dashboard/2.0' }) {
  let pricing = baseline;
  let initialized = false;
  let initializePromise = null;
  let refreshPromise = null;
  let lastAutomaticAttemptDate = null;
  let lastCheckedAt = baseline.checkedAt || null;
  let lastSuccessfulAt = baseline.checkedAt || null;
  let lastError = null;
  let persistenceError = false;

  async function persist() {
    const temporary = `${cachePath}.${process.pid}.tmp`;
    const body = JSON.stringify({
      version: 1,
      pricing: serialisablePricing(pricing),
      lastAutomaticAttemptDate,
      lastCheckedAt,
      lastSuccessfulAt,
      lastError,
    }, null, 2);
    try {
      await writeFile(temporary, `${body}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, cachePath);
      persistenceError = false;
    } catch {
      persistenceError = true;
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async function initialize() {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      try {
        const stored = JSON.parse(await readFile(cachePath, 'utf8'));
        if (stored?.version !== 1 || !stored.pricing) throw new Error('Unsupported pricing cache.');
        const cached = createPricing(stored.pricing);
        if (cached.source !== sourceUrl) throw new Error('Unexpected pricing source.');
        pricing = cached;
        lastAutomaticAttemptDate = typeof stored.lastAutomaticAttemptDate === 'string' ? stored.lastAutomaticAttemptDate : null;
        lastCheckedAt = typeof stored.lastCheckedAt === 'string' ? stored.lastCheckedAt : cached.checkedAt || null;
        lastSuccessfulAt = typeof stored.lastSuccessfulAt === 'string' ? stored.lastSuccessfulAt : cached.checkedAt || null;
        lastError = typeof stored.lastError === 'string' ? stored.lastError : null;
      } catch (error) {
        if (error?.code !== 'ENOENT') persistenceError = true;
      }
      initialized = true;
    })();
    try { await initializePromise; } finally { initializePromise = null; }
  }

  function status() {
    return {
      source: sourceUrl,
      cadence: 'daily',
      updating: Boolean(refreshPromise),
      lastAutomaticAttemptDate,
      lastCheckedAt,
      lastSuccessfulAt,
      lastError,
      persistenceError,
    };
  }

  async function refresh({ manual = false } = {}) {
    await initialize();
    const attemptDate = utcDate(now());
    if (!manual && lastAutomaticAttemptDate === attemptDate) return { attempted: false, pricing, status: status() };
    if (!manual) {
      lastAutomaticAttemptDate = attemptDate;
      await persist();
    }
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const checkedAt = now().toISOString();
      lastCheckedAt = checkedAt;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(documentUrl, {
          headers: { Accept: 'text/markdown', 'User-Agent': userAgent },
          signal: controller.signal,
        });
        if (!response.ok) throw new PricingRefreshError('http', `Pricing source returned HTTP ${response.status}.`);
        if (!/^text\/(?:markdown|plain)\b/i.test(response.headers.get('content-type') || '')) throw new PricingRefreshError('invalid-source', 'The pricing source returned an unexpected content type.');
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_DOCUMENT_BYTES) throw new PricingRefreshError('invalid-source', 'The pricing document is too large.');
        const markdown = await response.text();
        if (Buffer.byteLength(markdown) > MAX_DOCUMENT_BYTES) throw new PricingRefreshError('invalid-source', 'The pricing document is too large.');
        const fetchedRates = parseDocument(markdown);
        const next = refreshedPricing(pricing, fetchedRates, checkedAt, sourceUrl);
        const changedModels = Object.keys(fetchedRates).filter((id) => JSON.stringify(pricing.rates[id]) !== JSON.stringify(next.rates[id])).sort();
        pricing = next;
        lastSuccessfulAt = checkedAt;
        lastError = null;
        await persist();
        return { attempted: true, changedModels, pricing, status: status() };
      } catch (error) {
        const code = errorCode(error);
        lastError = code;
        await persist();
        if (error instanceof PricingRefreshError) throw error;
        throw new PricingRefreshError(code, code === 'timeout' ? 'Pricing refresh timed out.' : 'Could not reach the pricing source.');
      } finally {
        clearTimeout(timeout);
      }
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }

  return Object.freeze({
    initialize,
    current: () => pricing,
    refresh,
    status,
  });
}
