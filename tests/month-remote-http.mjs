import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// --tunnel is an explicit live Cloudflare check. Only disposable synthetic services are exposed.
const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-month-remote-'));
const processes = []; const evidence = { fixtureOnly: true, checks: [] };
async function port() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const result = server.address().port; const closed = once(server, 'close'); server.close(); await closed; return result; }
async function stop(instance) { if (instance.child.exitCode != null || instance.child.signalCode != null) return; const exited = once(instance.child, 'exit'); instance.child.kill('SIGTERM'); await exited; }
async function launch(name, values, fail = false) {
  const app = path.join(root, name); await mkdir(app);
  await Promise.all(['server', 'public', 'server.mjs', 'package.json'].map(file => cp(path.join(source, file), path.join(app, file), { recursive: true })));
  const codex = path.join(app, 'synthetic-codex'); const claude = path.join(app, 'synthetic-claude'); await mkdir(codex); await mkdir(claude);
  const events = [{ type: 'session_meta', timestamp: '2026-09-02T00:00:00Z', payload: { id: 'TEST_ONLY_MONTH', model: 'gpt-6.1-sol', cwd: '/TEST_ONLY/private-workspace' } },
    ...[['2026-09-02T00:00:00Z', 7], ['2026-10-02T00:00:00Z', 13]].map(([timestamp, input]) => ({ type: 'turn.completed', timestamp, model: 'gpt-6.1-sol', usage: { input_tokens: input, output_tokens: 0 } }))];
  await writeFile(path.join(codex, 'TEST_ONLY.jsonl'), events.map(JSON.stringify).join('\n') + '\n');
  await writeFile(path.join(app, 'offline.mjs'), `import {PRICING} from './server/pricing.mjs';
globalThis.fetch=async(url)=>{if(!String(url).endsWith('/pricing.md'))return Response.json({}, {status:503});
 const rates={...PRICING.rates,'gpt-6.1-sol':{input:2,cachedInput:0.1,output:10},'gpt-6-sol':{input:2,cachedInput:0.2,output:10}};
 const price=v=>v==null?'-':'$'+v;
 return new Response('### Standard pricing data\\n| Model | Short context input | Short context cached input | Short context cache writes | Short context output |\\n|---|---|---|---|---|\\n'+Object.entries(rates).map(([id,r])=>'| '+[id,price(r.input),price(r.cachedInput),price(r.cacheWrite),price(r.output)].join(' | ')+' |').join('\\n'),{headers:{'content-type':'text/markdown'}});};\n`);
  const html = path.join(app, 'public/index.html'); await writeFile(html, (await readFile(html, 'utf8')).replace('<main ', '<p role="status">TEST ONLY. Synthetic September=7 and October=13 Tokens. Disposable configuration; source responses are synthetic.</p><main '));
  const selectedPort = await port();
  const config = { HOST:'127.0.0.1', PORT:String(selectedPort), CODEX_SESSIONS_DIR:codex, CLAUDE_SESSIONS_DIR:claude, AUTO_REFRESH:'0', ...values };
  await writeFile(path.join(app,'.env'), Object.entries(config).map(([key,value])=>`${key}=${value}`).join('\n')+'\n');
  const child = spawn(process.execPath, ['--import', path.join(app, 'offline.mjs'), path.join(app, 'server.mjs')], { cwd: app,
    env: { CODEX_HOME:path.join(app,'no-auth'), CLAUDE_CONFIG_DIR:path.join(app,'no-auth') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const address=config.HOST.includes(':') ? `[${config.HOST}]` : config.HOST;
  const instance = { child, app, port: selectedPort, base: `http://${address}:${selectedPort}`, output: '' }; processes.push(instance);
  child.stdout.on('data', chunk => instance.output += chunk); child.stderr.on('data', chunk => instance.output += chunk);
  if (fail) { await once(child, 'exit'); assert.notEqual(child.exitCode, 0); return instance; }
  for (let i = 0; i < 100 && !instance.output.includes('Local AI Token Dashboard:'); i++) { if (child.exitCode != null) throw new Error(instance.output); await delay(25); }
  assert.ok(instance.output.includes('Local AI Token Dashboard:')); return instance;
}
async function json(instance, route, expected = 200, init) { const response = await fetch(instance.base + route, init); assert.equal(response.status, expected, route); return response.json(); }
async function rawRequest(instance, headers, method = 'GET', route = '/api/providers') {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname:'127.0.0.1', port:instance.port, path:route, method, headers }, response => { let body=''; response.on('data', chunk=>body+=chunk); response.on('end',()=>resolve({status:response.statusCode, body:JSON.parse(body)})); });
    request.on('error',reject); request.end();
  });
}
async function tunnel(instance, rewrite) {
  const config = path.join(root, 'empty-cloudflared.yml'); await writeFile(config, '{}\n');
  const args = ['tunnel', '--config', config, '--no-autoupdate', '--metrics', '127.0.0.1:0', '--protocol', 'http2', '--url', instance.base];
  if (rewrite) args.push('--http-host-header', `0.0.0.0:${instance.port}`);
  const child = spawn('cloudflared', args, { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  const running = { child, output: '' }; processes.push(running);
  child.stdout.on('data', chunk => running.output += chunk); child.stderr.on('data', chunk => running.output += chunk);
  let url;
  for (let i = 0; i < 200; i++) { url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(running.output)?.[0]; if (url && running.output.includes('Registered tunnel connection')) break; if (child.exitCode != null) throw new Error('Quick Tunnel exited.'); await delay(100); }
  assert.ok(url && running.output.includes('Registered tunnel connection'), 'Quick Tunnel did not connect');
  let response; let networkError;
  for (let i = 0; i < 5; i++) { try { response = await fetch(url + '/api/dashboard?mode=month&period=2026-9&timezone=Asia%2FTaipei', { signal: AbortSignal.timeout(5000) }); if ([200,400].includes(response.status)) break; } catch (error) { networkError = error.cause?.code || error.name; } await delay(500); }
  if (!response) { const failure={ url, rewrite, registered: true, networkError }; (evidence.tunnelUnavailable ||= []).push(failure); console.log(JSON.stringify({testOnlyTunnelUnavailable:failure})); await stop(running); return; }
  assert.equal(response?.status, rewrite ? 200 : 400);
  const body = await response.json();
  if (rewrite) {
    assert.equal(body.totals.totalTokens, 7); assert.ok(!JSON.stringify(body).includes(instance.app)); assert.ok(!JSON.stringify(body).includes('/TEST_ONLY/private-workspace'));
    for (const route of ['/api/settings', '/api/diagnostics', '/api/account-usage']) assert.equal((await fetch(url + route)).status,403);
    const rejected = await fetch(url + '/api/refresh', { method:'POST', headers:{Origin:url} }); assert.equal(rejected.status,403);
  } else assert.equal(body.error.code,'INVALID_HOST');
  evidence.checks.push(rewrite ? 'real Quick Tunnel with explicit upstream Host: redacted synthetic September data; private APIs and HTTPS-origin POST refused' : 'real default Quick Tunnel: public Host refused with INVALID_HOST');
  await stop(running);
}
try {
  const local = await launch('local', {}); const exposed = await launch('exposed', { EXPOSE_FULL_PATHS:'1' });
  const remote = await launch('remote', { HOST:'0.0.0.0', ALLOW_REMOTE:'1' });
  const denied = await launch('denied', { HOST:'0.0.0.0', ALLOW_REMOTE:'0' }, true); assert.match(denied.output,/requires ALLOW_REMOTE=1/);
  const conflicting = await launch('conflicting', { HOST:'0.0.0.0', ALLOW_REMOTE:'1', EXPOSE_FULL_PATHS:'1' }, true); assert.match(conflicting.output,/requires a loopback HOST/);
  evidence.checks.push('non-loopback bind requires opt-in; non-loopback full-path combination refused before serving');
  const september = await json(local,'/api/dashboard?mode=month&period=2026-9&timezone=Asia%2FTaipei'); assert.equal(september.totals.totalTokens,7); assert.equal(september.range.fromMs,Date.parse('2026-08-31T16:00Z')); assert.equal(september.range.toMs,Date.parse('2026-09-30T16:00Z'));
  for(const period of ['2026-0','2026-13','2026-009']) await json(local,`/api/dashboard?mode=month&period=${period}`,400);
  evidence.checks.push('single-digit September returns only September observations; invalid months remain rejected');
  const plain = JSON.stringify(september); const full = JSON.stringify(await json(exposed,'/api/dashboard?mode=all'));
  assert.ok(!plain.includes('/TEST_ONLY/private-workspace')); assert.ok(!plain.includes(local.app)); assert.ok(full.includes('/TEST_ONLY/private-workspace'));
  evidence.checks.push('EXPOSE_FULL_PATHS changes actual loopback response paths; default responses are redacted');
  const host = { Host:`0.0.0.0:${remote.port}` };
  const data = await json(remote,'/api/dashboard?mode=all',200,{headers:host}); assert.equal(data.totals.totalTokens,20);
  for(const route of ['/api/settings','/api/diagnostics','/api/account-usage']) await json(remote,route,403,{headers:host});
  const direct = await fetch(`http://127.0.0.1:${remote.port}/api/providers`); evidence.remoteDirectStatus=direct.status;
  assert.equal(direct.status,200);
  const origin=`http://127.0.0.1:${remote.port}`;
  assert.equal((await rawRequest(remote,{Host:`127.0.0.1:${remote.port}`,Origin:origin},'POST','/api/refresh')).status,200);
  assert.equal((await rawRequest(remote,{Host:`127.0.0.1:${remote.port}`,Origin:origin.replace('http:','https:')},'POST','/api/refresh')).status,403);
  for(const headers of [{Host:'evil.test'},{Host:`127.0.0.1:${remote.port+1}`},{Host:'evil.test', 'X-Forwarded-Host':`127.0.0.1:${remote.port}`, 'X-Forwarded-Proto':'http'}]) assert.equal((await rawRequest(remote,headers)).status,400);
  const lan=Object.values(os.networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal);
  if(lan){ const response=await fetch(`http://${lan.address}:${remote.port}/api/dashboard?mode=all`); assert.equal(response.status,200); const body=await response.json(); assert.equal(body.totals.totalTokens,20); assert.ok(!JSON.stringify(body).includes('/TEST_ONLY/private-workspace')); evidence.sameMachineLanInterface=true; }
  evidence.checks.push('wildcard socket IP works; wrong port, external Host, spoofed forwarded headers and HTTPS Origin remain rejected');
  evidence.checks.push('remote bind serves configured Host and blocks settings, diagnostics and login usage');
  const ipv6=await launch('remote-ipv6',{HOST:'::',ALLOW_REMOTE:'1'});
  const ipv6response=await fetch(`http://[::1]:${ipv6.port}/api/dashboard?mode=all`); assert.equal(ipv6response.status,200); assert.equal((await ipv6response.json()).totals.totalTokens,20);
  assert.equal((await fetch(`http://[::1]:${ipv6.port}/api/settings`)).status,403);
  evidence.checks.push('IPv6 wildcard serves its actual loopback destination with remote privacy policy');
  if(process.argv.includes('--tunnel')) { await tunnel(remote,false); await tunnel(remote,true); }
  console.log(JSON.stringify(evidence,null,2));
  if(process.argv.includes('--serve')) { console.log(JSON.stringify({testOnly:true,local:local.base,exposed:exposed.base,remote:remote.base,root})); await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);process.stdin.once('data',resolve);process.stdin.resume();});process.stdin.pause(); }
} finally { for(const instance of processes.reverse()) await stop(instance); await rm(root,{recursive:true,force:true}); }
