import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';

export const DEFAULT_UPDATE_REPOSITORY = 'ethan-devlab/ai-token-dashboard';

export function parseEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
  }
  return Object.freeze(values);
}

export function readEnvFile(filePath) {
  try {
    return parseEnv(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return Object.freeze({});
    throw error;
  }
}

function value(environment, localConfig, key, fallback = undefined) {
  return environment[key] ?? localConfig[key] ?? fallback;
}

function integer(value, name, minimum, maximum) {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${name}.`);
  }
  return parsed;
}

function flag(value, name) {
  if (value === '0' || value === 'false' || value === false || value == null) return false;
  if (value === '1' || value === 'true' || value === true) return true;
  throw new Error(`Invalid ${name}.`);
}

export function isLoopbackHost(host) {
  const normalized = String(host).trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

export function isLoopbackAddress(value) {
  const address = String(value || '').replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) return address.split('.')[0] === '127';
  if (family !== 6 || address.includes('%')) return false;
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1);
  if (normalized === '::1') return true;
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
  return Boolean(mapped && (Number.parseInt(mapped[1], 16) >> 8) === 127);
}

export function allowedRequestHost(config, host, localAddress) {
  const configuredHost = config.host.toLowerCase();
  const authority = (address) => `${address.includes(':') && !address.startsWith('[') ? `[${address}]` : address}:${config.port}`.toLowerCase();
  const requested = String(host || '').toLowerCase();
  if (requested === authority(configuredHost)) return true;
  if (isLoopbackHost(configuredHost)) return ['127.0.0.1', 'localhost', '::1'].some(address => requested === authority(address));
  if (!['0.0.0.0', '::', '[::]'].includes(configuredHost) || !isIP(localAddress || '')) return false;
  if (isLoopbackAddress(localAddress) && ['127.0.0.1', 'localhost', '::1'].some(address => requested === authority(address))) return true;
  // A wildcard listens on several interfaces. Admit only this socket's destination, never forwarded headers.
  return [localAddress, localAddress.replace(/^::ffff:/i, '')].some(address => requested === authority(address));
}

export function readRuntimeConfig({ environment = process.env, localConfig = {} } = {}) {
  const host = String(value(environment, localConfig, 'HOST', '127.0.0.1')).trim();
  const port = integer(value(environment, localConfig, 'PORT', '3333'), 'PORT', 1, 65_535);
  const parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const parseConcurrency = integer(
    value(environment, localConfig, 'PARSE_CONCURRENCY', String(Math.min(4, parallelism))),
    'PARSE_CONCURRENCY', 1, 16
  );
  const allowRemote = flag(value(environment, localConfig, 'ALLOW_REMOTE', '0'), 'ALLOW_REMOTE');
  const exposeFullPaths = flag(value(environment, localConfig, 'EXPOSE_FULL_PATHS', '0'), 'EXPOSE_FULL_PATHS');
  const autoRefresh = flag(value(environment, localConfig, 'AUTO_REFRESH', '0'), 'AUTO_REFRESH');
  const autoRefreshDebounceMs = integer(
    value(environment, localConfig, 'AUTO_REFRESH_DEBOUNCE_MS', '1500'),
    'AUTO_REFRESH_DEBOUNCE_MS', 100, 60_000
  );
  if (!isLoopbackHost(host) && !allowRemote) {
    throw new Error('Non-loopback HOST requires ALLOW_REMOTE=1.');
  }
  if (exposeFullPaths && !isLoopbackHost(host)) {
    throw new Error('EXPOSE_FULL_PATHS=1 requires a loopback HOST.');
  }
  const defaultCodexSessionsDirectory = path.join(os.homedir(), '.codex', 'sessions');
  const defaultClaudeSessionsDirectory = path.join(os.homedir(), '.claude', 'projects');
  const codexSessionsDirectory = path.resolve(value(environment, localConfig, 'CODEX_SESSIONS_DIR', defaultCodexSessionsDirectory));
  const claudeSessionsDirectory = path.resolve(value(environment, localConfig, 'CLAUDE_SESSIONS_DIR', defaultClaudeSessionsDirectory));
  return Object.freeze({
    host,
    port,
    sessionsDirectory: codexSessionsDirectory,
    codexSessionsDirectory,
    claudeSessionsDirectory,
    maxFiles: integer(value(environment, localConfig, 'MAX_FILES', '10000'), 'MAX_FILES', 1, 100_000),
    parseConcurrency,
    allowRemote,
    exposeFullPaths,
    autoRefresh,
    autoRefreshDebounceMs,
    // Update checks are deliberately exempt from process-env overrides.
    updateRepository: localConfig.UPDATE_REPOSITORY ?? DEFAULT_UPDATE_REPOSITORY,
  });
}
