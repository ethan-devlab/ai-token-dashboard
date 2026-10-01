import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

class AccountUsageFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function finitePercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function resetTime(value, seconds = false) {
  const timestamp = seconds
    ? typeof value === 'number' && Number.isFinite(value) ? value * 1_000 : NaN
    : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null;
  return new Date(timestamp).toISOString();
}

function normalizedWindow(id, source, { usedKey, durationKey, resetKey, resetSeconds = false }) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || !Object.hasOwn(source, usedKey)) return null;
  const usedPercent = finitePercent(source[usedKey]);
  const windowSeconds = source[durationKey];
  const duration = typeof windowSeconds === 'number' && Number.isSafeInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds : null;
  return {
    id,
    kind: duration === 18_000 || id === 'five-hour' ? 'five-hour' : id,
    usedPercent,
    remainingPercent: usedPercent == null ? null : 100 - usedPercent,
    windowSeconds: duration,
    resetsAt: resetTime(source[resetKey], resetSeconds),
  };
}

export function normalizeCodexUsage(payload, fetchedAt) {
  const limit = payload?.rate_limit;
  const windows = [
    normalizedWindow('primary', limit?.primary_window, { usedKey: 'used_percent', durationKey: 'limit_window_seconds', resetKey: 'reset_at', resetSeconds: true }),
    normalizedWindow('secondary', limit?.secondary_window, { usedKey: 'used_percent', durationKey: 'limit_window_seconds', resetKey: 'reset_at', resetSeconds: true }),
  ].filter(Boolean);
  if (!windows.length) throw new AccountUsageFailure('unsupported-response');
  return { provider: 'codex', status: 'available', planType: typeof payload?.plan_type === 'string' ? payload.plan_type : null, fetchedAt, windows };
}

export function normalizeClaudeUsage(payload, fetchedAt, planType = null) {
  const definitions = [
    ['five-hour', 'five_hour', 18_000],
    ['seven-day', 'seven_day', 604_800],
    ['seven-day-sonnet', 'seven_day_sonnet', 604_800],
    ['seven-day-opus', 'seven_day_opus', 604_800],
  ];
  const windows = definitions.map(([id, key, duration]) => {
    const item = normalizedWindow(id, payload?.[key], { usedKey: 'utilization', durationKey: '_window_seconds', resetKey: 'resets_at' });
    return item ? { ...item, windowSeconds: duration } : null;
  }).filter(Boolean);
  if (!windows.length) throw new AccountUsageFailure('unsupported-response');
  return { provider: 'claude', status: 'available', planType, fetchedAt, windows };
}

async function jsonFile(filePath, missingReason) {
  let body;
  try { body = await readFile(filePath, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new AccountUsageFailure(missingReason);
    throw error;
  }
  try { return { credentials: JSON.parse(body), revision: createHash('sha256').update(body).digest('hex') }; }
  catch { throw new AccountUsageFailure('invalid-credentials'); }
}

async function requestJson(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new AccountUsageFailure('network');
  }
  if (response.status === 401 || response.status === 403) throw new AccountUsageFailure('auth-expired');
  if (!response.ok) throw new AccountUsageFailure(response.status === 429 ? 'rate-limit' : 'service-unavailable');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new AccountUsageFailure('unsupported-response');
  try { return await response.json(); }
  catch { throw new AccountUsageFailure('unsupported-response'); }
}

async function persistClaudeCredentials(filePath, snapshot, oauth) {
  const original = snapshot.credentials;
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const next = { ...original, claudeAiOauth: { ...original.claudeAiOauth, ...oauth } };
  const body = `${JSON.stringify(next, null, 2)}\n`;
  try {
    if ((await jsonFile(filePath, 'credentials-changed')).revision !== snapshot.revision) throw new AccountUsageFailure('credentials-changed');
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600).catch(() => undefined);
    if ((await jsonFile(filePath, 'credentials-changed')).revision !== snapshot.revision) throw new AccountUsageFailure('credentials-changed');
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { credentials: next, revision: createHash('sha256').update(body).digest('hex') };
}

async function refreshClaudeToken(fetchImpl, credentialsPath, snapshot, now) {
  const credentials = snapshot.credentials;
  const oauth = credentials?.claudeAiOauth;
  if (!oauth || typeof oauth.refreshToken !== 'string' || !oauth.refreshToken) throw new AccountUsageFailure('auth-expired');
  const scope = Array.isArray(oauth.scopes) ? oauth.scopes.filter((item) => typeof item === 'string').join(' ') : '';
  const token = await requestJson(fetchImpl, CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLAUDE_CLIENT_ID, ...(scope ? { scope } : {}) }),
  });
  if (typeof token.access_token !== 'string' || !token.access_token || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || !Number.isSafeInteger(now() + token.expires_in * 1_000)) throw new AccountUsageFailure('unsupported-response');
  const nextOauth = {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === 'string' && token.refresh_token ? token.refresh_token : oauth.refreshToken,
    expiresAt: now() + Number(token.expires_in) * 1_000,
    scopes: typeof token.scope === 'string' && token.scope.trim() ? token.scope.trim().split(/\s+/) : oauth.scopes,
  };
  try { return await persistClaudeCredentials(credentialsPath, snapshot, nextOauth); }
  catch (error) { throw new AccountUsageFailure(error?.reason === 'credentials-changed' ? error.reason : 'credential-write-failed'); }
}

