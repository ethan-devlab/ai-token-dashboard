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

export function createPricingArchive({ directory, provider, now = () => new Date(), beforeWrite = async () => {} }) {
  if (!['codex', 'claude'].includes(provider)) throw invalid();
  const file = (revision, suffix = '.json') => { if (!REVISION.test(revision)) throw Object.assign(new Error('Invalid pricing revision.'), { status: 400, code: 'INVALID_QUERY' }); return path.join(directory, revision + suffix); };
  function validRecord(record, revision) {
    const pricing = pricingFromBasis(record.basis);
    return record.version === 1 && record.provider === provider && record.basis.provider === provider && record.revision === revision
      && pricingRevision(pricing) === revision && JSON.stringify(pricingBasis(pricing)) === JSON.stringify(record.basis)
      && validDate(record.firstArchivedAt) && ['bundled', 'cache', 'refresh'].includes(record.origin);
  }
  async function get(revision) {
    let record;
    try {
      record = await readJson(file(revision));
      if (!validRecord(record, revision)) throw invalid();
      let lastCheckedAt = null; let metadataError = null;
      try { const checked = await readJson(file(revision, '.check.json')); if (checked.version !== 1 || checked.revision !== revision || !validDate(checked.lastCheckedAt)) throw invalid(); lastCheckedAt = checked.lastCheckedAt; }
      catch (error) { if (error.code !== 'ENOENT') metadataError = 'metadata'; }
      return { version: 1, provider, revision, basis: record.basis, firstArchivedAt: record.firstArchivedAt, origin: record.origin, lastCheckedAt, metadataError };
    } catch (error) {
      if (error.status === 400) throw error;
      if (error.code === 'ENOENT' && !record) throw Object.assign(new Error('Pricing revision was not found.'), { status: 404, code: 'PRICING_REVISION_NOT_FOUND' });
      throw invalid();
    }
  }
  async function save(pricing, { origin, checkedAt = null, retainedRecord = null }) {
    if ((pricing.provider || 'codex') !== provider || !['bundled', 'cache', 'refresh'].includes(origin)) throw invalid();
    const revision = pricingRevision(pricing); const target = file(revision);
    await beforeWrite(); await mkdir(directory, { recursive: true, mode: 0o700 });
    let record;
    try { record = await get(revision); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!record) {
      const basis = pricingBasis(pricing);
      if (retainedRecord && (retainedRecord.provider !== provider || retainedRecord.revision !== revision
        || JSON.stringify(retainedRecord.basis) !== JSON.stringify(basis) || !validDate(retainedRecord.firstArchivedAt)
        || !['bundled', 'cache', 'refresh'].includes(retainedRecord.origin))) throw invalid();
      record = { version: 1, provider, revision, basis, firstArchivedAt: retainedRecord?.firstArchivedAt || now().toISOString(), origin: retainedRecord?.origin || origin };
      if (Buffer.byteLength(JSON.stringify(record)) + 1 > MAX_BYTES) throw invalid();
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await beforeWrite(); await writeFile(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
        try { await beforeWrite(); await link(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      record = await get(revision);
    }
    if (checkedAt != null) {
      if (!validDate(checkedAt)) throw invalid();
    }
    if (checkedAt != null && (record.lastCheckedAt == null || Date.parse(checkedAt) > Date.parse(record.lastCheckedAt))) {
      const targetCheck = file(revision, '.check.json'); const temporary = `${targetCheck}.${randomUUID()}.tmp`;
      try { await beforeWrite(); await writeFile(temporary, JSON.stringify({ version: 1, revision, lastCheckedAt: checkedAt }) + '\n', { flag: 'wx', mode: 0o600 }); await beforeWrite(); await rename(temporary, targetCheck); }
      catch (error) { if (error.code === 'PRICING_READ_ONLY') throw error; return { ...await get(revision), lastCheckedAt: null, metadataError: 'metadata' }; }
      finally { await rm(temporary, { force: true }).catch(() => undefined); }
    }
    return get(revision);
  }
  async function list({ offset = 0, limit = 100 } = {}) {
    let names;
    try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw invalid(); names = []; }
    const revisions = names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => name.slice(0, -5)).sort();
    const items = await Promise.all(revisions.slice(offset, offset + limit).map(async (revision) => {
      try { const { firstArchivedAt, lastCheckedAt, origin, metadataError } = await get(revision); return { revision, status: 'verified', firstArchivedAt, lastCheckedAt, origin, metadataError }; }
      catch { return { revision, status: 'invalid' }; }
    }));
    return { provider, items, total: revisions.length, offset, limit, hasNext: offset + items.length < revisions.length };
  }
  async function hasRecords() {
    try { return (await readdir(directory)).length > 0; }
    catch (error) { if (error.code === 'ENOENT') return false; throw invalid(); }
  }
  async function quarantine(target, isValid) {
    const retained = `${target}.quarantine-${randomUUID()}`;
    await beforeWrite(); await rename(target, retained);
    let valid = false;
    try { valid = isValid(await readJson(retained)); } catch { /* Invalid bytes remain in quarantine. */ }
    if (valid) {
      await beforeWrite(); await link(retained, target).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      throw Object.assign(new Error('Pricing repair stopped because the record changed.'), { status: 409, code: 'PRICING_REPAIR_CONFLICT' });
    }
  }
  async function repair(pricing, options) {
    const revision = pricingRevision(pricing); let record;
    await beforeWrite();
    try { record = await get(revision); }
    catch (error) {
      if (error.status !== 404) {
        await quarantine(file(revision), (moved) => validRecord(moved, revision));
      }
    }
    if (record?.metadataError) {
      await quarantine(file(revision, '.check.json'), (moved) => moved.version === 1 && moved.revision === revision && validDate(moved.lastCheckedAt));
    }
    return save(pricing, options);
  }
  async function quarantineInvalid(pricing) {
    const revision = pricingRevision(pricing);
    try { await get(revision); }
    catch (error) { if (error.status !== 404) await quarantine(file(revision), (moved) => validRecord(moved, revision)); }
  }
  return { get, save, list, hasRecords, repair, quarantineInvalid };
}
