import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAccountUsageService, normalizeCodexUsage, normalizeClaudeUsage } from '../server/account-usage.mjs';
import { readSettings, saveSettings } from '../server/settings.mjs';
import { readRuntimeConfig } from '../server/config.mjs';
import { quotaWindowForDisplay, remainingPercent } from '../public/scripts/account-usage.mjs';

const time = Date.parse('2026-10-01T00:00:00Z');
const codexPayload = { rate_limit: { primary_window: { used_percent: 25, reset_at: time / 1000 + 10, limit_window_seconds: 18000 }, secondary_window: { used_percent: 50, reset_at: time / 1000 + 604800, limit_window_seconds: 604800 } } };
const credentials = { tokens: { access_token: 'fixture-only-token', account_id: 'fixture-only-account' } };
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase5-unit-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('quota accepts measured zero and preserves unsupported percentages and reset times as unknown', () => {
  for (const value of [null, '', '0', false, true, -1, 101, NaN, Infinity]) {
    const codex = normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: value, reset_at: value } } }, new Date(time).toISOString());
    assert.equal(codex.windows[0].remainingPercent, null);
    if (typeof value !== 'number' || !Number.isFinite(value)) assert.equal(codex.windows[0].resetsAt, null);
    assert.equal(normalizeClaudeUsage({ five_hour: { utilization: value, resets_at: null } }, '').windows[0].remainingPercent, null);
    assert.equal(remainingPercent({ remainingPercent: value }), null);
  }
  const zero = normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 0, reset_at: 0 } } }, '');
  assert.equal(zero.windows[0].remainingPercent, 100);
  assert.equal(zero.windows[0].resetsAt, '1970-01-01T00:00:00.000Z');
  assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 10, reset_at: 1e100 } } }, '').windows[0].resetsAt, null);
  assert.throws(() => normalizeCodexUsage({ rate_limit: { primary_window: [] } }, ''), /unsupported-response/);
});

test('transient quota failures retain explicit stale success and mask each reset window without changing source data', async () => fixture(async (root) => {
  const file = path.join(root, 'auth.json'); await writeFile(file, JSON.stringify(credentials));
  let now = time; let mode = 'ok'; let calls = 0;
  const service = createAccountUsageService({ codexAuthPath: file, now: () => now, fetchImpl: async () => { calls++; if (mode === 'network') throw new Error('fixture-only'); return mode === 'ok' ? Response.json(codexPayload) : Response.json({}, { status: Number(mode) }); } });
  const [first, coalesced] = await Promise.all([service.get('codex'), service.get('codex')]); assert.equal(calls, 1); assert.deepEqual(first, coalesced);
  for (const [modeValue, reason] of [['network', 'network'], ['429', 'rate-limit'], ['503', 'service-unavailable']]) {
    mode = modeValue; now += 1000;
    const stale = await service.get('codex', { refresh: true });
    assert.equal(stale.status, 'stale'); assert.equal(stale.reason, reason); assert.equal(stale.fetchedAt, first.fetchedAt); assert.equal(stale.checkedAt, new Date(now).toISOString()); assert.equal(stale.windows[0].remainingPercent, 75);
  }
  now = time + 10000;
  const expired = await service.get('codex'); assert.equal(expired.windows[0].remainingPercent, null); assert.equal(expired.windows[0].resetExpired, true); assert.equal(expired.windows[1].remainingPercent, 50);
  assert.equal(first.windows[0].remainingPercent, 75);
  assert.equal(quotaWindowForDisplay(first.windows[0], { stale: true, now }).remainingPercent, null);
  mode = 'ok'; const recovered = await service.get('codex', { refresh: true }); assert.equal(recovered.status, 'available'); assert.equal(recovered.reason, undefined);
}));

test('login changes, invalid credentials, and authentication errors never expose a former login cache', async () => fixture(async (root) => {
  const file = path.join(root, 'auth.json'); await writeFile(file, JSON.stringify(credentials));
  let status = 200;
  const service = createAccountUsageService({ codexAuthPath: file, now: () => time, fetchImpl: async () => Response.json(status === 200 ? codexPayload : {}, { status }) });
  await service.get('codex'); status = 503;
  await writeFile(file, JSON.stringify({ tokens: { access_token: 'fixture-new-account' } }));
  let value = await service.get('codex'); assert.equal(value.status, 'unavailable'); assert.deepEqual(value.windows, []);
  status = 200; await service.get('codex', { refresh: true }); status = 401;
  value = await service.get('codex', { refresh: true }); assert.equal(value.reason, 'auth-expired'); assert.deepEqual(value.windows, []);
  await writeFile(file, '{'); value = await service.get('codex'); assert.equal(value.reason, 'invalid-credentials');
  await unlink(file); value = await service.get('codex'); assert.equal(value.reason, 'not-signed-in'); assert.equal(value.fetchedAt, null); assert.equal(value.checkedAt, new Date(time).toISOString());
}));

