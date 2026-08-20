export const USAGE_KEYS = Object.freeze([
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'cacheWrite5mTokens',
  'cacheWrite1hTokens',
  'uncachedInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
]);

export function zeroUsage() {
  return Object.fromEntries(USAGE_KEYS.map((key) => [key, 0]));
}

export function addUsage(left, right) {
  for (const key of USAGE_KEYS) left[key] += Number(right?.[key] || 0);
  return left;
}

export function sessionKey(provider, relativePath) {
  return Buffer.from(`${provider}:${relativePath}`).toString('base64url');
}
