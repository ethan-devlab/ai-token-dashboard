import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HOST = os.hostname();

function failure(reason) {
  return Object.assign(new Error('Pricing ownership is unavailable. Stop the former writer and restart, or use the explicit recovery command.'),
    { status: 409, code: 'PRICING_READ_ONLY', reason });
}

async function location(envPath) {
  const resolved = path.resolve(envPath);
  const parent = await realpath(path.dirname(resolved));
  const file = path.join(parent, path.basename(resolved));
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw failure('unsafe-path');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { file, lock: `${file}.writer-lock` };
}

async function directoryIdentity(lock) {
  const info = await lstat(lock);
  if (!info.isDirectory() || info.isSymbolicLink()) throw failure('invalid-owner');
  return `${info.dev}:${info.ino}`;
}

async function readOwner(lock) {
  await directoryIdentity(lock);
  const file = path.join(lock, 'owner.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw failure('invalid-owner');
  const handle = await open(file, 'r');
  let owner;
  try {
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw failure('invalid-owner');
    owner = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } catch { throw failure('invalid-owner'); }
  finally { await handle.close(); }
  if (owner?.version !== 1 || !UUID.test(owner.generation || '') || !Number.isSafeInteger(owner.pid)
    || owner.pid <= 0 || typeof owner.host !== 'string' || !owner.host || owner.host.length > 255
    || typeof owner.createdAt !== 'string' || !Number.isFinite(Date.parse(owner.createdAt))) throw failure('invalid-owner');
  return owner;
}

function ownerAbsent(owner) {
  if (owner.host !== HOST) throw failure('foreign-owner');
  try { process.kill(owner.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; throw failure('unknown-owner'); }
  throw failure('active-owner');
}

async function retire(lock, verify) {
  const identity = await directoryIdentity(lock);
  const operation = path.join(lock, '.operation');
  try { await mkdir(operation, { mode: 0o700 }); }
  catch { throw failure('ownership-busy'); }
  const operationIdentity = await directoryIdentity(operation);
  let retired = null;
  try {
    if (await directoryIdentity(lock) !== identity) throw failure('owner-changed');
    const owner = await readOwner(lock);
    await verify(owner);
    const entries = await readdir(lock);
    if (entries.length !== 2 || !entries.includes('owner.json') || !entries.includes('.operation')) throw failure('invalid-owner');
    // Move the guarded generation first. Cleanup never uses a path a new owner can acquire.
    const target = `${lock}.retired-${randomUUID()}`;
    await rename(lock, target);
    retired = target;
    await unlink(path.join(target, 'owner.json'));
    await rmdir(path.join(target, '.operation'));
    await rmdir(target);
  } finally {
    if (!retired) {
      try { if (await directoryIdentity(operation) === operationIdentity) await rmdir(operation); } catch { /* Keep uncertain ownership blocked. */ }
    }
  }
}

export async function acquirePricingOwner(appDirectory) {
  const envPath = path.join(appDirectory, '.pricing');
  let place;
  let generation = null;
  let reason = 'unavailable';
  try {
    place = await location(envPath);
    await mkdir(place.lock, { mode: 0o700 });
    const candidate = randomUUID();
    try {
      await writeFile(path.join(place.lock, 'owner.json'), JSON.stringify({ version: 1, generation: candidate,
        pid: process.pid, host: HOST, createdAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
      generation = candidate;
    } catch { reason = 'unavailable'; } // A failed/incomplete acquisition stays blocked for explicit inspection.
  } catch (error) { reason = error.code === 'EEXIST' ? 'occupied' : error.reason || 'unavailable'; }
  let released = false;
  const status = () => ({ writable: Boolean(generation && !released), writeReason: generation && !released ? null : reason });
  async function assertWritable() {
    if (!generation || released) throw failure(reason);
    try {
      const owner = await readOwner(place.lock);
      if (owner.generation !== generation || owner.pid !== process.pid || owner.host !== HOST) throw failure('owner-changed');
      if ((await location(envPath)).file !== place.file) throw failure('unsafe-path');
    } catch (error) { reason = error.reason || 'owner-changed'; generation = null; throw failure(reason); }
  }
  return {
    status,
    async check() { try { await assertWritable(); } catch { /* Read-only state is public; owner metadata is private. */ } return status(); },
    assertWritable,
    async release() {
      if (!generation || released) return;
      const expected = generation;
      released = true; reason = 'restart-required';
      for (let attempt = 0; ; attempt++) {
        try {
          await retire(place.lock, (owner) => {
            if (owner.generation !== expected || owner.pid !== process.pid || owner.host !== HOST) throw failure('owner-changed');
          });
          return;
        } catch (error) {
          if (error.reason !== 'ownership-busy' || attempt >= 19) throw error;
          await delay(25);
        }
      }
    },
  };
}

export async function unlockPricing(appDirectory) {
  const envPath = path.join(appDirectory, '.pricing');
  const place = await location(envPath);
  await retire(place.lock, ownerAbsent);
}
