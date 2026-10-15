import { addUsage, USAGE_KEYS, zeroUsage } from './usage.mjs';

const COUNTERS = ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
const signature = (item) => JSON.stringify([item.source, item.model, item.usage, item.pricingModifiers, item.serverToolUse, item.cacheWriteInconsistent]);
const identityKey = (item) => item.identity ? `${item.source}:${item.identity}` : null;
const validTime = (item) => !item.timestampEstimated && Number.isFinite(Date.parse(item.timestamp));

export function validUsage(raw, keys) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) && keys.some((key) => raw[key] != null) && keys.every((key) => raw[key] === undefined || typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0);
}

export function selectObservationVersions(observations, confirmed = new Map()) {
  const groups = new Map();
  const selected = [];
  const versions = new Map();
  let duplicate = 0;
  let conflict = 0;
  const conflictKeys = new Set();
  let invalidUsage = 0;
  for (const item of observations) {
    if (item.valid === false) invalidUsage += 1;
    const key = identityKey(item);
    if (!key) { if (item.valid !== false) selected.push(item); continue; }
    const group = groups.get(key) || [];
    group.push(item); groups.set(key, group);
  }
  for (const [key, items] of groups) {
    duplicate += items.length - 1;
    // Sequence is comparable only within one file. Time is authoritative when both versions have it.
    const byFile = new Map();
    for (const item of items) {
      if (item.valid === false) continue;
      const previous = byFile.get(item.file);
      if (!previous || (validTime(item) && validTime(previous)
        ? Date.parse(item.timestamp) > Date.parse(previous.timestamp) || item.timestamp === previous.timestamp && item.sequence > previous.sequence
        : item.sequence > previous.sequence)) byFile.set(item.file, item);
    }
    const candidates = [...byFile.values()];
    let winner;
    if (!candidates.length) { const known = confirmed.get(key); if (known) selected.push(known); continue; }
    if (new Set(candidates.map(signature)).size === 1) {
      const reliable = candidates.filter(validTime);
      winner = reliable.length ? reliable.reduce((latest, item) => Date.parse(item.timestamp) > Date.parse(latest.timestamp) ? item : latest) : candidates[0];
    }
    else if (candidates.every(validTime)) {
      const newestTime = candidates.reduce((latest, item) => Math.max(latest, Date.parse(item.timestamp)), -Infinity);
      const newest = candidates.filter((item) => Date.parse(item.timestamp) === newestTime);
      if (new Set(newest.map(signature)).size === 1) winner = newest[0];
    }
    if (!winner) { conflict += 1; conflictKeys.add(key); winner = confirmed.get(key); }
    else versions.set(key, winner);
    if (winner) selected.push(winner);
  }
  return { observations: selected, versions, duplicate, conflict, conflictKeys, invalidUsage };
}

export function reconcileUsage(observations, initial = {}, excludedCumulativeModels = [], baseline = zeroUsage()) {
  const diagnostics = { cumulativeSeen: 0, turnSeen: 0, accepted: 0, duplicate: 0, covered: 0, fullReset: 0, partialReset: 0, ambiguous: 0, negativeDelta: 0, missingIdentity: 0, mixedSource: 0, conflict: 0, possibleDuplicate: 0, cacheWriteInconsistent: 0, invalidUsage: 0, ...initial };
  const accepted = [];
  const cumulativeModels = new Set([...excludedCumulativeModels, ...observations.filter((item) => item.source === 'cumulative').map((item) => item.model || 'unknown')]);
  let previous = baseline;
  for (const item of observations) {
    if (!item.identity) diagnostics.missingIdentity += 1;
    if (!item.identity && item.source === 'assistant') diagnostics.possibleDuplicate = 1;
    if (item.cacheWriteInconsistent) diagnostics.cacheWriteInconsistent += 1;
    if (item.source !== 'cumulative') {
      diagnostics.turnSeen += 1;
      if (item.source === 'turn' && cumulativeModels.has(item.model || 'unknown')) {
        diagnostics.mixedSource += 1; diagnostics.ambiguous += 1;
        continue;
      }
      accepted.push(item); continue;
    }
    diagnostics.cumulativeSeen += 1;
    if (item.attributedUsage) {
      if (USAGE_KEYS.some((key) => item.attributedUsage[key] > 0)) accepted.push({ ...item, usage: item.attributedUsage });
      else diagnostics.duplicate += 1;
      previous = item.usage;
      continue;
    }
    const current = item.usage;
    const decreased = COUNTERS.filter((key) => current[key] < previous[key]);
    if (decreased.length) {
      const active = COUNTERS.filter((key) => previous[key] > 0);
      const primaryRestart = previous.inputTokens > 0 && previous.outputTokens > 0 && current.inputTokens < previous.inputTokens && current.outputTokens < previous.outputTokens;
      const cleared = COUNTERS.every((key) => current[key] === 0);
      const fullRestart = (primaryRestart || cleared) && active.every((key) => current[key] < previous[key]) && COUNTERS.every((key) => current[key] <= previous[key]);
      if (!fullRestart) {
        diagnostics.partialReset += 1; diagnostics.ambiguous += 1;
        previous = current;
        continue;
      }
      diagnostics.fullReset += 1; previous = zeroUsage();
    }
    const usage = Object.fromEntries(USAGE_KEYS.map((key) => [key, Math.max(0, current[key] - previous[key])]));
    usage.uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens);
    if (USAGE_KEYS.every((key) => usage[key] === 0)) diagnostics.duplicate += 1;
    else accepted.push({ ...item, usage });
    previous = current;
  }
  diagnostics.accepted = accepted.length;
  accepted.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.sequence - right.sequence);
  return { usageEvents: accepted, usage: accepted.reduce((sum, item) => addUsage(sum, item.usage), zeroUsage()), reconciliation: diagnostics };
}

