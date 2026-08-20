import { parentPort, workerData } from 'node:worker_threads';
import { parseClaudeSessionFile } from './claude-session.mjs';
import { parseSessionFile } from './session-index.mjs';

if (!parentPort) throw new Error('Session parser worker requires a parent port.');

const results = [];
const parser = workerData.provider === 'claude' ? parseClaudeSessionFile : parseSessionFile;
for (const { entry, index } of workerData.entries) {
  try { results.push({ entry, index, session: await parser(entry.filePath, entry.relativePath) }); }
  catch (error) { results.push({ entry, index, error: error instanceof Error ? error.message : String(error) }); }
}
parentPort.postMessage({ results });
