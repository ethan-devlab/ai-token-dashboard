import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Explicit manual QA surface. It never writes .env or forwards a POST.
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const settings = { HOST: '127.0.0.1', PORT: '3333', CODEX_SESSIONS_DIR: '/TEST_ONLY/codex', CLAUDE_SESSIONS_DIR: '/TEST_ONLY/claude', MAX_FILES: '10000', PARSE_CONCURRENCY: '4', ALLOW_REMOTE: '0', EXPOSE_FULL_PATHS: '0', AUTO_REFRESH: '0', AUTO_REFRESH_DEBOUNCE_MS: '1500', UPDATE_REPOSITORY: '' };
const failures = new Set();
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const fail = (res) => json(res, 503, { error: { code: 'TEST_ONLY_FAILURE', message: 'TEST ONLY simulated request failure.' } });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/settings') {
      const referer = new URL(req.headers.referer || 'http://localhost');
      if (referer.searchParams.get('test') === 'unavailable') return json(res, 403, { error: { code: 'SETTINGS_DISABLED', message: 'TEST ONLY settings disabled.' } });
      if (req.method === 'GET') return json(res, 200, { settings, restartRequired: true });
      if (req.method === 'POST') {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) return json(res, 413, {}); }
        const edited = JSON.parse(body);
        if (edited.MAX_FILES === '999') return fail(res);
        for (const key of Object.keys(settings)) settings[key] = edited[key];
        return json(res, 200, { settings, restartRequired: true });
      }
    }
    if (url.pathname === '/api/account-usage') return json(res, 200, { provider: url.searchParams.get('provider') || 'codex', status: 'available', fetchedAt: new Date().toISOString(), planType: 'TEST ONLY', windows: [{ kind: 'five-hour', remainingPercent: null, usedPercent: null, resetsAt: null }, { windowSeconds: 604800, remainingPercent: 0, usedPercent: 100, resetsAt: null }] });
    if (req.method !== 'GET') return fail(res);
    if (url.pathname === '/api/dashboard' && url.searchParams.get('q') === 'TEST_FAIL') return fail(res);
    if (url.pathname === '/api/dashboard' && url.searchParams.get('q') === 'TEST_RETRY') {
      if (!failures.has('retry')) { failures.add('retry'); return fail(res); }
      url.searchParams.delete('q');
    }
    if (url.pathname.startsWith('/api/')) {
      const allowed = new Set(['/api/providers', '/api/dashboard', '/api/sessions']);
      if (!allowed.has(url.pathname) && !/^\/api\/sessions\/[A-Za-z0-9_-]{1,512}$/.test(url.pathname)) return json(res, 404, {});
      const upstream = await fetch(`http://localhost:3333${url.pathname}${url.search}`);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(await upstream.text()); return;
    }
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(publicRoot, `.${requested}`);
    if (!target.startsWith(publicRoot)) return json(res, 404, {});
    const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript' };
    const type = types[path.extname(target)]; if (!type) return json(res, 404, {});
    let content = await readFile(target);
    if (type === 'text/html') content = Buffer.from(content.toString().replace('<main ', '<p role="status">TEST ONLY manual QA. Settings saves are memory-only; request failures and quota values are simulated.</p><main '));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); res.end(content);
  } catch { json(res, 404, { error: { code: 'TEST_ONLY_NOT_FOUND', message: 'TEST ONLY route not available.' } }); }
});
server.listen(0, '127.0.0.1', () => console.log(`TEST ONLY manual UI server: http://localhost:${server.address().port}`));