export function reconcileSession(session, observations = session.usageObservations, initial = {}, excludedCumulativeModels = []) {
  const result = reconcileUsage(observations, initial, excludedCumulativeModels);
  return { ...session, ...result, tokenCountEventCount: session.provider === 'claude' ? result.reconciliation.accepted : result.reconciliation.cumulativeSeen, turnUsageEventCount: result.reconciliation.turnSeen, duplicateTokenCountEventCount: result.reconciliation.duplicate, cumulativeResetCount: result.reconciliation.fullReset + result.reconciliation.partialReset };
}

function orderCumulative(observations, files, canonical) {
  const cumulative = observations.filter((item) => item.source === 'cumulative');
  const keyFor = (item) => identityKey(item) ? `event:${identityKey(item)}` : `file:${JSON.stringify([item.file, item.sequence])}`;
  const nodes = new Map(cumulative.map((item) => [keyFor(item), { item, next: new Set(), degree: 0 }]));
  for (const file of files) {
    const positions = new Map();
    for (const item of file.usageObservations) if (item.source === 'cumulative' && nodes.has(keyFor(item))) positions.set(keyFor(item), item.sequence);
    const keys = [...positions].sort((left, right) => left[1] - right[1]).map(([key]) => key);
    for (let index = 1; index < keys.length; index += 1) {
      const before = nodes.get(keys[index - 1]); const after = nodes.get(keys[index]);
      if (!before.next.has(keys[index])) { before.next.add(keys[index]); after.degree += 1; }
    }
  }
  const ready = [...nodes.values()].filter((node) => !node.degree);
  const ordered = [];
  while (ready.length) {
    let chosen = ready[0];
    if (ready.length > 1) {
      if (!ready.every((node) => validTime(node.item))) break;
      const earliest = ready.reduce((time, node) => Math.min(time, Date.parse(node.item.timestamp)), Infinity);
      const candidates = ready.filter((node) => Date.parse(node.item.timestamp) === earliest);
      if (new Set(candidates.map((node) => JSON.stringify(node.item.usage))).size > 1) break;
      chosen = candidates[0];
    }
    ready.splice(ready.indexOf(chosen), 1);
    ordered.push(chosen.item);
    for (const key of chosen.next) { const node = nodes.get(key); node.degree -= 1; if (!node.degree) ready.push(node); }
  }
  if (ordered.length === cumulative.length) return { observations: [...ordered, ...observations.filter((item) => item.source !== 'cumulative')], incomplete: 0 };
  // No proven order: retain the canonical file's known chain, not a sum of incompatible baselines.
  const positions = new Map();
  for (const item of canonical.usageObservations) if (item.source === 'cumulative' && nodes.has(keyFor(item))) positions.set(keyFor(item), item.sequence);
  const retained = [...positions].sort((left, right) => left[1] - right[1]).map(([key]) => nodes.get(key).item);
  return { observations: [...retained, ...observations.filter((item) => item.source !== 'cumulative')], incomplete: 1 };
}

function scopeKey(session) {
  // A filename fallback is not evidence of a shared Session identity.
  return session.sessionIdentity ? JSON.stringify([session.provider, session.sessionIdentity, session.executionType || 'main', session.agentId || null]) : `file:${session.sessionKey}`;
}