test('quota ignores a successful response for credentials replaced during the request', async () => fixture(async (root) => {
  const file = path.join(root, 'auth.json'); await writeFile(file, JSON.stringify(credentials));
  const service = createAccountUsageService({ codexAuthPath: file, now: () => time, fetchImpl: async () => { await writeFile(file, JSON.stringify({ tokens: { access_token: 'fixture-concurrent' } })); return Response.json(codexPayload); } });
  const value = await service.get('codex'); assert.equal(value.reason, 'credentials-changed'); assert.deepEqual(value.windows, []); assert.ok(!JSON.stringify(value).includes('fixture-'));
}));

test('Claude refresh preserves a concurrent CLI login and reports a safe conflict', async () => fixture(async (root) => {
  const file = path.join(root, 'credentials.json');
  await writeFile(file, JSON.stringify({ cliNote: 'old', claudeAiOauth: { accessToken: 'fixture-old', refreshToken: 'fixture-refresh', expiresAt: 0 } }));
  const next = { cliNote: 'new', claudeAiOauth: { accessToken: 'fixture-cli-new', refreshToken: 'fixture-cli-refresh', expiresAt: time + 3600000 } };
  let calls = 0;
  const service = createAccountUsageService({ claudeCredentialsPath: file, now: () => time, fetchImpl: async (url) => { calls++; assert.ok(url.endsWith('/v1/oauth/token')); await writeFile(file, JSON.stringify(next)); return Response.json({ access_token: 'fixture-rotation', expires_in: 3600 }); } });
  const value = await service.get('claude'); assert.equal(value.reason, 'credentials-changed'); assert.deepEqual(value.windows, []); assert.equal(calls, 1); assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), next); assert.deepEqual(await readdir(root), ['credentials.json']);
}));

test('owned Claude token rotation preserves same-login stale quota after a transient usage failure', async () => fixture(async (root) => {
  const file = path.join(root, 'credentials.json');
  await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-old', refreshToken: 'fixture-refresh', expiresAt: time + 60000 } }));
  let now = time; let fail = false; let rotations = 0;
  const service = createAccountUsageService({ claudeCredentialsPath: file, now: () => now, fetchImpl: async (url) => {
    if (url.endsWith('/v1/oauth/token')) { rotations++; return Response.json({ access_token: 'fixture-rotated', expires_in: 3600 }); }
    if (fail) throw new Error('fixture-only');
    return Response.json({ five_hour: { utilization: 40, resets_at: new Date(time + 18000000).toISOString() } });
  }});
  const first = await service.get('claude'); now += 40000; fail = true;
  for (let check = 0; check < 2; check++) {
    const stale = await service.get('claude', { refresh: true }); assert.equal(stale.status, 'stale'); assert.equal(stale.windows[0].remainingPercent, 60); assert.equal(stale.fetchedAt, first.fetchedAt);
  }
  assert.equal(rotations, 1);
}));

test('settings serializes conflicting full-form saves and preserves unrelated file content', async () => fixture(async (root) => {
  const file = path.join(root, '.env'); await writeFile(file, '# preserved\nCUSTOM_VALUE=keep\nPORT=3333\n');
  const runtime = readRuntimeConfig({ environment: {}, localConfig: {} });
  const initial = await readSettings(file, runtime);
  const values = { ...initial.settings, CODEX_SESSIONS_DIR: root, CLAUDE_SESSIONS_DIR: root, PORT: '3344' };
  const results = await Promise.allSettled([saveSettings(file, values, { revision: initial.revision }), saveSettings(file, { ...values, PORT: '3355' }, { revision: initial.revision })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'SETTINGS_CONFLICT');
  const current = await readSettings(file, runtime); assert.equal(current.settings.PORT, '3344'); assert.equal(current.revision, results[0].value.revision);
  assert.match(await readFile(file, 'utf8'), /^# preserved\nCUSTOM_VALUE=keep\nPORT=3344/);
  assert.equal((await stat(file)).mode & 0o777, 0o600); assert.deepEqual(await readdir(root), ['.env']);
  const before = await readFile(file, 'utf8');
  await assert.rejects(saveSettings(file, values), (error) => error.code === 'SETTINGS_REVISION_REQUIRED');
  assert.throws(() => saveSettings(file, { ...values, HOST: '0.0.0.0' }, { revision: current.revision }), (error) => error.code === 'INVALID_SETTINGS');
  assert.equal(await readFile(file, 'utf8'), before);
  await writeFile(file, before + 'CUSTOM_SECOND=external\n');
  await assert.rejects(saveSettings(file, values, { revision: current.revision }), (error) => error.code === 'SETTINGS_CONFLICT');
  const external = await readSettings(file, runtime);
  await saveSettings(file, { ...values, PORT: '3355' }, { revision: external.revision });
  assert.match(await readFile(file, 'utf8'), /CUSTOM_SECOND=external/);
}));
