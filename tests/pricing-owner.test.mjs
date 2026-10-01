import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { acquirePricingOwner, unlockPricing } from '../server/pricing-owner.mjs';
import { acquireSettingsOwner as settingsOwner } from '../server/settings-owner.mjs';
const acquire = (file) => acquirePricingOwner(path.dirname(file));
const unlock = (file) => unlockPricing(path.dirname(file));

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ctd-owner-test-'));
  try { await run(root, path.join(root, '.pricing')); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function absentPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.throws(() => process.kill(child.pid, 0), (error) => error.code === 'ESRCH');
  return child.pid;
}
async function markAbsent(file) {
  const ownerFile = `${file}.writer-lock/owner.json`;
  const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
  owner.pid = await absentPid();
  await fs.writeFile(ownerFile, JSON.stringify(owner));
  return ownerFile;
}

test('one pricing writer wins across alias paths; read-only instances require restart', () => fixture(async (root, file) => {
  const actual = path.join(root, 'app'); await fs.mkdir(actual);
  const alias = path.join(root, 'alias'); await fs.symlink(actual, alias);
  const leases = await Promise.all(Array.from({ length: 8 }, (_, i) => acquire(path.join(i % 2 ? alias : actual, '.pricing'))));
  const winners = leases.filter((lease) => lease.status().writable); assert.equal(winners.length, 1);
  const loser = leases.find((lease) => !lease.status().writable);
  await winners[0].assertWritable();
  assert.equal((await fs.stat(path.join(actual, '.pricing.writer-lock/owner.json'))).mode & 0o777, 0o600);
  await winners[0].release();
  assert.equal((await loser.check()).writable, false);
  const replacement = await acquire(path.join(alias, '.pricing'));
  assert.equal(replacement.status().writable, true); await replacement.release();
  assert.deepEqual(await fs.readdir(actual), []);
}));

test('explicit unlock refuses an active owner and does not expose or change metadata', () => fixture(async (root, file) => {
  const lease = await acquire(file);
  const ownerFile = `${file}.writer-lock/owner.json`; const before = await fs.readFile(ownerFile, 'utf8');
  await assert.rejects(unlock(file), (error) => error.reason === 'active-owner');
  assert.equal(await fs.readFile(ownerFile, 'utf8'), before);
  assert.deepEqual(await fs.readdir(`${file}.writer-lock`), ['owner.json']);
  assert.deepEqual(lease.status(), { writable: true, writeReason: null });
  await lease.release();
}));

test('normal release survives a concurrent refused unlock attempt', () => fixture(async (root, file) => {
  const lease = await acquire(file);
  const [recovery, release] = await Promise.allSettled([unlock(file), lease.release()]);
  assert.equal(recovery.status, 'rejected'); assert.equal(release.status, 'fulfilled');
  assert.deepEqual(await fs.readdir(root), []);
}));

test('startup never steals an absent owner; only explicit recovery restores access', () => fixture(async (root, file) => {
  await acquire(file); await markAbsent(file);
  const blocked = await acquire(file); assert.equal(blocked.status().writable, false);
  await unlock(file);
  assert.equal((await blocked.check()).writable, false);
  const next = await acquire(file); assert.equal(next.status().writable, true); await next.release();
}));

test('foreign, malformed, oversized, busy and unexpected owner state is never recovered', () => fixture(async (root, file) => {
  const ownerFile = `${file}.writer-lock/owner.json`;
  await acquire(file);
  const initial = await fs.readFile(ownerFile, 'utf8');
  for (const body of ['{', ' '.repeat(4097), JSON.stringify({ ...JSON.parse(initial), host: 'TEST_ONLY-other-host' })]) {
    await fs.writeFile(ownerFile, body);
    await assert.rejects(unlock(file));
    assert.equal(await fs.readFile(ownerFile, 'utf8'), body);
    assert.deepEqual(await fs.readdir(`${file}.writer-lock`), ['owner.json']);
  }
  await fs.writeFile(ownerFile, initial); await markAbsent(file);
  const originalKill = process.kill;
  process.kill = () => { throw Object.assign(new Error('TEST ONLY permission denied'), { code: 'EPERM' }); };
  try { await assert.rejects(unlock(file), (error) => error.reason === 'unknown-owner'); }
  finally { process.kill = originalKill; }
  await fs.mkdir(`${file}.writer-lock/.operation`);
  await assert.rejects(unlock(file), (error) => error.reason === 'ownership-busy');
  await fs.rmdir(`${file}.writer-lock/.operation`);
  await fs.writeFile(`${file}.writer-lock/unexpected`, 'TEST ONLY');
  await assert.rejects(unlock(file), (error) => error.reason === 'invalid-owner');
  assert.equal(await fs.readFile(`${file}.writer-lock/unexpected`, 'utf8'), 'TEST ONLY');
}));