function unavailable(provider, reason, checkedAt) {
  return { provider, status: 'unavailable', reason, fetchedAt: null, checkedAt, windows: [] };
}

function staleWindows(windows, nowMs) {
  return windows.map((window) => {
    const reset = Date.parse(window.resetsAt || '');
    return Number.isFinite(reset) && reset <= nowMs
      ? { ...window, usedPercent: null, remainingPercent: null, resetExpired: true } : window;
  });
}

export function createAccountUsageService({
  fetchImpl = fetch,
  now = () => Date.now(),
  codexAuthPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'),
  claudeCredentialsPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json'),
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  const cache = new Map();
  const lastGood = new Map();
  const active = new Map();
  const credentialsPath = (provider) => provider === 'claude' ? claudeCredentialsPath : codexAuthPath;

  async function codex(snapshot) {
    const credentials = snapshot.credentials;
    const accessToken = credentials?.tokens?.access_token;
    const accountId = credentials?.tokens?.account_id;
    if (typeof accessToken !== 'string' || !accessToken) throw new AccountUsageFailure('not-signed-in');
    const payload = await requestJson(fetchImpl, CODEX_USAGE_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...(typeof accountId === 'string' && accountId ? { 'chatgpt-account-id': accountId } : {}) },
    });
    return normalizeCodexUsage(payload, new Date(now()).toISOString());
  }

  async function claude(state) {
    let credentials = state.snapshot.credentials;
    let oauth = credentials?.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) throw new AccountUsageFailure('not-signed-in');
    if (typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= now() + 30_000) {
      state.snapshot = await refreshClaudeToken(fetchImpl, claudeCredentialsPath, state.snapshot, now);
      credentials = state.snapshot.credentials;
      oauth = credentials.claudeAiOauth;
    }
    let payload;
    try {
      payload = await requestJson(fetchImpl, CLAUDE_USAGE_URL, { headers: { authorization: `Bearer ${oauth.accessToken}`, accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' } });
    } catch (error) {
      if (error?.reason !== 'auth-expired') throw error;
      state.snapshot = await refreshClaudeToken(fetchImpl, claudeCredentialsPath, state.snapshot, now);
      credentials = state.snapshot.credentials;
      oauth = credentials.claudeAiOauth;
      payload = await requestJson(fetchImpl, CLAUDE_USAGE_URL, { headers: { authorization: `Bearer ${oauth.accessToken}`, accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' } });
    }
    return normalizeClaudeUsage(payload, new Date(now()).toISOString(), typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null);
  }

  async function load(provider, state) {
    let value;
    try { value = await (provider === 'claude' ? claude(state) : codex(state.snapshot)); }
    catch (error) { value = unavailable(provider, error?.reason || 'service-unavailable', new Date(now()).toISOString()); }
    try {
      if ((await jsonFile(credentialsPath(provider), 'not-signed-in')).revision !== state.snapshot.revision) value = unavailable(provider, 'credentials-changed', new Date(now()).toISOString());
    } catch (error) { value = unavailable(provider, error?.reason || 'invalid-credentials', new Date(now()).toISOString()); }
    return value;
  }

  async function get(provider, { refresh = false } = {}) {
    if (!['codex', 'claude'].includes(provider)) throw new TypeError('Invalid provider.');
    if (active.has(provider)) return active.get(provider);
    const pending = (async () => {
      let snapshot;
      try { snapshot = await jsonFile(credentialsPath(provider), 'not-signed-in'); }
      catch (error) { cache.delete(provider); lastGood.delete(provider); return unavailable(provider, error?.reason || 'invalid-credentials', new Date(now()).toISOString()); }
      const cached = cache.get(provider);
      if (cached?.revision !== snapshot.revision) { cache.delete(provider); lastGood.delete(provider); }
      if (!refresh && cached?.revision === snapshot.revision && now() - cached.cachedAt < cacheTtlMs) {
        return cached.value.status === 'stale' ? { ...cached.value, windows: staleWindows(cached.value.windows, now()) } : cached.value;
      }
      const state = { snapshot };
      let value = await load(provider, state);
      if (value.status === 'available') {
        value = { ...value, checkedAt: value.fetchedAt };
        lastGood.set(provider, { revision: state.snapshot.revision, value });
      } else {
        const good = lastGood.get(provider);
        // An owned OAuth rotation preserves login continuity; external replacements do not.
        if (['network', 'rate-limit', 'service-unavailable'].includes(value.reason) && good && [snapshot.revision, state.snapshot.revision].includes(good.revision)) {
          lastGood.set(provider, { ...good, revision: state.snapshot.revision });
          value = { ...good.value, status: 'stale', reason: value.reason, checkedAt: value.checkedAt, windows: staleWindows(good.value.windows, now()) };
        } else lastGood.delete(provider);
      }
      cache.set(provider, { cachedAt: now(), revision: state.snapshot.revision, value });
      return value;
    })().finally(() => active.delete(provider));
    active.set(provider, pending);
    return pending;
  }

  return { get };
}