function resolveHistory(sessions) {
  const storage = new Map();
  for (const session of sessions) if (session.provider === 'codex' && session.storageIdentity) {
    const list = storage.get(session.storageIdentity) || [];
    list.push(session); storage.set(session.storageIdentity, list);
  }
  const prefixUsage = (base, visiting = new Set()) => {
    if (!base || visiting.has(base.threadId) || visiting.size >= 64) return null;
    const next = new Set(visiting).add(base.threadId);
    const prefixes = (storage.get(base.threadId) || []).map((session) => {
      if (base.byteOffset > session.decodedSize) return null;
      const last = session.usageObservations.filter((o) => o.source === 'cumulative' && o.valid !== false && o.byteEnd <= base.byteOffset).at(-1);
      return last?.usage || (session.historyBase ? prefixUsage(session.historyBase, next) : zeroUsage());
    }).filter(Boolean);
    return prefixes.length && new Set(prefixes.map((u) => JSON.stringify(u))).size === 1 ? prefixes[0] : null;
  };
  const links = new Map(sessions.map((s) => [s, s]));
  const root = (s) => { while (links.get(s) !== s) s = links.get(s); return s; };
  for (const session of sessions) for (const base of storage.get(session.historyBase?.threadId) || []) {
    if (scopeKey(base) === scopeKey(session)) links.set(root(session), root(base));
  }
  const linkedRoots = new Set(sessions.filter((s) => s.provider === 'codex' && s.historyBase).map(root));
  return sessions.map((session) => {
    if (session.provider !== 'codex' || !linkedRoots.has(root(session))) return session;
    const base = session.historyBase;
    let baseline = zeroUsage(); let incomplete = 0;
    if (base) {
      const resolved = prefixUsage(base, new Set([session.storageIdentity]));
      if (resolved) baseline = resolved;
      else {
        // A missing ancestor must never turn its inherited counter into new usage.
        baseline = session.usageObservations.find((o) => o.source === 'cumulative' && o.valid !== false)?.usage || baseline;
        incomplete = 1;
      }
    }
    const selected = selectObservationVersions(session.usageObservations);
    selected.observations.sort((a, b) => a.sequence - b.sequence);
    const result = reconcileUsage(selected.observations, {}, [], baseline);
    const deltas = new Map(result.usageEvents.map((o) => [o.sequence, o.usage]));
    return { ...session, historyGroup: root(session).file, historyDiagnostics: { ...result.reconciliation, invalidUsage: selected.invalidUsage, duplicate: selected.duplicate }, historyIncomplete: incomplete, usageObservations: selected.observations.map((o) => o.source === 'cumulative' ? { ...o, attributedUsage: deltas.get(o.sequence) || zeroUsage() } : o) };
  });
}

