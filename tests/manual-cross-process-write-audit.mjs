import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readRuntimeConfig } from '../server/config.mjs';
import { readSettings, saveSettings } from '../server/settings.mjs';
import { createAccountUsageService } from '../server/account-usage.mjs';

// Diagnostic report, not a correctness gate. The raw settings writer still permits an uncooperative external edit.
const native = { writeFile: fs.writeFile, rename: fs.rename };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ctd-cross-process-audit-'));
const results = [];

function externalWrite(file, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      "import { readFileSync, writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], readFileSync(0), {mode:0o600});", file],
    { stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Synthetic external writer failed.')));
    child.stdin.on('error', reject);
    child.stdin.end(body);
  });
}

async function interleave(file, body, boundary, operation) {
  let injected = false;
  async function inject() {
    if (injected) return;
    injected = true;
    await externalWrite(file, body);
  }
  fs.writeFile = async (...args) => {
    const result = await native.writeFile(...args);
    if (boundary === 'before-final-check' && path.dirname(String(args[0])) === path.dirname(file)
      && String(args[0]).endsWith('.tmp')) await inject();
    return result;
  };
  fs.rename = async (...args) => {
    if (boundary === 'after-final-check' && String(args[1]) === file) await inject();
    return native.rename(...args);
  };
  syncBuiltinESMExports();
  try {
    const result = await operation();
    assert.equal(injected, true, 'The selected write boundary must be reached.');
    return result;
  } finally {
    fs.writeFile = native.writeFile;
    fs.rename = native.rename;
    syncBuiltinESMExports();
  }
}

async function settingsProbe(boundary) {
  const directory = path.join(root, `settings-${boundary}`);
  await fs.mkdir(directory);
  const file = path.join(directory, '.env');
  await fs.writeFile(file, '# TEST ONLY\nCUSTOM_VALUE=original\nPORT=3333\n');
  const runtime = readRuntimeConfig({ environment: {}, localConfig: {} });
  const initial = await readSettings(file, runtime);
  const values = { ...initial.settings, PORT: '3344', CODEX_SESSIONS_DIR: directory, CLAUDE_SESSIONS_DIR: directory };
  const replacement = '# TEST ONLY external writer\nCUSTOM_VALUE=external\nPORT=3355\n';
  const outcome = await interleave(file, replacement, boundary, async () => {
    try { await saveSettings(file, values, { revision: initial.revision }); return 'saved'; }
    catch (error) { return error.code || 'error'; }
  });
  const preserved = await fs.readFile(file, 'utf8') === replacement;
  assert.equal(outcome, boundary === 'before-final-check' ? 'SETTINGS_CONFLICT' : 'saved');
  assert.equal(preserved, boundary === 'before-final-check');
  assert.deepEqual(await fs.readdir(directory), ['.env']);
  results.push({ surface: 'settings', boundary, outcome, externalFilePreserved: preserved, temporaryFilesRemain: false });
}

async function credentialProbe(scenario) {
  const directory = path.join(root, `credentials-${scenario}`);
  await fs.mkdir(directory);
  const file = path.join(directory, 'TEST_ONLY-credentials.json');
  const now = Date.UTC(2026, 9, 1);
  const initial = JSON.stringify({ claudeAiOauth: {
    accessToken: 'TEST_ONLY-original', refreshToken: 'TEST_ONLY-refresh', expiresAt: now + (scenario === 'expired' ? -1 : 3600000),
  }, unrelated: 'original' });
  await fs.writeFile(file, initial);
  const replacement = JSON.stringify({ claudeAiOauth: {
    accessToken: 'TEST_ONLY-cli-new-login', refreshToken: 'TEST_ONLY-cli-refresh', expiresAt: now + 3600000,
  }, unrelated: 'external' });
  let usageRequests = 0;
  const service = createAccountUsageService({ claudeCredentialsPath: file, now: () => now, fetchImpl: async (url) => {
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    usageRequests++;
    await externalWrite(file, replacement);
    return Response.json({ five_hour: { utilization: 25, resets_at: new Date(now + 18000000).toISOString() } });
  } });
  const response = await service.get('claude');
  const preserved = await fs.readFile(file, 'utf8') === (scenario === 'expired' ? initial : replacement);
  assert.equal(response.status, 'unavailable');
  assert.equal(response.reason, scenario === 'expired' ? 'auth-expired' : 'credentials-changed');
  assert.equal(preserved, true);
  assert.equal(usageRequests, scenario === 'expired' ? 0 : 1);
  assert.deepEqual(await fs.readdir(directory), ['TEST_ONLY-credentials.json']);
  assert.equal(JSON.stringify(response).includes('TEST_ONLY'), false);
  results.push({ surface: 'claude-credentials', scenario, outcome: response.reason,
    credentialFilePreserved: preserved, usageRequests, temporaryFilesRemain: false });
}

try {
  for (const boundary of ['before-final-check', 'after-final-check']) {
    await settingsProbe(boundary);
  }
  await credentialProbe('expired');
  await credentialProbe('cli-change-during-usage');
} finally {
  fs.writeFile = native.writeFile;
  fs.rename = native.rename;
  syncBuiltinESMExports();
  await fs.rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ diagnosticReport: true, externalRequests: 0, cleanedUp: true, results }, null, 2));
