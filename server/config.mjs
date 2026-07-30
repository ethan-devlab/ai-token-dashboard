import { readFileSync } from 'node:fs';

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
