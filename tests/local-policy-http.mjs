import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(path.join(os.tmpdir(), 'ctd-local-policy-'));
const source = fileURLToPath(new URL('../', import.meta.url));
const processes = []; const checks = [];
async function stop(child) { if (child.exitCode !== null || child.signalCode !== null) return; const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
async function launch(name, repository) {
  const app = path.join(root, name); await mkdir(app);
  await Promise.all(['server', 'public', 'server.mjs', 'package.json'].map(file => cp(path.join(source, file), path.join(app, file), { recursive: true })));
  const sessions = path.join(app, 'synthetic'); await mkdir(sessions);
  await writeFile(path.join(sessions, 'TEST_ONLY.jsonl'), [{type:'session_meta',timestamp:'2026-09-02T00:00Z',payload:{id:'TEST_ONLY',model:'gpt-6.1-sol',cwd:'/TEST_ONLY/workspace'}},{type:'turn.completed',timestamp:'2026-09-02T00:00Z',model:'gpt-6.1-sol',usage:{input_tokens:7,output_tokens:0}}].map(JSON.stringify).join('\n')+'\n');
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port; const closed = once(reserve, 'close'); reserve.close(); await closed;
  const base = `http://127.0.0.1:${port}`;
  await writeFile(path.join(app, '.env'), `HOST=127.0.0.1\nPORT=${port}\nCODEX_SESSIONS_DIR=${sessions}\nCLAUDE_SESSIONS_DIR=${sessions}\nAUTO_REFRESH=0\n${repository === undefined ? '' : `UPDATE_REPOSITORY=${repository}\n`}`);
  await writeFile(path.join(app, 'control.json'), JSON.stringify({status:200,tag:'v2.2.0'}));
  await writeFile(path.join(app, 'offline.mjs'), `import {readFileSync,writeFileSync} from 'node:fs'; import {PRICING} from './server/pricing.mjs';
const stats={admitted:[],rejected:[],upstream:[]}; const save=()=>writeFileSync(new URL('./stats.json',import.meta.url),JSON.stringify(stats));save();
globalThis.TEST_ONLY_ADMITTED=(method,route,headers)=>{stats.admitted.push({method,route,headers});save();};globalThis.TEST_ONLY_REJECTED=code=>{stats.rejected.push(code);save();};
globalThis.fetch=async(url,options={})=>{if(String(url).startsWith('https://api.github.com/')){stats.upstream.push({url:String(url),method:options.method||'GET',authorization:Boolean(options.headers?.Authorization||options.headers?.authorization)});save();const c=JSON.parse(readFileSync(new URL('./control.json',import.meta.url)));if(c.network)throw Error('TEST_ONLY network failure');return Response.json({tag_name:c.tag,draft:false,prerelease:false,assets:[]},{status:c.status});}
if(!String(url).endsWith('/pricing.md'))return Response.json({},{status:503});const price=v=>v==null?'-':'$'+v;return new Response('### Standard pricing data\\n| Model | Short context input | Short context cached input | Short context cache writes | Short context output |\\n|---|---|---|---|---|\\n'+Object.entries(PRICING.rates).map(([id,r])=>'| '+[id,price(r.input),price(r.cachedInput),price(r.cacheWrite),price(r.output)].join(' | ')+' |').join('\\n'));};`);
  const entry = path.join(app, 'server.mjs'); let code = await readFile(entry, 'utf8');
  const anchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/providers')";
  assert.ok(code.includes(anchor)); code = code.replace(anchor, "    globalThis.TEST_ONLY_ADMITTED(req.method, requestUrl.pathname, {origin:req.headers.origin,site:req.headers['sec-fetch-site']});\n"+anchor);
  code = code.replace('function error(res, failure, id) {', 'function error(res, failure, id) { globalThis.TEST_ONLY_REJECTED(failure.code);'); await writeFile(entry, code);
  const child = spawn(process.execPath, ['--import',path.join(app,'offline.mjs'),entry], {cwd:app,env:{CODEX_HOME:path.join(app,'no-auth'),CLAUDE_CONFIG_DIR:path.join(app,'no-auth')},stdio:['ignore','pipe','pipe']}); processes.push(child);
  let output=''; child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  for(let i=0;i<200;i++){if(output.includes('Local AI Token Dashboard:'))return {app,base,port,child};if(child.exitCode!==null)throw Error('Fixture startup failed');await delay(25);}throw Error('Fixture startup timeout');
}
async function stats(instance) { return JSON.parse(await readFile(path.join(instance.app,'stats.json'),'utf8')); }
function raw(instance, {method='GET',route='/api/dashboard',headers={},body,duplicate}={}) {
  return new Promise((resolve,reject)=>{
    const emptyPost=method==='POST' && body===undefined && !Object.keys(headers).some(name=>['content-length','transfer-encoding'].includes(name.toLowerCase()));
    const pairs=Object.entries({Host:`127.0.0.1:${instance.port}`,Connection:'close',...(emptyPost?{'Content-Length':'0'}:{}),...headers}).flat(); if(duplicate)pairs.push(...duplicate);
    const request=http.request({hostname:'127.0.0.1',port:instance.port,path:route,method,headers:pairs},response=>{let data='';response.on('data',chunk=>data+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:data}));});request.on('error',reject);request.end(body);
  });
}
async function rejected(instance, options, status, code) {
  const before=await stats(instance); const envBefore=await readFile(path.join(instance.app,'.env'));
  const response=await raw(instance,options);assert.equal(response.status,status,JSON.stringify(options));if(code)assert.equal(JSON.parse(response.body).error.code,code);
  const after=await stats(instance);assert.equal(after.admitted.length,before.admitted.length);assert.equal(after.upstream.length,before.upstream.length);assert.deepEqual(await readFile(path.join(instance.app,'.env')),envBefore);
  return response;
}
try {
  const fixture=await launch('default');
  for(const headers of [{},{Origin:fixture.base},{'Sec-Fetch-Site':'same-origin'},{'Sec-Fetch-Site':'none'}]) assert.equal((await raw(fixture,{headers})).status,200);
  for(const route of ['/api/dashboard','/api/settings','/api/diagnostics','/api/account-usage','/api/export?format=csv-sessions']) await rejected(fixture,{route,headers:{Origin:'http://evil.test'}},403,'INVALID_ORIGIN');
  for(const site of ['same-site','cross-site','unknown']) await rejected(fixture,{headers:{'Sec-Fetch-Site':site}},403,'INVALID_FETCH_METADATA');
  await rejected(fixture,{headers:{Origin:'null'}},403,'INVALID_ORIGIN');
  await rejected(fixture,{headers:{Origin:fixture.base,'Sec-Fetch-Site':'cross-site'}},403,'INVALID_FETCH_METADATA');
  for(const [name,value,code] of [['Host',`127.0.0.1:${fixture.port}`,'INVALID_HOST'],['Origin',fixture.base,'INVALID_ORIGIN'],['Sec-Fetch-Site','same-origin','INVALID_FETCH_METADATA']]) await rejected(fixture,{headers:{[name]:value},duplicate:[name,value]},name==='Host'?400:403,code);
  for(const route of ['http://evil.test/api/dashboard','//evil.test/api/dashboard','/\\evil.test/api/dashboard']) await rejected(fixture,{route},400,'INVALID_REQUEST_TARGET');
  checks.push('valid missing-source GET/navigation; cross-origin data and exports refused before handlers, upstream calls or settings writes');
  const get=await rejected(fixture,{route:'/api/update'},405,'METHOD_NOT_ALLOWED');assert.equal(get.headers.allow,'POST');
  for(const options of [{},{headers:{Origin:'null'}},{headers:{Origin:fixture.base,'Sec-Fetch-Site':'cross-site'}},{headers:{Origin:fixture.base,'Content-Length':'1'},body:'x'},{headers:{Origin:fixture.base,'Transfer-Encoding':'chunked'},body:'x'}]) {
    const expected=options.body?413:403; const before=await stats(fixture); const response=await raw(fixture,{method:'POST',route:'/api/update',...options});assert.equal(response.status,expected);assert.equal((await stats(fixture)).upstream.length,before.upstream.length);
  }
  for(const [control,expected] of [[{status:200,tag:'v2.2.0'},'available'],[{status:200,tag:'v2.1.0'},'current'],[{status:404},'unavailable'],[{status:429},'unavailable'],[{network:true},'unavailable']]) {
    await writeFile(path.join(fixture.app,'control.json'),JSON.stringify(control));const before=await stats(fixture);
    const response=await raw(fixture,{method:'POST',route:'/api/update',headers:{Origin:fixture.base,'Sec-Fetch-Site':'same-origin'}});assert.equal(response.status,200);assert.equal(JSON.parse(response.body).status,expected);
    const after=await stats(fixture);assert.equal(after.upstream.length,before.upstream.length+1);assert.deepEqual(after.upstream.at(-1),{url:'https://api.github.com/repos/ethan-devlab/codex-token-dashboard/releases/latest',method:'GET',authorization:false});
  }
  checks.push('update GET 405/Allow without fetch; valid POST anonymous GitHub GET; rejected origins/bodies have zero fetch; available/current/404/rate-limit/network');
  for(const [name,repository] of [['custom','other/repo'],['disabled','']]) {
    const instance=await launch(name,repository); const response=await raw(instance,{method:'POST',route:'/api/update',headers:{Origin:instance.base}});assert.equal(response.status,200);const calls=(await stats(instance)).upstream;
    if(repository)assert.equal(calls.at(-1).url,'https://api.github.com/repos/other/repo/releases/latest');else{assert.equal(calls.length,0);assert.equal(JSON.parse(response.body).status,'disabled');}
  }
  checks.push('custom update repository and explicit blank retain their behavior');
  await writeFile(path.join(fixture.app,'control.json'),JSON.stringify({status:200,tag:'v2.2.0'}));
  const attack=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<h1>TEST ONLY cross-origin fixture</h1><button id="attack">Attempt synthetic API fetch and POST</button><p id="result"></p><form action="${fixture.base}/api/update" method="post" target="response"><button>Submit cross-origin update form</button></form><iframe name="response" title="Synthetic form response"></iframe><script>document.getElementById('attack').onclick=async()=>{for(const method of ['GET','POST']){try{await fetch('${fixture.base}'+(method==='GET'?'/api/dashboard':'/api/update'),{method});}catch{}}document.getElementById('result').textContent='Attempts complete. Verify rejection in fixture server counters.';};</script>`);});attack.listen(0,'127.0.0.1');await once(attack,'listening');
  console.log(JSON.stringify({fixtureOnly:true,checks,base:fixture.base,attack:`http://127.0.0.1:${attack.address().port}`,root,stats:path.join(fixture.app,'stats.json')}));
  if(process.argv.includes('--serve')){await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);process.stdin.once('data',resolve);process.stdin.resume();});process.stdin.pause();}
  const attackClosed=once(attack,'close');attack.close();await attackClosed;
} finally { for(const child of processes.reverse())await stop(child);await rm(root,{recursive:true,force:true}); }
