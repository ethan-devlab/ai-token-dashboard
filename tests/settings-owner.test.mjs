import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { acquireSettingsOwner, unlockSettings } from '../server/settings-owner.mjs';

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ctd-owner-test-'));
  try { await run(root, path.join(root, '.env')); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function absentPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.throws(() => process.kill(child.pid, 0), (error) => error.code === 'ESRCH');
  return child.pid;
}
async function markAbsent(file) {
  const ownerFile = `${file}.settings-lock/owner.json`;
  const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
  owner.pid = await absentPid();
  await fs.writeFile(ownerFile, JSON.stringify(owner));
  return ownerFile;
}

test('one settings writer wins across alias paths; read-only instances require restart', () => fixture(async (root, file) => {
  const actual = path.join(root, 'app'); await fs.mkdir(actual);
  const alias = path.join(root, 'alias'); await fs.symlink(actual, alias);
  const leases = await Promise.all(Array.from({ length: 8 }, (_, i) => acquireSettingsOwner(path.join(i % 2 ? alias : actual, '.env'))));
  const winners = leases.filter((lease) => lease.status().writable); assert.equal(winners.length, 1);
  const loser = leases.find((lease) => !lease.status().writable);
  await winners[0].assertWritable();
  assert.equal((await fs.stat(path.join(actual, '.env.settings-lock/owner.json'))).mode & 0o777, 0o600);
  await winners[0].release();
  assert.equal((await loser.check()).writable, false);
  const replacement = await acquireSettingsOwner(path.join(alias, '.env'));
  assert.equal(replacement.status().writable, true); await replacement.release();
  assert.deepEqual(await fs.readdir(actual), []);
}));

test('explicit unlock refuses an active owner and does not expose or change metadata', () => fixture(async (root, file) => {
  const lease = await acquireSettingsOwner(file);
  const ownerFile = `${file}.settings-lock/owner.json`; const before = await fs.readFile(ownerFile, 'utf8');
  await assert.rejects(unlockSettings(file), (error) => error.reason === 'active-owner');
  assert.equal(await fs.readFile(ownerFile, 'utf8'), before);
  assert.deepEqual(await fs.readdir(`${file}.settings-lock`), ['owner.json']);
  assert.deepEqual(lease.status(), { writable: true, writeReason: null });
  await lease.release();
}));

test('normal release survives a concurrent refused unlock attempt', () => fixture(async (root, file) => {
  const lease = await acquireSettingsOwner(file);
  const [recovery, release] = await Promise.allSettled([unlockSettings(file), lease.release()]);
  assert.equal(recovery.status, 'rejected'); assert.equal(release.status, 'fulfilled');
  assert.deepEqual(await fs.readdir(root), []);
}));

test('startup recovers an absent local owner without promoting a running reader', () => fixture(async (root, file) => {
  await acquireSettingsOwner(file);
  const reader = await acquireSettingsOwner(file); assert.equal(reader.status().writable, false);
  const ownerFile = await markAbsent(file); const before = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
  const next = await acquireSettingsOwner(file); assert.equal(next.status().writable, true); await next.assertWritable();
  const current = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
  assert.equal(current.pid, process.pid); assert.notEqual(current.generation, before.generation);
  assert.equal((await reader.check()).writable, false); await next.release();
  assert.deepEqual(await fs.readdir(root), []);
}));

test('simultaneous startup recovery elects one writer and preserves its generation', () => fixture(async (root, file) => {
  await acquireSettingsOwner(file); await markAbsent(file);
  const leases = await Promise.all(Array.from({ length: 8 }, () => acquireSettingsOwner(file)));
  const winners = leases.filter(lease => lease.status().writable); assert.equal(winners.length, 1);
  await winners[0].assertWritable();
  assert.deepEqual(await fs.readdir(`${file}.settings-lock`), ['owner.json']);
  await winners[0].release();
  for (const reader of leases.filter(lease => !lease.status().writable)) assert.equal((await reader.check()).writable, false);
}));

test('startup rechecks owner absence inside the retirement guard', () => fixture(async (root, file) => {
  await acquireSettingsOwner(file); const ownerFile = await markAbsent(file); const before = await fs.readFile(ownerFile, 'utf8');
  const originalKill = process.kill; let probes = 0;
  process.kill = () => { if (++probes === 1) throw Object.assign(new Error('TEST ONLY absent'), { code: 'ESRCH' }); return true; };
  try { assert.equal((await acquireSettingsOwner(file)).status().writable, false); assert.equal(probes, 2); }
  finally { process.kill = originalKill; }
  assert.equal(await fs.readFile(ownerFile, 'utf8'), before);
  assert.deepEqual(await fs.readdir(`${file}.settings-lock`), ['owner.json']);
}));