export function reconcileSessionFiles(sessions, previousVersions = new Map(), previousOwners = new Set()) {
  sessions = resolveHistory(sessions);
  const scopes = new Map();
  const versions = new Map();
  const output = [];
  for (const session of sessions) {
    const scope = scopeKey(session);
    const list = scopes.get(scope) || [];
    list.push(session); scopes.set(scope, list);
  }
  for (const [scope, files] of scopes) {
    const scopeCumulativeModels = [...new Set(files.flatMap((file) => file.usageObservations.filter((item) => item.source === 'cumulative' && item.valid !== false).map((item) => item.model || 'unknown')))];
    // Connect files only with proof. Session identity alone leaves independent chains intact.
    const parent = files.map((_, index) => index);
    const root = (index) => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
    const owners = new Map();
    files.forEach((file, index) => {
      const proofs = [`hash:${file.contentHash}`, ...(file.historyGroup ? [`history:${file.historyGroup}`] : []), ...file.usageObservations.map(identityKey).filter(Boolean).map((key) => `event:${key}`)];
      for (const proof of proofs) {
        if (proof === 'hash:undefined') continue;
        if (owners.has(proof)) parent[root(index)] = root(owners.get(proof));
        else owners.set(proof, index);
      }
    });
    const groups = new Map();
    files.forEach((file, index) => { const key = root(index); const list = groups.get(key) || []; list.push(file); groups.set(key, list); });
    for (const group of groups.values()) {
      group.sort((left, right) => Number(previousOwners.has(right.sessionKey)) - Number(previousOwners.has(left.sessionKey)) || left.file.localeCompare(right.file));
      const canonical = group[0];
      const unique = new Map();
      for (const file of group) unique.set(file.contentHash || file.file, unique.get(file.contentHash || file.file) || file);
      const distinct = [...unique.values()];
      const prior = previousVersions.get(scope) || new Map();
      const candidates = distinct.flatMap((file) => file.usageObservations);
      const charged = new Set(candidates.filter((o) => o.identity && o.attributedUsage && o.attributedUsage.totalTokens > 0).map((o) => JSON.stringify([identityKey(o), signature(o)])));
      // An inherited replay must not replace the original charged event with zero.
      const eligible = candidates.filter((o) => !o.identity || !o.attributedUsage || o.attributedUsage.totalTokens > 0 || !charged.has(JSON.stringify([identityKey(o), signature(o)])));
      const selected = selectObservationVersions(eligible, prior);
      selected.duplicate += candidates.length - eligible.length;
      const scopeVersions = versions.get(scope) || new Map();
      for (const [key, item] of selected.versions) scopeVersions.set(key, item);
      for (const item of selected.observations) { const key = identityKey(item); if (key && !scopeVersions.has(key) && prior.has(key)) scopeVersions.set(key, prior.get(key)); }
      versions.set(scope, scopeVersions);
      const unboundedFork = distinct.some((file) => file.forkedFromIdentity && !file.historyBase);
      const possibleDuplicate = unboundedFork || groups.size > 1 || distinct.length > 1 && selected.observations.some((item) => !item.identity) ? 1 : 0;
      const ordered = selected.observations.every((o) => o.source !== 'cumulative' || o.attributedUsage)
        ? { observations: selected.observations, incomplete: 0 } : orderCumulative(selected.observations, distinct, canonical);
      const historyDiagnostics = Object.fromEntries(['fullReset', 'partialReset', 'ambiguous', 'mixedSource', 'invalidUsage', 'duplicate'].map((key) => [key, distinct.reduce((sum, file) => sum + (file.historyDiagnostics?.[key] || 0), 0)]));
      output.push(reconcileSession({ ...canonical, usageObservations: distinct.flatMap((file) => file.usageObservations), invalidLineCount: distinct.reduce((sum, file) => sum + file.invalidLineCount, 0), lineCount: distinct.reduce((sum, file) => sum + file.lineCount, 0) }, ordered.observations, { ...historyDiagnostics, duplicate: selected.duplicate + historyDiagnostics.duplicate, conflict: selected.conflict, invalidUsage: selected.invalidUsage + historyDiagnostics.invalidUsage, possibleDuplicate, incomplete: ordered.incomplete || Number(unboundedFork || distinct.some((file) => file.historyIncomplete)), duplicateFiles: group.length - distinct.length, sourceFiles: group.length }, [...scopeCumulativeModels, ...selected.observations.filter((item) => item.source === 'cumulative').map((item) => item.model || 'unknown')]));
    }
  }
  // Claude message IDs identify responses across forked transcripts, not just files.
  // Keep agents separate: their response namespace is not proven to be shared.
  const namespaces = new Map();
  for (const session of output) if (session.provider === 'claude') {
    const key = JSON.stringify(['claude-responses', session.executionType, session.agentId]);
    const list = namespaces.get(key) || [];
    for (const event of session.usageEvents) list.push(event);
    namespaces.set(key, list);
  }
  const ownedEvents = new Map(output.map((s) => [s, []]));
  const fileOwners = new Map(); const conflicts = new Map();
  for (const session of output) if (session.provider === 'claude') {
    const key = JSON.stringify(['claude-responses', session.executionType, session.agentId]);
    for (const o of session.usageObservations) fileOwners.set(JSON.stringify([key, o.file]), session);
  }
  for (const [key, observations] of namespaces) {
    observations.sort((a, b) => a.file.localeCompare(b.file) || a.sequence - b.sequence);
    const prior = previousVersions.get(key) || new Map();
    const selected = selectObservationVersions(observations, prior);
    for (const o of selected.observations) {
      const id = identityKey(o);
      if (id && !selected.versions.has(id) && prior.has(id)) selected.versions.set(id, prior.get(id));
    }
    versions.set(key, selected.versions);
    for (const o of selected.observations) {
      const owner = fileOwners.get(JSON.stringify([key, o.file]));
      if (owner) ownedEvents.get(owner).push(o);
    }
    if (selected.conflict) conflicts.set(key, selected.conflictKeys);
  }
  const deduplicated = output.map((session) => {
    if (session.provider !== 'claude') return session;
    const events = ownedEvents.get(session);
    events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.sequence - b.sequence);
    const duplicate = Math.max(0, session.usageEvents.length - events.length);
    const conflictKeys = conflicts.get(JSON.stringify(['claude-responses', session.executionType, session.agentId]));
    const conflict = Number(Boolean(conflictKeys && session.usageObservations.some((o) => conflictKeys.has(identityKey(o)))));
    return duplicate || conflict ? { ...session, usageEvents: events, usage: events.reduce((sum, o) => addUsage(sum, o.usage), zeroUsage()), tokenCountEventCount: events.length, duplicateTokenCountEventCount: session.duplicateTokenCountEventCount + duplicate, reconciliation: { ...session.reconciliation, accepted: events.length, duplicate: session.reconciliation.duplicate + duplicate, conflict: session.reconciliation.conflict + conflict } } : session;
  });
  return { sessions: deduplicated, versions };
}
