import { lstat } from 'node:fs/promises';
import { fileFingerprint } from './session-file-state.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { parseClaudeSessionFile } from './claude-session.mjs';
import { parseSessionFile } from './session-index.mjs';

if (!parentPort) throw new Error('Session parser worker requires a parent port.');

const results = [];
const parser = workerData.provider === 'claude' ? parseClaudeSessionFile : parseSessionFile;
for (const { entry, index } of workerData.entries) {
  try {
    const before = await lstat(entry.filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || fileFingerprint(before) !== entry.fingerprint) { results.push({ entry, index, error: true, reason: 'files-changed' }); continue; }
    const session = await parser(entry.filePath, entry.relativePath);
    const after = await lstat(entry.filePath, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || fileFingerprint(after) !== entry.fingerprint) results.push({ entry, index, error: true, reason: 'files-changed' });
    else results.push({ entry, index, session });
  } catch (error) { results.push({ entry, index, error: true, reason: error?.code === 'ENOENT' ? 'files-changed' : 'file-parse' }); }
}
parentPort.postMessage({ results });
