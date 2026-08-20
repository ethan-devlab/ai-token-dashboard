import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv, readRuntimeConfig } from './config.mjs';
import { validRepository } from './update-checker.mjs';

export const SETTINGS_KEYS = Object.freeze([
  'HOST',
  'PORT',
  'CODEX_SESSIONS_DIR',
  'CLAUDE_SESSIONS_DIR',
  'MAX_FILES',
  'PARSE_CONCURRENCY',
  'ALLOW_REMOTE',
  'EXPOSE_FULL_PATHS',
  'AUTO_REFRESH',
  'AUTO_REFRESH_DEBOUNCE_MS',
  'UPDATE_REPOSITORY',
]);

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'INVALID_SETTINGS';
  return error;
}

function settingValue(localConfig, runtimeConfig, key, fallback) {
  return localConfig[key] ?? fallback(runtimeConfig);
}

function flagValue(value, name) {
  if (value === '1' || value === 'true') return '1';
  if (value === '0' || value === 'false') return '0';
  throw invalid(`Invalid ${name}.`);
}

function requiredString(input, key) {
  const value = input?.[key];
  if (typeof value !== 'string' || value.length > 4_096 || /[\r\n\0]/.test(value)) throw invalid(`Invalid ${key}.`);
  return value.trim();
}

export function settingsPayload(localConfig, runtimeConfig) {
  return Object.freeze({
    settings: Object.freeze({
      HOST: settingValue(localConfig, runtimeConfig, 'HOST', (config) => config.host),
      PORT: settingValue(localConfig, runtimeConfig, 'PORT', (config) => String(config.port)),
      CODEX_SESSIONS_DIR: settingValue(localConfig, runtimeConfig, 'CODEX_SESSIONS_DIR', (config) => config.sessionsDirectory),
      CLAUDE_SESSIONS_DIR: settingValue(localConfig, runtimeConfig, 'CLAUDE_SESSIONS_DIR', (config) => config.claudeSessionsDirectory),
      MAX_FILES: settingValue(localConfig, runtimeConfig, 'MAX_FILES', (config) => String(config.maxFiles)),
      PARSE_CONCURRENCY: settingValue(localConfig, runtimeConfig, 'PARSE_CONCURRENCY', (config) => String(config.parseConcurrency)),
      ALLOW_REMOTE: settingValue(localConfig, runtimeConfig, 'ALLOW_REMOTE', (config) => config.allowRemote ? '1' : '0'),
      EXPOSE_FULL_PATHS: settingValue(localConfig, runtimeConfig, 'EXPOSE_FULL_PATHS', (config) => config.exposeFullPaths ? '1' : '0'),
      AUTO_REFRESH: settingValue(localConfig, runtimeConfig, 'AUTO_REFRESH', (config) => config.autoRefresh ? '1' : '0'),
      AUTO_REFRESH_DEBOUNCE_MS: settingValue(localConfig, runtimeConfig, 'AUTO_REFRESH_DEBOUNCE_MS', (config) => String(config.autoRefreshDebounceMs)),
      UPDATE_REPOSITORY: localConfig.UPDATE_REPOSITORY || '',
    }),
    restartRequired: true,
  });
}

export function normalizeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Settings must be an object.');
  const keys = Object.keys(input);
  if (keys.length !== SETTINGS_KEYS.length || keys.some((key) => !SETTINGS_KEYS.includes(key))) throw invalid('Unexpected settings payload.');

  const values = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, requiredString(input, key)]));
  if (!values.HOST || !values.CODEX_SESSIONS_DIR || !values.CLAUDE_SESSIONS_DIR) throw invalid('HOST and provider session directories are required.');
  values.ALLOW_REMOTE = flagValue(values.ALLOW_REMOTE, 'ALLOW_REMOTE');
  values.EXPOSE_FULL_PATHS = flagValue(values.EXPOSE_FULL_PATHS, 'EXPOSE_FULL_PATHS');
  values.AUTO_REFRESH = flagValue(values.AUTO_REFRESH, 'AUTO_REFRESH');
  if (values.UPDATE_REPOSITORY && !validRepository(values.UPDATE_REPOSITORY)) throw invalid('Invalid UPDATE_REPOSITORY.');

  try {
    readRuntimeConfig({ environment: {}, localConfig: values });
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : 'Invalid settings.');
  }
  return Object.freeze(values);
}

export function mergeEnvText(existing, values) {
  const seen = new Set();
  const lines = String(existing).split(/\r?\n/).map((line) => {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match || !SETTINGS_KEYS.includes(match[1])) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const key of SETTINGS_KEYS) if (!seen.has(key)) lines.push(`${key}=${values[key]}`);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export async function saveSettings(envPath, input) {
  const values = normalizeSettings(input);
  let existing = '';
  try {
    existing = await readFile(envPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const next = mergeEnvText(existing, values);
  const temporaryPath = path.join(path.dirname(envPath), `.${path.basename(envPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporaryPath, next, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, envPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return parseEnv(next);
}
