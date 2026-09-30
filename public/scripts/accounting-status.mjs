import { t } from './i18n.mjs';

export function usageWarnings(reconciliation = {}) {
  return [
    ['mixedSource', 'quality.mixedSource'],
    ['partialReset', 'quality.partialReset'],
    ['conflict', 'quality.conflict'],
    ['possibleDuplicate', 'quality.possibleDuplicate'],
    ['cacheWriteInconsistent', 'quality.cacheWriteInconsistent'],
    ['incomplete', 'quality.incomplete'],
    ['invalidUsage', 'quality.invalidUsage'],
  ].filter(([key]) => reconciliation[key] > 0).map(([key, label]) => t(label, { count: reconciliation[key] }));
}
