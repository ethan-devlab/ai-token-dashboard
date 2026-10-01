import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pricingBasis, pricingFromBasis, pricingRevision } from './pricing-basis.mjs';

const REVISION = /^[a-f0-9]{64}$/;
const MAX_BYTES = 1_048_576;
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function invalid() { return Object.assign(new Error('Pricing archive is invalid or unavailable.'), { code: 'ARCHIVE_INVALID', status: 503 }); }

async function readJson(file) {
  const handle = await open(file, 'r');
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_BYTES) throw invalid(); const data = await handle.readFile(); if (data.length > MAX_BYTES) throw invalid(); return JSON.parse(data); }
  finally { await handle.close(); }
}

export function createPricingArchive({ directory, provider, now = () => new Date() }) {
  if (!['codex', 'claude'].includes(provider)) throw invalid();
  const file = (revision, suffix = '.json') => { if (!REVISION.test(revision)) throw Object.assign(new Error('Invalid pricing revision.'), { status: 400, code: 'INVALID_QUERY' }); return path.join(directory, revision + suffix); };
  async function get(revision) {
    let record;
    try {
      record = await readJson(file(revision));
      const pricing = pricingFromBasis(record.basis);
      if (record.version !== 1 || record.provider !== provider || record.basis.provider !== provider || record.revision !== revision || pricingRevision(pricing) !== revision || JSON.stringify(pricingBasis(pricing)) !== JSON.stringify(record.basis) || !validDate(record.firstArchivedAt) || !['bundled', 'cache', 'refresh'].includes(record.origin)) throw invalid();
      let lastCheckedAt = null;
      try { const checked = await readJson(file(revision, '.check.json')); if (checked.version !== 1 || checked.revision !== revision || !validDate(checked.lastCheckedAt)) throw invalid(); lastCheckedAt = checked.lastCheckedAt; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { version: 1, provider, revision, basis: record.basis, firstArchivedAt: record.firstArchivedAt, origin: record.origin, lastCheckedAt };
    } catch (error) {
      if (error.status === 400) throw error;
      if (error.code === 'ENOENT' && !record) throw Object.assign(new Error('Pricing revision was not found.'), { status: 404, code: 'PRICING_REVISION_NOT_FOUND' });
      throw invalid();
    }
  }
  async function save(pricing, { origin, checkedAt = null }) {
    if ((pricing.provider || 'codex') !== provider || !['bundled', 'cache', 'refresh'].includes(origin)) throw invalid();
    const revision = pricingRevision(pricing); const target = file(revision);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let record;
    try { record = await get(revision); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!record) {
      record = { version: 1, provider, revision, basis: pricingBasis(pricing), firstArchivedAt: now().toISOString(), origin };
      if (Buffer.byteLength(JSON.stringify(record)) + 1 > MAX_BYTES) throw invalid();
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
        try { await link(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      record = await get(revision);
    }
    if (checkedAt != null) {
      if (!validDate(checkedAt)) throw invalid();
    }
    if (checkedAt != null && (record.lastCheckedAt == null || Date.parse(checkedAt) > Date.parse(record.lastCheckedAt))) {
      const targetCheck = file(revision, '.check.json'); const temporary = `${targetCheck}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify({ version: 1, revision, lastCheckedAt: checkedAt }) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, targetCheck); }
      finally { await rm(temporary, { force: true }).catch(() => undefined); }
    }
    return get(revision);
  }
  async function list({ offset = 0, limit = 100 } = {}) {
    let names;
    try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw invalid(); names = []; }
    const revisions = names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => name.slice(0, -5)).sort();
    const items = await Promise.all(revisions.slice(offset, offset + limit).map(async (revision) => {
      try { const { firstArchivedAt, lastCheckedAt, origin } = await get(revision); return { revision, status: 'verified', firstArchivedAt, lastCheckedAt, origin }; }
      catch { return { revision, status: 'invalid' }; }
    }));
    return { provider, items, total: revisions.length, offset, limit, hasNext: offset + items.length < revisions.length };
  }
  return { get, save, list };
}
