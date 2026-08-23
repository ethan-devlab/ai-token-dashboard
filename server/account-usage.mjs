import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(100, number) : null;
}

function resetTime(value, seconds = false) {
  if (seconds && Number.isFinite(Number(value))) return new Date(Number(value) * 1_000).toISOString();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizedWindow(id, source, { usedKey, durationKey, resetKey, resetSeconds = false }) {
  if (!source || typeof source !== 'object') return null;
  const usedPercent = finitePercent(source[usedKey]);
  if (usedPercent == null) return null;
  const windowSeconds = Number(source[durationKey]);
  const duration = Number.isFinite(windowSeconds) && windowSeconds > 0 ? Math.round(windowSeconds) : null;
  return {
    id,
    kind: duration === 18_000 || id === 'five-hour' ? 'five-hour' : id,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
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
  try { return JSON.parse(body); }
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

async function persistClaudeCredentials(filePath, original, oauth) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const next = { ...original, claudeAiOauth: { ...original.claudeAiOauth, ...oauth } };
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function refreshClaudeToken(fetchImpl, credentialsPath, credentials, now) {
  const oauth = credentials?.claudeAiOauth;
  if (!oauth || typeof oauth.refreshToken !== 'string' || !oauth.refreshToken) throw new AccountUsageFailure('auth-expired');
  const scope = Array.isArray(oauth.scopes) ? oauth.scopes.filter((item) => typeof item === 'string').join(' ') : '';
  const token = await requestJson(fetchImpl, CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLAUDE_CLIENT_ID, ...(scope ? { scope } : {}) }),
  });
  if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0) throw new AccountUsageFailure('unsupported-response');
  const nextOauth = {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === 'string' && token.refresh_token ? token.refresh_token : oauth.refreshToken,
    expiresAt: now() + Number(token.expires_in) * 1_000,
    scopes: typeof token.scope === 'string' && token.scope.trim() ? token.scope.trim().split(/\s+/) : oauth.scopes,
  };
  try { await persistClaudeCredentials(credentialsPath, credentials, nextOauth); }
  catch { throw new AccountUsageFailure('credential-write-failed'); }
  return { ...credentials, claudeAiOauth: { ...oauth, ...nextOauth } };
}

function unavailable(provider, reason) {
  return { provider, status: 'unavailable', reason, fetchedAt: new Date().toISOString(), windows: [] };
}

export function createAccountUsageService({
  fetchImpl = fetch,
  now = () => Date.now(),
  codexAuthPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'),
  claudeCredentialsPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json'),
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  const cache = new Map();
  const active = new Map();

  async function codex() {
    const credentials = await jsonFile(codexAuthPath, 'not-signed-in');
    const accessToken = credentials?.tokens?.access_token;
    const accountId = credentials?.tokens?.account_id;
    if (typeof accessToken !== 'string' || !accessToken) throw new AccountUsageFailure('not-signed-in');
    const payload = await requestJson(fetchImpl, CODEX_USAGE_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...(typeof accountId === 'string' && accountId ? { 'chatgpt-account-id': accountId } : {}) },
    });
    return normalizeCodexUsage(payload, new Date(now()).toISOString());
  }

  async function claude() {
    let credentials = await jsonFile(claudeCredentialsPath, 'not-signed-in');
    let oauth = credentials?.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) throw new AccountUsageFailure('not-signed-in');
    if (Number.isFinite(Number(oauth.expiresAt)) && Number(oauth.expiresAt) <= now() + 30_000) {
      credentials = await refreshClaudeToken(fetchImpl, claudeCredentialsPath, credentials, now);
      oauth = credentials.claudeAiOauth;
    }
    let payload;
    try {
      payload = await requestJson(fetchImpl, CLAUDE_USAGE_URL, { headers: { authorization: `Bearer ${oauth.accessToken}`, accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' } });
    } catch (error) {
      if (error?.reason !== 'auth-expired') throw error;
      credentials = await refreshClaudeToken(fetchImpl, claudeCredentialsPath, credentials, now);
      oauth = credentials.claudeAiOauth;
      payload = await requestJson(fetchImpl, CLAUDE_USAGE_URL, { headers: { authorization: `Bearer ${oauth.accessToken}`, accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' } });
    }
    return normalizeClaudeUsage(payload, new Date(now()).toISOString(), typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null);
  }

  async function load(provider) {
    try { return await (provider === 'claude' ? claude() : codex()); }
    catch (error) { return unavailable(provider, error?.reason || 'service-unavailable'); }
  }

  async function get(provider, { refresh = false } = {}) {
    if (!['codex', 'claude'].includes(provider)) throw new TypeError('Invalid provider.');
    const cached = cache.get(provider);
    if (!refresh && cached && now() - cached.cachedAt < cacheTtlMs) return cached.value;
    if (active.has(provider)) return active.get(provider);
    const pending = load(provider).then((value) => { cache.set(provider, { cachedAt: now(), value }); return value; }).finally(() => active.delete(provider));
    active.set(provider, pending);
    return pending;
  }

  return { get };
}
