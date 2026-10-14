import { link, open, rename, rm, writeFile } from 'node:fs/promises';
import { createPricing } from './pricing.mjs';
import { createPricingArchive } from './pricing-archive.mjs';
import { pricingBasis, pricingFromBasis, pricingRevision } from './pricing-basis.mjs';
import { randomUUID } from 'node:crypto';

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
    if (columns.length >= 9 && columns[5] !== '-') {
      rates[id].contextTier = { aboveInputTokens: 272_000, rates: {
        input: parsePrice(columns[5]), cachedInput: parsePrice(columns[6]),
        cacheWrite: parsePrice(columns[7]), output: parsePrice(columns[8]),
      } };
    }
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
    ...serialisablePricing(baseline),
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

export function createPricingRefreshService({ baseline, cachePath, archiveDirectory = `${cachePath}.archive`, archiveStore, owner, fetchImpl = fetch, now = () => new Date(), timeoutMs = 10_000, documentUrl = PRICING_DOCUMENT_URL, sourceUrl = PRICING_PAGE_URL, parseDocument = parseStandardPricingMarkdown, userAgent = 'ai-token-dashboard-pricing-check' }) {
  // Standalone service consumers own their storage. The server always supplies its process owner.
  const authority = owner || { status: () => ({ writable: true, writeReason: null }), assertWritable: async () => {} };
  const archive = archiveStore || createPricingArchive({ directory: archiveDirectory, provider: baseline.provider || 'codex', now, beforeWrite: authority.assertWritable });
  let pricing = baseline; let archived = null; let trusted = null;
  let archiveError = null; let publicationError = null; let metadataError = null;
  let pricingOrigin = 'bundled'; let initialized = false; let fresh = false; let closing = false;
  let initializePromise; let refreshPromise; let tail = Promise.resolve(); let pending = 0;
  let lastAutomaticAttemptDate = null; let lastCheckedAt = null; let lastSuccessfulAt = null; let lastError = null;
  let currentView; let viewPricing; let viewArchive;
  const repairPath = `${cachePath}.repairing`;
  async function repairPending(revision = null) {
    let handle;
    try {
      handle = await open(repairPath, 'r');
      const buffer = Buffer.alloc(4097); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) return true;
      const record = JSON.parse(buffer.subarray(0, bytesRead));
      if (record.version !== 1 || record.provider !== (baseline.provider || 'codex') || !Array.isArray(record.revisions)
        || !record.revisions.length || record.revisions.length > 2 || record.revisions.some((value) => !/^[a-f0-9]{64}$/.test(value))) return true;
      return revision == null || record.revisions.includes(revision);
    } catch (error) { return error.code !== 'ENOENT'; }
    finally { await handle?.close(); }
  }
  async function markRepair(next) {
    const temporary = `${repairPath}.${randomUUID()}.tmp`;
    try {
      await authority.assertWritable();
      await writeFile(temporary, JSON.stringify({ version: 1, provider: baseline.provider || 'codex', revisions: [...new Set([pricingRevision(pricing), pricingRevision(next)])] }) + '\n', { flag: 'wx', mode: 0o600 });
      await authority.assertWritable(); await rename(temporary, repairPath);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  function enqueue(operation) {
    if (closing) return Promise.reject(new PricingRefreshError('closed', 'Pricing service is closed.'));
    pending++;
    const result = tail.then(operation);
    tail = result.catch(() => {}).finally(() => { pending--; });
    return result;
  }
  async function readPublication(file = cachePath) {
    const handle = await open(file, 'r'); let stored;
    try { const info = await handle.stat(); if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error('Invalid publication.'); const body = await handle.readFile(); if (body.length > MAX_DOCUMENT_BYTES) throw new Error('Invalid publication.'); stored = JSON.parse(body); }
    finally { await handle.close(); }
    if (stored?.version !== 1 || !stored.pricing) throw new Error('Invalid publication.');
    const next = createPricing(stored.pricing);
    const basis = pricingBasis(next); pricingFromBasis(basis);
    const revision = pricingRevision(next);
    if (next.source !== sourceUrl || basis.provider !== (baseline.provider || 'codex') || (stored.revision != null && stored.revision !== revision)) throw new Error('Invalid publication.');
    return { next, stored, revision, basis };
  }
  async function readPublished() {
    if (await repairPending()) throw new PricingRefreshError('repair-pending', 'Pricing repair has not been published.');
    const { next, stored, revision, basis } = await readPublication();
    const record = await archive.get(revision);
    if (JSON.stringify(record.basis) !== JSON.stringify(basis) || await repairPending()) throw new Error('Publication does not match its archive.');
    if (stored.metadataError || !record.lastCheckedAt && (stored.lastCheckedAt || next.checkedAt)) record.metadataError = 'metadata';
    return { next, record, stored };
  }
  function activate(next, record, origin) {
    pricing = next; archived = record; pricingOrigin = origin;
    trusted = { pricing: next, record };
    archiveError = null; publicationError = null; metadataError = record.metadataError || null;
    lastCheckedAt = metadataError ? null : record.lastCheckedAt; lastSuccessfulAt = lastCheckedAt;
  }
  async function publish(next, record, origin, activatePricing = true, preserveWarning = false) {
    const temporary = `${cachePath}.${randomUUID()}.tmp`;
    const warning = record.metadataError || (preserveWarning ? metadataError : null);
    const checkedAt = warning ? null : record.lastCheckedAt;
    const body = JSON.stringify({ version: 1, revision: record.revision, pricing: { ...serialisablePricing(next), checkedAt }, metadataError: warning,
      lastAutomaticAttemptDate, lastCheckedAt: checkedAt, lastSuccessfulAt: checkedAt, lastError: null }, null, 2) + '\n';
    try {
      await authority.assertWritable(); await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
      await authority.assertWritable(); await rename(temporary, cachePath);
      if (activatePricing) activate(next, record, origin);
    } catch (error) {
      publicationError = 'publication';
      if (error.code === 'PRICING_READ_ONLY') throw error;
      throw new PricingRefreshError('publication', 'Pricing publication failed; existing prices were retained.');
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async function sealAndPublish(next, origin, checkedAt = null, repair = false, retainedRecord = null, activatePricing = true) {
    let record;
    try { await authority.assertWritable(); record = await archive[repair ? 'repair' : 'save'](next, { origin, checkedAt, retainedRecord }); }
    catch (error) {
      archiveError = 'archive';
      if (error.code === 'PRICING_READ_ONLY' || error.code === 'PRICING_REPAIR_CONFLICT') throw error;
      throw new PricingRefreshError('archive', 'Pricing archive failed; existing prices were retained.');
    }
    const finishingRepair = activatePricing && await repairPending();
    await publish(next, record, origin, activatePricing && !finishingRepair);
    if (finishingRepair) {
      await authority.assertWritable(); await rm(repairPath);
      activate(next, record, origin);
    }
    return record;
  }
  async function initialize() {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = enqueue(async () => {
      try {
        const { next, record, stored } = await readPublished(); activate(next, record, 'cache');
        lastAutomaticAttemptDate = typeof stored.lastAutomaticAttemptDate === 'string' ? stored.lastAutomaticAttemptDate : null;
      } catch (error) {
        publicationError = 'publication'; archiveError = 'archive';
        // Pre-archive publications have no revision. Migrate only an intact legacy
        // cache with no existing archive or pending repair; never reseal v3 damage.
        if (authority.status().writable && !await repairPending()) {
          try {
            const { next, stored } = await readPublication();
            if (!Object.hasOwn(stored, 'revision') && !await archive.hasRecords()) {
              const checkedAt = stored.lastCheckedAt || next.checkedAt || null;
              if (checkedAt != null && !Number.isFinite(Date.parse(checkedAt))) throw new Error('Invalid legacy check time.');
              lastAutomaticAttemptDate = typeof stored.lastAutomaticAttemptDate === 'string' ? stored.lastAutomaticAttemptDate : null;
              await sealAndPublish(next, 'cache', checkedAt);
              initialized = true;
              return;
            }
          } catch { /* Invalid legacy publications require explicit repair. */ }
        }
        try { fresh = error.code === 'ENOENT' && !await archive.hasRecords(); } catch { fresh = false; }
        if (fresh && authority.status().writable) {
          try { await sealAndPublish(baseline, 'bundled', baseline.checkedAt || null); } catch { /* Token queries remain available. */ }
        }
      }
      initialized = true;
    });
    try { await initializePromise; } finally { initializePromise = null; }
  }
  async function verify() {
    await initialize();
    if (authority.check) await authority.check();
    const selected = pricing;
    if (!trusted) { archived = null; return status(); }
    try {
      const revision = pricingRevision(selected);
      const record = await archive.get(revision);
      if (await repairPending(revision)) throw new Error('Repair publication is incomplete.');
      if (JSON.stringify(record.basis) !== JSON.stringify(pricingBasis(selected))) throw new Error('Invalid active basis.');
      if (selected !== pricing) return verify();
      archived = record; archiveError = null;
      // Preserve failed check metadata until a verified publication or explicit repair replaces it.
      metadataError = metadataError || record.metadataError || (!record.lastCheckedAt && trusted.record.lastCheckedAt ? 'metadata' : null);
      lastCheckedAt = metadataError ? null : record.lastCheckedAt;
    } catch {
      if (selected !== pricing) return verify();
      archived = null; archiveError = 'archive'; lastCheckedAt = null;
    }
    return status();
  }
  function status() {
    return { source: sourceUrl, cadence: 'daily', updating: pending > 0, ...authority.status(),
      lastAutomaticAttemptDate, lastCheckedAt, lastSuccessfulAt: archived && !metadataError ? lastSuccessfulAt : null,
      lastError, persistenceError: Boolean(publicationError || metadataError), publicationError, metadataError,
      archive: { available: Boolean(archived), revision: pricingRevision(pricing), firstArchivedAt: archived?.firstArchivedAt || null,
        lastCheckedAt: metadataError ? null : archived?.lastCheckedAt || null, origin: archived?.origin || null, error: archiveError } };
  }
  async function fetchCandidate() {
    await authority.assertWritable();
    const checkedAt = now().toISOString(); const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(documentUrl, { headers: { Accept: 'text/markdown', 'User-Agent': userAgent }, signal: controller.signal });
      if (!response.ok) throw new PricingRefreshError('http', `Pricing source returned HTTP ${response.status}.`);
      if (!/^text\/(?:markdown|plain)\b/i.test(response.headers.get('content-type') || '')) throw new PricingRefreshError('invalid-source', 'The pricing source returned an unexpected content type.');
      if (Number(response.headers.get('content-length') || 0) > MAX_DOCUMENT_BYTES) throw new PricingRefreshError('invalid-source', 'The pricing document is too large.');
      const markdown = await response.text();
      if (Buffer.byteLength(markdown) > MAX_DOCUMENT_BYTES) throw new PricingRefreshError('invalid-source', 'The pricing document is too large.');
      const fetchedRates = parseDocument(markdown);
      const next = refreshedPricing(pricing, fetchedRates, checkedAt, sourceUrl);
      pricingFromBasis(pricingBasis(next));
      return { next, checkedAt, changedModels: Object.keys(fetchedRates).filter((id) => JSON.stringify(pricing.rates[id]) !== JSON.stringify(next.rates[id])).sort() };
    } finally { clearTimeout(timeout); }
  }
  function refresh({ manual = false } = {}) {
    if (refreshPromise) return manual ? refreshPromise.then((result) => result.attempted === false ? refresh({ manual: true }) : result) : refreshPromise;
    refreshPromise = (async () => {
      await initialize();
      return enqueue(async () => {
        if (!authority.status().writable && !manual) return { attempted: false, pricing, status: status() };
        await authority.assertWritable();
        const attemptDate = utcDate(now());
        if (!manual && (lastAutomaticAttemptDate === attemptDate || !archived)) return { attempted: false, pricing, status: status() };
        try {
          if (!manual) {
            await verify();
            if (!archived) return { attempted: false, pricing, status: status() };
            let published;
            try { published = await readPublished(); }
            catch { publicationError = 'publication'; throw new PricingRefreshError('publication', 'Published pricing needs explicit recovery.'); }
            if (published.record.revision !== pricingRevision(pricing)) throw new PricingRefreshError('publication', 'Published pricing changed; load it explicitly.');
            lastAutomaticAttemptDate = attemptDate;
            await publish(pricing, archived, pricingOrigin, false, true);
          }
          // Explicit retry can complete an interrupted first installation without network access.
          if (manual && fresh && !trusted) await sealAndPublish(baseline, 'bundled', baseline.checkedAt || null);
          const { next, checkedAt, changedModels } = await fetchCandidate();
          if (!manual) {
            await verify();
            if (!archived) throw new PricingRefreshError('archive', 'Active pricing needs explicit recovery.');
          }
          await sealAndPublish(next, 'refresh', checkedAt); lastError = null;
          return { attempted: true, changedModels, pricing, status: status() };
        } catch (error) {
          lastError = error.code === 'PRICING_READ_ONLY' ? 'read-only' : errorCode(error);
          if (error.code === 'PRICING_READ_ONLY' || error instanceof PricingRefreshError) throw error;
          throw new PricingRefreshError(lastError, 'Could not reach the pricing source.');
        }
      });
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function load() {
    await initialize();
    return enqueue(async () => {
      try { const { next, record, stored } = await readPublished(); activate(next, record, 'cache'); lastError = null;
        lastAutomaticAttemptDate = typeof stored.lastAutomaticAttemptDate === 'string' ? stored.lastAutomaticAttemptDate : null;
        return { pricing, status: status() };
      } catch { publicationError = 'publication'; await verify(); throw Object.assign(new Error('Published pricing could not be loaded; the previous verified basis was retained.'), { status: 503, code: 'PRICING_LOAD_FAILED' }); }
    });
  }
  async function repair() {
    await initialize();
    return enqueue(async () => {
      await authority.assertWritable();
      try {
        await verify();
        const candidate = trusted ? { next: trusted.pricing, checkedAt: trusted.record.lastCheckedAt, origin: trusted.record.origin }
          : { ...await fetchCandidate(), origin: 'refresh' };
        const guarded = !archived || await repairPending();
        if (guarded) await markRepair(candidate.next);
        let previousPublication;
        try { previousPublication = await readPublication(); }
        catch (error) {
          if (error.code !== 'ENOENT') {
            const quarantine = `${cachePath}.quarantine-${randomUUID()}`;
            await authority.assertWritable(); await rename(cachePath, quarantine);
            let becameValid = false;
            try { await readPublication(quarantine); becameValid = true; } catch { /* Preserve invalid publication bytes. */ }
            if (becameValid) {
              await authority.assertWritable(); await link(quarantine, cachePath).catch((failure) => { if (failure.code !== 'EEXIST') throw failure; });
              throw Object.assign(new Error('Pricing publication changed during repair.'), { status: 409, code: 'PRICING_REPAIR_CONFLICT' });
            }
          }
        }
        if (!trusted && previousPublication) await archive.quarantineInvalid(previousPublication.next);
        const record = await sealAndPublish(candidate.next, candidate.origin, candidate.checkedAt, true, trusted?.record, !guarded);
        if (guarded) {
          await authority.assertWritable(); await rm(repairPath);
          activate(candidate.next, record, candidate.origin);
        }
        lastError = null;
        return { pricing, status: status() };
      } catch (error) { lastError = error.code || 'repair'; throw error; }
    });
  }
  return Object.freeze({ initialize, verify, load, repair, archive, refresh, status,
    close: async () => { closing = true; await tail; },
    current: () => {
      const info = status().archive; const state = JSON.stringify(info);
      if (viewPricing !== pricing || viewArchive !== state) { currentView = { ...pricing, checkedAt: info.lastCheckedAt, revision: pricingRevision(pricing), archive: info }; viewPricing = pricing; viewArchive = state; }
      return currentView;
    },
  });
}
