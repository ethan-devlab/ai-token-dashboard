import { mkdtemp, writeFile, appendFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSessionIndex } from '../server/session-index.mjs';
import { createSummaryCache } from '../server/summary-cache.mjs';
import { PRICING } from '../server/pricing.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-phase3-probe-'));
const record = (input) => JSON.stringify({ type: 'turn.completed', timestamp: '2026-09-01T00:00:00Z', model: 'gpt-5.5', usage: { input_tokens: input, output_tokens: 0 } }) + '\n';
let index;
try {
  const file = path.join(root, 'one.jsonl'); await writeFile(file, record(110));
  index = createSessionIndex({ sessionsDirectory: root, maxFiles: 1, parseConcurrency: 1, pricing: PRICING });
  const before = await index.refresh(); await writeFile(file, 'null\n');
  let failed; try { const result = await index.refresh(); failed = { total: result.totals.totalTokens, failed: result.scan.failed }; } catch (error) { failed = { rejected: true, code: error.code }; }
  await writeFile(file, record(1).repeat(20_000));
  const pending = index.refresh(); await delay(10); await appendFile(file, record(20));
  let first; try { first = await pending; } catch (error) { first = { rejected: true, code: error.code }; }
  const after = await index.refresh();
  let release; let entered; const started = new Promise((resolve) => { entered = resolve; }); let loads = 0;
  const cache = createSummaryCache(async () => { loads += 1; entered(); await new Promise((resolve) => { release = resolve; }); return { scan: {}, marker: loads }; });
  const a = cache.refresh(); await started; const b = cache.refresh(); release(); await Promise.all([a, b]);
  console.log(JSON.stringify({ fixtureOnly: true, exactCap: before.truncated, failedFile: failed, scanWrite: { firstRejected: first.rejected || false, firstTotal: first.totals?.totalTokens, firstReadSize: first.sessions?.[0]?.sizeBytes, finalSize: (await stat(file)).size, nextChanged: after.scan.changed, nextTotal: after.totals.totalTokens }, concurrentRefreshLoaderCalls: loads }, null, 2));
} finally { await index?.close?.(); await rm(root, { recursive: true, force: true }); }
