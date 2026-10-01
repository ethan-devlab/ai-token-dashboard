import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-stream-http-'));
let child; let base; let clockOffset = 0; let currentInput = 12;
const settings = { writeDelay: 0, prepareDelay: 0, failAfter: 0 };
const modeFile = path.join(root, 'mode.json'); const clockFile = path.join(root, 'clock');
const modes = () => writeFile(modeFile, JSON.stringify(settings));
const record = (id, padding, input = 12) => [{ type: 'session_meta', timestamp: padding ? '2026-09-01T00:00:00Z' : '2026-10-01T00:00:00Z', payload: { id: id + 'x'.repeat(padding), model: 'gpt-5.5', cwd: '/TEST_ONLY/workspace' } },
  { type: 'turn.completed', event_id: id, timestamp: padding ? '2026-09-01T00:00:00Z' : '2026-10-01T00:00:00Z', model: 'gpt-5.5', usage: { input_tokens: input, output_tokens: 0 } }].map(JSON.stringify).join('\n') + '\n';
const query = 'mode=all&timezone=UTC';
async function dashboard() { const response = await fetch(base + '/api/dashboard?' + query); assert.equal(response.status, 200); return response.json(); }
const pin = (data) => `${query}&projectionAt=${data.projection.at}&projection=${data.projection.key}`;
async function prepare(data, format = 'csv-sessions') {
  const response = await fetch(base + `/api/export/prepare?${pin(data)}&format=${format}`, { method: 'POST', headers: { Origin: base } });
  assert.equal(response.status, 200); return response.json();
}
async function refresh() {
  const response = await fetch(base + '/api/refresh?' + query, { method: 'POST', headers: { Origin: base } }); assert.equal(response.status, 200); return response.json();
}
async function change() { currentInput += 10; await writeFile(path.join(root, 'codex', 'short-000.jsonl'), record('TEST_ONLY_SHORT_000', 0, currentInput)); return refresh(); }
try {
  await Promise.all(['server', 'public'].map(name => cp(path.join(source, name), path.join(root, name), { recursive: true })));
  await Promise.all(['server.mjs', 'package.json'].map(name => cp(path.join(source, name), path.join(root, name))));
  for (const name of ['codex', 'claude', 'received']) await mkdir(path.join(root, name));
  for (let i = 0; i < 100; i++) await writeFile(path.join(root, 'codex', `short-${String(i).padStart(3, '0')}.jsonl`), record(`TEST_ONLY_SHORT_${String(i).padStart(3, '0')}`, 0));
  for (let i = 0; i < 500; i++) await writeFile(path.join(root, 'codex', `big-${i}.jsonl`), record(`TEST_ONLY_BIG_${i}`, 70000));
  await writeFile(path.join(root, '.env'), `CODEX_SESSIONS_DIR=${path.join(root, 'codex')}\nCLAUDE_SESSIONS_DIR=${path.join(root, 'claude')}\nAUTO_REFRESH=0\nMAX_FILES=1000\nPARSE_CONCURRENCY=2\n`);
  await modes(); await writeFile(clockFile, '0');
  await writeFile(path.join(root, 'public', 'index.html'), (await readFile(path.join(root, 'public', 'index.html'), 'utf8')).replace('<main ', '<p role="status">TEST ONLY streamed export QA: synthetic logs, isolated settings and credentials, all external fetch blocked.</p><main '));
  await writeFile(path.join(root, 'offline.mjs'), `import http from 'node:http';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const realNow=Date.now; Date.now=()=>realNow()+Number(readFileSync(new URL('./clock',import.meta.url),'utf8'));
globalThis.fetch=async()=>Response.json({}, {status:503});
const original=http.createServer; let sequence=0;
http.createServer=function(listener){return original.call(this,async(req,res)=>{
 const mode=JSON.parse(readFileSync(new URL('./mode.json',import.meta.url),'utf8'));
 const exporting=req.url.startsWith('/api/export?')||req.url.startsWith('/api/export/download/');
 let bytes=0; let file; let expected; let scope;
 if(exporting){file=new URL('./received/'+(++sequence)+'.body',import.meta.url); writeFileSync(file,'');
 const head=res.writeHead;res.writeHead=function(status,...args){const headers=args.find(value=>value&&typeof value==='object');expected=Number(headers?.['Content-Length']);scope=headers?.['X-Export-Scope'];return head.call(this,status,...args);};
 const write=res.write; res.write=function(chunk,callback){bytes+=chunk.length;appendFileSync(file,chunk);
 if(mode.failAfter&&bytes>=mode.failAfter){res.destroy();callback?.(new Error('TEST ONLY interrupted transfer'));return false;}
 return write.call(this,chunk,err=>{if(mode.writeDelay)setTimeout(()=>callback?.(err),mode.writeDelay);else callback?.(err);});};
 res.on('finish',()=>appendFileSync(new URL('./received/manifest.jsonl',import.meta.url),JSON.stringify({file:file.pathname,complete:true,bytes,expected,scope})+'\\n'));}
 if(req.url.startsWith('/api/export/prepare?')){const end=res.end;res.end=function(...args){if(mode.prepareDelay)setTimeout(()=>{if(!res.destroyed)end.apply(this,args);},mode.prepareDelay);else return end.apply(this,args);};}
 await listener(req,res);
});};syncBuiltinESMExports();
`);
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; const closed = once(probe, 'close'); probe.close(); await closed; base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', path.join(root, 'offline.mjs'), path.join(root, 'server.mjs')], { cwd: root,
    env: { HOST: '127.0.0.1', PORT: String(port), CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false; child.stdout.on('data', chunk => { if (String(chunk).includes('Local AI Token Dashboard:')) ready = true; }); child.stderr.on('data', () => undefined);
  for (let i = 0; !ready && i < 200; i++) { if (child.exitCode != null) throw new Error('Fixture server exited.'); await delay(25); } assert.ok(ready);
  const before = await dashboard(); assert.equal(before.totals.totalTokens, 7200);
  assert.equal((await fetch(base + '/api/export/prepare?' + pin(before), { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/export/prepare?' + query, { method: 'POST', headers: { Origin: base } })).status, 400);
  const prepared = await prepare(before);
  const busy = await fetch(base + '/api/export?' + query); assert.equal(busy.status, 429); assert.equal((await busy.json()).error.code, 'EXPORT_BUSY');
  const after = await change(); assert.equal(after.totals.totalTokens, 7210);
  const downloaded = await fetch(base + prepared.downloadUrl); assert.equal(downloaded.status, 200);
  const csv = Buffer.from(await downloaded.arrayBuffer()); assert.equal(csv.length, prepared.byteLength); assert.ok(csv.length > 32 * 1048576); assert.equal(csv.toString().split('\r\n').length, 601);
  const scope = JSON.parse(decodeURIComponent(downloaded.headers.get('X-Export-Scope'))); assert.equal(scope.snapshotVersion, before.scan.snapshotVersion); assert.equal(scope.projection, before.projection.key);
  const lines = csv.toString().split('\r\n'); assert.equal(lines.slice(1).reduce((sum, line) => sum + Number(line.split(',')[6].replaceAll('"', '')), 0), 7200);
  assert.equal((await fetch(base + prepared.downloadUrl)).status, 410);
  assert.equal((await fetch(base + '/api/export/prepare?' + pin(before), { method: 'POST', headers: { Origin: base } })).status, 409);
  for (const format of ['csv-trend', 'json-report', 'markdown-summary']) { const item = await prepare(after, format); const result = await fetch(base + item.downloadUrl); assert.equal(result.status, 200); assert.equal((await result.arrayBuffer()).byteLength, item.byteLength); }
  const expired = await prepare(after); clockOffset = 120001; await writeFile(clockFile, String(clockOffset)); assert.equal((await fetch(base + expired.downloadUrl)).status, 410); await writeFile(clockFile, '0');
  const ranged = await prepare(after); assert.equal((await fetch(base + ranged.downloadUrl, { headers: { Range: 'bytes=1-' } })).status, 416); const fullRangeRetry = await fetch(base + ranged.downloadUrl); assert.equal(fullRangeRetry.status, 200); await fullRangeRetry.arrayBuffer();
  settings.writeDelay = 10; await modes(); const slow = await prepare(after); const controller = new AbortController();
  const flowing = await fetch(base + slow.downloadUrl, { signal: controller.signal }); const reader = flowing.body.getReader(); await reader.read();
  assert.equal((await fetch(base + '/api/export?' + query)).status, 429); controller.abort(); await assert.rejects(reader.read()); await delay(100);
  settings.writeDelay = 0; settings.failAfter = 1048576; await modes();
  const interrupted = await prepare(after); const broken = await fetch(base + interrupted.downloadUrl); await assert.rejects(broken.arrayBuffer());
  settings.failAfter = 0; await modes(); const retry = await prepare(after, 'json-report'); const retried = await fetch(base + retry.downloadUrl); assert.equal((await retried.json()).totals.totalTokens, 7210);
  console.log('PASS: native preparation guards, one slot, original snapshot after refresh, uncapped complete CSV, four formats, one-use/expiry/Range, actual abort/interruption and retry.');
  if (process.argv.includes('--serve')) {
    settings.writeDelay = 25; await modes();
    console.log(JSON.stringify({ TEST_ONLY: true, root, base, bytes: csv.length, commands: 'normal | slow | fault | delay | refresh | expired | reset' }));
    await new Promise(resolve => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.on('data', async chunk => {
        const command = String(chunk).trim();
        if (command === 'refresh') { const data = await change(); console.log(JSON.stringify({ snapshotVersion: data.scan.snapshotVersion, tokens: data.totals.totalTokens })); return; }
        settings.writeDelay = command === 'slow' ? 25 : 0; settings.failAfter = command === 'fault' ? 1048576 : 0; settings.prepareDelay = command === 'delay' ? 2000 : 0;
        await modes(); await writeFile(clockFile, command === 'expired' ? '120001' : '0'); console.log('TEST ONLY mode: ' + command);
      });
    });
  }
} finally {
  process.stdin.pause();
  if (child && child.exitCode == null && child.signalCode == null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exit, delay(5000, null, { ref: false }).then(() => { child.kill('SIGKILL'); throw new Error('Fixture shutdown timed out.'); })]); }
  await rm(root, { recursive: true, force: true });
}