test('a lost generation disables saving and cannot release its replacement', () => fixture(async (root, file) => {
  const lease = await acquire(file); const ownerFile = `${file}.writer-lock/owner.json`;
  const replacement = { ...JSON.parse(await fs.readFile(ownerFile, 'utf8')), generation: randomUUID() };
  await fs.writeFile(ownerFile, JSON.stringify(replacement));
  assert.equal((await lease.check()).writable, false);
  await assert.rejects(lease.assertWritable(), (error) => error.code === 'PRICING_READ_ONLY');
  await lease.release(); assert.deepEqual(JSON.parse(await fs.readFile(ownerFile, 'utf8')), replacement);
}));

test('competing recovery and new acquisition cannot delete a new owner generation', () => fixture(async (root, file) => {
  await acquire(file); await markAbsent(file);
  const canonicalLock = path.join(await fs.realpath(root), '.pricing.writer-lock');
  const originalRename = fs.rename; let next; let injected = false;
  fs.rename = async (...args) => {
    const result = await originalRename(...args);
    if (!injected && args[0] === canonicalLock) {
      injected = true; next = await acquire(file); assert.equal(next.status().writable, true);
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    const outcomes = await Promise.allSettled([unlock(file), unlock(file)]);
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(injected, true); await next.assertWritable();
    assert.deepEqual(await fs.readdir(`${file}.writer-lock`), ['owner.json']);
  } finally { fs.rename = originalRename; syncBuiltinESMExports(); }
  await next.release(); assert.deepEqual(await fs.readdir(root), []);
}));

test('unsafe pricing symlinks and hard links cannot acquire a writer', () => fixture(async (root, file) => {
  const target = path.join(root, 'target'); await fs.writeFile(target, 'TEST ONLY');
  await fs.symlink(target, file);
  assert.equal((await acquire(file)).status().writable, false);
  await fs.unlink(file); await fs.link(target, file);
  assert.equal((await acquire(file)).status().writable, false);
  assert.equal(await fs.readFile(target, 'utf8'), 'TEST ONLY');
}));

test('invalid explicit recovery arguments cannot start a server or fetch prices', () => fixture(async (root) => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  await fs.cp(path.join(source, 'server'), path.join(root, 'server'), { recursive: true });
  for (const name of ['server.mjs', 'package.json']) await fs.cp(path.join(source, name), path.join(root, name));
  await fs.writeFile(path.join(root, 'offline.mjs'), "import {writeFileSync} from 'node:fs'; globalThis.fetch=async()=>{writeFileSync(new URL('./unexpected-fetch',import.meta.url),'TEST ONLY');throw new Error('No fetch allowed.');};");
  for (const args of [['--unlock-pricing', '--force'], ['--unlock-pricing=force']]) {
    const child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs'), ...args], { cwd: root, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 1);
    assert.deepEqual((await fs.readdir(root)).sort(), ['offline.mjs', 'package.json', 'server', 'server.mjs']);
  }
}));

test('settings ownership does not control pricing ownership', () => fixture(async (root, file) => {
  const settings = await settingsOwner(path.join(root, '.env'));
  const pricing = await acquire(file);
  assert.equal(settings.status().writable, true); assert.equal(pricing.status().writable, true);
  await settings.release(); await pricing.assertWritable(); await pricing.release();
}));