test('foreign, malformed, oversized, busy and unexpected owner state is never recovered', () => fixture(async (root, file) => {
  const ownerFile = `${file}.settings-lock/owner.json`;
  await acquireSettingsOwner(file);
  const initial = await fs.readFile(ownerFile, 'utf8');
  for (const body of ['{', ' '.repeat(4097), JSON.stringify({ ...JSON.parse(initial), host: 'TEST_ONLY-other-host' })]) {
    await fs.writeFile(ownerFile, body);
    await assert.rejects(unlockSettings(file));
    assert.equal((await acquireSettingsOwner(file)).status().writable, false);
    assert.equal(await fs.readFile(ownerFile, 'utf8'), body);
    assert.deepEqual(await fs.readdir(`${file}.settings-lock`), ['owner.json']);
  }
  await fs.writeFile(ownerFile, initial); await markAbsent(file);
  const originalKill = process.kill;
  process.kill = () => { throw Object.assign(new Error('TEST ONLY permission denied'), { code: 'EPERM' }); };
  try { await assert.rejects(unlockSettings(file), (error) => error.reason === 'unknown-owner'); assert.equal((await acquireSettingsOwner(file)).status().writeReason, 'unknown-owner'); }
  finally { process.kill = originalKill; }
  await fs.mkdir(`${file}.settings-lock/.operation`);
  await assert.rejects(unlockSettings(file), (error) => error.reason === 'ownership-busy');
  assert.equal((await acquireSettingsOwner(file)).status().writeReason, 'ownership-busy');
  await fs.rmdir(`${file}.settings-lock/.operation`);
  await fs.writeFile(`${file}.settings-lock/unexpected`, 'TEST ONLY');
  await assert.rejects(unlockSettings(file), (error) => error.reason === 'invalid-owner');
  assert.equal((await acquireSettingsOwner(file)).status().writeReason, 'invalid-owner');
  assert.equal(await fs.readFile(`${file}.settings-lock/unexpected`, 'utf8'), 'TEST ONLY');
}));

test('a lost generation disables saving and cannot release its replacement', () => fixture(async (root, file) => {
  const lease = await acquireSettingsOwner(file); const ownerFile = `${file}.settings-lock/owner.json`;
  const replacement = { ...JSON.parse(await fs.readFile(ownerFile, 'utf8')), generation: randomUUID() };
  await fs.writeFile(ownerFile, JSON.stringify(replacement));
  assert.equal((await lease.check()).writable, false);
  await assert.rejects(lease.assertWritable(), (error) => error.code === 'SETTINGS_READ_ONLY');
  await lease.release(); assert.deepEqual(JSON.parse(await fs.readFile(ownerFile, 'utf8')), replacement);
}));

test('competing recovery and new acquisition cannot delete a new owner generation', () => fixture(async (root, file) => {
  await acquireSettingsOwner(file); await markAbsent(file);
  const canonicalLock = path.join(await fs.realpath(root), '.env.settings-lock');
  const originalRename = fs.rename; let next; let injected = false;
  fs.rename = async (...args) => {
    const result = await originalRename(...args);
    if (!injected && args[0] === canonicalLock) {
      injected = true; next = await acquireSettingsOwner(file); assert.equal(next.status().writable, true);
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    const outcomes = await Promise.allSettled([unlockSettings(file), unlockSettings(file)]);
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(injected, true); await next.assertWritable();
    assert.deepEqual(await fs.readdir(`${file}.settings-lock`), ['owner.json']);
  } finally { fs.rename = originalRename; syncBuiltinESMExports(); }
  await next.release(); assert.deepEqual(await fs.readdir(root), []);
}));

test('unsafe settings symlinks and hard links cannot acquire a writer', () => fixture(async (root, file) => {
  const target = path.join(root, 'target'); await fs.writeFile(target, 'TEST ONLY');
  await fs.symlink(target, file);
  assert.equal((await acquireSettingsOwner(file)).status().writable, false);
  await fs.unlink(file); await fs.link(target, file);
  assert.equal((await acquireSettingsOwner(file)).status().writable, false);
  assert.equal(await fs.readFile(target, 'utf8'), 'TEST ONLY');
}));

test('invalid explicit recovery arguments cannot start a server or fetch prices', () => fixture(async (root) => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  await fs.cp(path.join(source, 'server'), path.join(root, 'server'), { recursive: true });
  for (const name of ['server.mjs', 'package.json']) await fs.cp(path.join(source, name), path.join(root, name));
  await fs.writeFile(path.join(root, 'offline.mjs'), "import {writeFileSync} from 'node:fs'; globalThis.fetch=async()=>{writeFileSync(new URL('./unexpected-fetch',import.meta.url),'TEST ONLY');throw new Error('No fetch allowed.');};");
  for (const args of [['--unlock-settings', '--force'], ['--unlock-settings=force']]) {
    const child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs'), ...args], { cwd: root, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 1);
    assert.deepEqual((await fs.readdir(root)).sort(), ['offline.mjs', 'package.json', 'server', 'server.mjs']);
  }
}));
